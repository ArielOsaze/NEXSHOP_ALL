"use strict";
/**
 * newsArticleController.js
 * NexShop News Editorial System — Controller terpisah dari legacy gaming_news.
 *
 * Prinsip editorial:
 *   - Artikel adalah ORIGINAL EDITORIAL NEXSHOP, bukan copy/paraphrase sumber.
 *   - news_sources hanya menyimpan referensi riset untuk verifikasi internal.
 *   - notes di news_sources adalah catatan internal editor — TIDAK boleh ke publik.
 *   - Default status: draft. Publish harus dilakukan eksplisit oleh admin/editor.
 *   - Konten HTML di-sanitasi sebelum disimpan ke database.
 *
 * Security:
 *   - Semua endpoint yang mengubah data dilindungi authMiddleware + adminMiddleware.
 *   - Public endpoint hanya mengembalikan artikel dengan status 'published' dan published_at <= NOW().
 *   - Internal fields (notes, scheduled_at) tidak di-expose ke public response.
 *   - Image URL divalidasi HTTPS via URL parser native.
 *   - Slug di-sanitasi: hanya lowercase alphanumeric + hyphen.
 *   - Content HTML disanitasi: hanya tag yang diperlukan untuk artikel.
 *   - View count di-increment secara atomic dan hanya jika artikel benar-benar ditemukan.
 */

const supabase = require("../config/db");
const { notify } = require("../config/notify");
const { marked } = require("marked");

marked.use({ breaks: true, gfm: true });

// ─────────────────────────────────────────────
// Konstanta
// ─────────────────────────────────────────────
const ARTICLE_CATEGORIES = [
    "Esports", "Gaming", "Xbox", "PlayStation", "PC",
    "Mobile", "Teknologi", "Update Game", "Industri Game", "Berita"
];

const MAX_TITLE_LEN       = 255;
const MAX_EXCERPT_LEN     = 500;
const MAX_CONTENT_LEN     = 200000;  // ~200KB teks
const MAX_AUTHOR_LEN      = 120;
const MAX_SEO_TITLE_LEN   = 70;
const MAX_SEO_DESC_LEN    = 160;
const MAX_IMAGE_ALT_LEN   = 255;
const MAX_IMAGE_CREDIT_LEN = 120;
const MAX_SOURCE_NAME_LEN  = 120;
const MAX_SOURCE_TITLE_LEN = 255;
const MAX_NOTES_LEN        = 2000;
const MAX_TAGS             = 10;
const MAX_KEYWORDS         = 15;
const MAX_TAG_LEN          = 50;
const PUBLIC_PAGE_SIZE     = 12;
const ADMIN_PAGE_SIZE      = 20;

// ─────────────────────────────────────────────
// HTML Sanitizer — whitelist tag & atribut
// ─────────────────────────────────────────────
const ALLOWED_TAGS = new Set([
    "p", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "em", "u", "s", "del", "ins",
    "blockquote", "ol", "ul", "li", "a", "img", "br", "hr",
    "figure", "figcaption", "span", "code", "pre", "div",
    "table", "thead", "tbody", "tr", "th", "td"
]);

// Atribut yang diizinkan per tag
const ALLOWED_ATTRS = {
    a:   ["href", "title", "rel", "target"],
    img: ["src", "alt", "title", "width", "height", "loading"],
    blockquote: ["cite"],
    th: ["align", "colspan", "rowspan"],
    td: ["align", "colspan", "rowspan"],
    "*": ["class"]   // class global diizinkan untuk styling
};

// Pola berbahaya
const DANGEROUS_PROTOCOLS = /^(javascript|vbscript|data|blob):/i;
const DANGEROUS_EVENTS    = /\bon\w+\s*=/i;

/**
 * Sanitasi HTML — hapus tag/atribut berbahaya, pertahankan konten teks.
 * Implementasi ringan berbasis regex untuk lingkungan server-side tanpa DOM.
 * Untuk produksi dengan konten sangat beragam, pertimbangkan DOMPurify (jsdom).
 */
function sanitizeHtml(raw) {
    if (!raw || typeof raw !== "string") return "";

    let html = removeGeminiCitations(raw);

    // Wrap tables in responsive div before sanitizing, so the tags are recognized
    html = html.replace(/<table/gi, '<div class="table-responsive"><table');
    html = html.replace(/<\/table>/gi, '</table></div>');

    // 1. Hapus seluruh script, style, iframe, object, embed beserta isinya
    html = html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "")
        .replace(/<object\b[^>]*>[\s\S]*?<\/object>/gi, "")
        .replace(/<embed\b[^>]*>/gi, "")
        .replace(/<link\b[^>]*>/gi, "")
        .replace(/<meta\b[^>]*>/gi, "")
        .replace(/<base\b[^>]*>/gi, "")
        .replace(/<form\b[^>]*>[\s\S]*?<\/form>/gi, "")
        .replace(/<input\b[^>]*>/gi, "")
        .replace(/<button\b[^>]*>[\s\S]*?<\/button>/gi, "")
        .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, "")
        .replace(/<math\b[^>]*>[\s\S]*?<\/math>/gi, "");

    // 2. Hapus comment HTML (bisa menyembunyikan payload)
    html = html.replace(/<!--[\s\S]*?-->/g, "");

    // 3. Proses setiap tag yang tersisa
    html = html.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (match, tagName, attrs) => {
        const lower = tagName.toLowerCase();

        // Closing tag — izinkan jika tag diizinkan
        if (match.startsWith("</")) {
            return ALLOWED_TAGS.has(lower) ? `</${lower}>` : "";
        }

        // Opening/self-closing tag — hanya izinkan jika tag diizinkan
        if (!ALLOWED_TAGS.has(lower)) return "";

        // Sanitasi atribut
        const cleanAttrs = sanitizeAttrs(lower, attrs);
        const selfClosing = ["br", "hr", "img"].includes(lower);

        return selfClosing ? `<${lower}${cleanAttrs}>` : `<${lower}${cleanAttrs}>`;
    });

    return html.trim();
}

function sanitizeAttrs(tagName, attrsRaw) {
    if (!attrsRaw || !attrsRaw.trim()) return "";

    const allowed = new Set([...(ALLOWED_ATTRS[tagName] || []), ...(ALLOWED_ATTRS["*"] || [])]);
    let result = "";

    // Parse atribut sederhana
    const attrPattern = /([a-zA-Z][a-zA-Z0-9\-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;
    let m;
    while ((m = attrPattern.exec(attrsRaw)) !== null) {
        const name  = m[1].toLowerCase();
        const value = (m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : "");

        // Tolak event handler (onclick, onerror, dll)
        if (DANGEROUS_EVENTS.test(`${name}=`)) continue;
        if (!allowed.has(name)) continue;

        // Validasi nilai URL
        if (["href", "src", "action", "cite"].includes(name)) {
            const trimmed = value.trim();
            if (DANGEROUS_PROTOCOLS.test(trimmed)) continue;
            // Untuk href/src: hanya izinkan http, https, atau path relatif
            if (trimmed && !trimmed.startsWith("/") && !trimmed.startsWith("#")) {
                try {
                    const u = new URL(trimmed);
                    if (!["http:", "https:"].includes(u.protocol)) continue;
                } catch {
                    // URL relatif atau fragment — izinkan
                }
            }
        }

        // Paksa rel="noopener noreferrer" pada link eksternal
        if (tagName === "a" && name === "href") {
            result += ` href="${escapeAttr(value)}" rel="noopener noreferrer"`;
            continue;
        }

        // Target _blank dipaksa bersama rel (sudah ditambahkan di atas)
        if (tagName === "a" && name === "target") continue;
        if (tagName === "a" && name === "rel") continue;

        result += ` ${name}="${escapeAttr(value)}"`;
    }

    return result;
}

function escapeAttr(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#x27;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function removeGeminiCitations(text) {
    if (!text || typeof text !== "string") return text;
    // Menghapus tag sitasi Gemini yang menggunakan Private Use Area Unicode dan Lenticular Bracket
    return text
        .replace(/\uE200cite[^\uE201]*\uE201/g, "")
        .replace(/【(?:cite|turn)[^】]*】/g, "");
}

// ─────────────────────────────────────────────
// Utilitas validasi
// ─────────────────────────────────────────────
function trimText(value, maxLen) {
    const s = typeof value === "string" ? value.trim() : "";
    return s.slice(0, maxLen);
}

function parseHttpsUrl(value) {
    try {
        const u = new URL(String(value || "").trim());
        if (u.protocol !== "https:" || u.username || u.password) return null;
        return u.href;
    } catch {
        return null;
    }
}

function generateSlug(title) {
    return String(title || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")  // hapus diakritik
        .replace(/[^a-z0-9\s\-]/g, " ")   // non-alphanumeric jadi spasi
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 100);
}

function sanitizeSlug(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9\-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 100);
}

function normalizeTags(value) {
    const arr = Array.isArray(value)
        ? value
        : String(value || "").split(",");
    return [...new Set(
        arr.map(t => trimText(t, MAX_TAG_LEN)).filter(Boolean)
    )].slice(0, MAX_TAGS);
}

/** Pastikan slug unik — tambahkan suffix jika perlu */
async function ensureUniqueSlug(baseSlug, excludeId = null) {
    let candidate = baseSlug;
    let suffix    = 1;
    while (true) {
        let query = supabase
            .from("news_articles")
            .select("id")
            .eq("slug", candidate)
            .limit(1);
        if (excludeId) query = query.neq("id", excludeId);
        const { data, error } = await query;
        if (error) throw error;
        if (!data || data.length === 0) return candidate;
        candidate = `${baseSlug}-${++suffix}`;
    }
}

// ─────────────────────────────────────────────
// Validasi payload artikel
// ─────────────────────────────────────────────
function validateArticlePayload(body, isCreate = true) {
    const errors = [];

    const title = trimText(body.title, MAX_TITLE_LEN);
    if (!title) errors.push("Judul artikel wajib diisi");

    const excerpt = trimText(body.excerpt, MAX_EXCERPT_LEN);
    
    // Convert Markdown to HTML before sanitizing
    const rawContent = trimText(body.content || "", MAX_CONTENT_LEN);
    const htmlContent = marked.parse(rawContent);
    const content = sanitizeHtml(htmlContent);

    const author  = trimText(body.author || "NexShop Editorial", MAX_AUTHOR_LEN) || "NexShop Editorial";

    const categoryInput = trimText(body.category || "Gaming", 80);
    // Terima kategori apapun selama non-kosong (fleksibel untuk kategori baru)
    const category = categoryInput || "Gaming";

    const tags     = normalizeTags(body.tags || []);
    const keywords = normalizeTags(body.keywords || []).slice(0, MAX_KEYWORDS);

    const seoTitle = trimText(body.seo_title || "", MAX_SEO_TITLE_LEN);
    const seoDesc  = trimText(body.seo_description || "", MAX_SEO_DESC_LEN);

    const imageAlt        = trimText(body.image_alt || "", MAX_IMAGE_ALT_LEN);
    const imageCredit     = trimText(body.image_credit || "", MAX_IMAGE_CREDIT_LEN);

    // image_url wajib HTTPS jika diisi; bisa kosong
    let imageUrl = null;
    if (body.image_url && String(body.image_url).trim()) {
        imageUrl = parseHttpsUrl(body.image_url);
        if (!imageUrl) errors.push("image_url harus berupa URL HTTPS yang valid");
    }

    // image_source_url opsional
    let imageSourceUrl = null;
    if (body.image_source_url && String(body.image_source_url).trim()) {
        imageSourceUrl = parseHttpsUrl(body.image_source_url);
        if (!imageSourceUrl) errors.push("image_source_url harus berupa URL HTTPS yang valid");
    }

    // scheduled_at opsional
    let scheduledAt = null;
    if (body.scheduled_at) {
        const d = new Date(body.scheduled_at);
        if (isNaN(d.getTime())) errors.push("scheduled_at tidak valid");
        else scheduledAt = d.toISOString();
    }

    const isFeatured = body.is_featured === true || body.is_featured === "true";
    const isPinned   = body.is_pinned   === true || body.is_pinned   === "true";

    if (errors.length) return { error: errors.join("; ") };

    return {
        value: {
            title,
            excerpt,
            content,
            author,
            category,
            tags,
            keywords,
            seo_title:        seoTitle,
            seo_description:  seoDesc,
            image_url:        imageUrl || null,
            image_alt:        imageAlt || null,
            image_credit:     imageCredit || null,
            image_source_url: imageSourceUrl || null,
            scheduled_at:     scheduledAt,
            is_featured:      isFeatured,
            is_pinned:        isPinned,
            updated_at:       new Date().toISOString()
        }
    };
}

// ─────────────────────────────────────────────
// Helpers response
// ─────────────────────────────────────────────
function dbError(res, err, fallback) {
    console.error("NexShop News DB error:", err);
    const code = String(err && err.code || "");
    let msg = fallback;
    if (code === "23505") msg = "Slug atau judul sudah digunakan artikel lain";
    if (["42703", "42P01", "PGRST204"].includes(code)) {
        msg = "Schema database belum sesuai. Jalankan database_migrations_news.sql di Supabase SQL Editor.";
    }
    return res.status(500).json({ success: false, message: msg, code: err && err.code });
}

/** Field yang di-expose ke public (tidak ada notes, scheduled_at, dll) */
function publicArticleShape(article, sources = []) {
    return {
        id:              article.id,
        slug:            article.slug,
        title:           removeGeminiCitations(article.title),
        excerpt:         removeGeminiCitations(article.excerpt || null),
        content:         removeGeminiCitations(article.content || ""),
        category:        article.category,
        tags:            article.tags || [],
        author:          article.author,
        published_at:    article.published_at,
        updated_at:      article.updated_at,
        image_url:       article.image_url || null,
        image_alt:       article.image_alt || null,
        image_credit:    article.image_credit || null,
        seo_title:       removeGeminiCitations(article.seo_title || null),
        seo_description: removeGeminiCitations(article.seo_description || null),
        keywords:        article.keywords || [],
        is_featured:     article.is_featured,
        is_pinned:       article.is_pinned,
        view_count:      article.view_count,
        sources:         sources.map(s => ({
            id:           s.id,
            source_name:  s.source_name,
            source_url:   s.source_url,
            source_title: s.source_title || null
            // notes TIDAK di-expose ke publik
        }))
    };
}

// ─────────────────────────────────────────────
// PUBLIC ENDPOINTS
// ─────────────────────────────────────────────

/**
 * GET /api/news/articles
 * List artikel published, support filter & pagination.
 */
exports.getPublicArticles = async (req, res) => {
    try {
        const page     = Math.max(1, parseInt(req.query.page) || 1);
        const limit    = Math.min(PUBLIC_PAGE_SIZE * 2, Math.max(1, parseInt(req.query.limit) || PUBLIC_PAGE_SIZE));
        const offset   = (page - 1) * limit;
        const category = String(req.query.category || "").trim();
        const search   = String(req.query.search || "").trim().slice(0, 100);
        const featured = req.query.featured === "true";
        const pinned   = req.query.pinned   === "true";

        const now = new Date().toISOString();

        let query = supabase
            .from("news_articles")
            .select("id, slug, title, excerpt, category, tags, author, published_at, updated_at, image_url, image_alt, is_featured, is_pinned, view_count, seo_title, seo_description, keywords, word_count", { count: "exact" })
            .eq("status", "published")
            .lte("published_at", now);

        if (category) query = query.eq("category", category);
        if (featured) query = query.eq("is_featured", true);
        if (pinned)   query = query.eq("is_pinned", true);
        if (search)   query = query.or(`title.ilike.%${search}%,excerpt.ilike.%${search}%`);

        query = query
            .order("is_pinned",   { ascending: false })
            .order("is_featured", { ascending: false })
            .order("published_at",{ ascending: false })
            .range(offset, offset + limit - 1);

        const { data, error, count } = await query;
        if (error) return dbError(res, error, "Gagal memuat artikel berita");

        const cleanedData = (data || []).map(a => ({
            ...a,
            title: removeGeminiCitations(a.title),
            excerpt: removeGeminiCitations(a.excerpt || null),
            seo_title: removeGeminiCitations(a.seo_title || null),
            seo_description: removeGeminiCitations(a.seo_description || null)
        }));

        return res.json({
            success: true,
            data:  cleanedData,
            meta:  { page, limit, total: count || 0, total_pages: Math.ceil((count || 0) / limit) }
        });
    } catch (err) {
        console.error("getPublicArticles error:", err);
        return res.status(500).json({ success: false, message: "Server gagal memuat artikel" });
    }
};

/**
 * GET /api/news/articles/:slug
 * Detail artikel by slug — hanya published.
 * Increment view_count secara atomic.
 */
exports.getPublicArticleBySlug = async (req, res) => {
    const slug = sanitizeSlug(String(req.params.slug || "").slice(0, 120));
    if (!slug) return res.status(400).json({ success: false, message: "Slug tidak valid" });

    try {
        const now = new Date().toISOString();

        // Fetch artikel
        const { data: article, error } = await supabase
            .from("news_articles")
            .select("*")
            .eq("slug", slug)
            .eq("status", "published")
            .lte("published_at", now)
            .single();

        if (error && error.code === "PGRST116") {
            return res.status(404).json({ success: false, message: "Artikel tidak ditemukan" });
        }
        if (error) return dbError(res, error, "Gagal memuat artikel");

        // Fetch sources (tanpa notes)
        const { data: sources } = await supabase
            .from("news_sources")
            .select("id, source_name, source_url, source_title")
            .eq("article_id", article.id)
            .order("created_at", { ascending: true });

        // Increment view_count secara atomic
        const { error: rpcError } = await supabase.rpc("increment_news_view", { article_id_param: article.id });
        if (rpcError) {
            // Fallback jika RPC belum dibuat: update langsung
            supabase.from("news_articles")
                .update({ view_count: (article.view_count || 0) + 1 })
                .eq("id", article.id)
                .then(() => {});
        }

        // Related articles (same category, different slug, max 4)
        const { data: related } = await supabase
            .from("news_articles")
            .select("id, slug, title, excerpt, category, published_at, image_url, image_alt, is_featured")
            .eq("status", "published")
            .eq("category", article.category)
            .lte("published_at", now)
            .neq("slug", slug)
            .order("published_at", { ascending: false })
            .limit(4);

        return res.json({
            success: true,
            data:    { ...publicArticleShape(article, sources || []), related: related || [] }
        });
    } catch (err) {
        console.error("getPublicArticleBySlug error:", err);
        return res.status(500).json({ success: false, message: "Server gagal memuat artikel" });
    }
};

// ─────────────────────────────────────────────
// ADMIN ENDPOINTS
// ─────────────────────────────────────────────

/**
 * GET /api/news/admin/articles
 * List semua artikel (semua status) untuk admin.
 */
exports.getAllArticles = async (req, res) => {
    try {
        const page     = Math.max(1, parseInt(req.query.page) || 1);
        const limit    = Math.min(50, Math.max(1, parseInt(req.query.limit) || ADMIN_PAGE_SIZE));
        const offset   = (page - 1) * limit;
        const status   = ["draft", "published", "scheduled"].includes(req.query.status) ? req.query.status : null;
        const category = String(req.query.category || "").trim();
        const search   = String(req.query.search || "").trim().slice(0, 100);

        let query = supabase
            .from("news_articles")
            .select("id, slug, title, excerpt, category, tags, author, status, published_at, scheduled_at, updated_at, created_at, image_url, is_featured, is_pinned, view_count", { count: "exact" });

        if (status)   query = query.eq("status", status);
        if (category) query = query.eq("category", category);
        if (search)   query = query.or(`title.ilike.%${search}%,excerpt.ilike.%${search}%`);

        query = query
            .order("created_at", { ascending: false })
            .range(offset, offset + limit - 1);

        const { data, error, count } = await query;
        if (error) return dbError(res, error, "Gagal memuat daftar artikel");

        const cleanedData = (data || []).map(a => ({
            ...a,
            title: removeGeminiCitations(a.title),
            excerpt: removeGeminiCitations(a.excerpt || null)
        }));

        return res.json({
            success: true,
            data:    cleanedData,
            meta:    { page, limit, total: count || 0, total_pages: Math.ceil((count || 0) / limit) }
        });
    } catch (err) {
        console.error("getAllArticles error:", err);
        return res.status(500).json({ success: false, message: "Server gagal memuat artikel admin" });
    }
};

/**
 * GET /api/news/admin/articles/:id
 * Detail artikel by ID untuk admin (termasuk semua field).
 */
exports.getArticleById = async (req, res) => {
    const id = parseInt(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ success: false, message: "ID artikel tidak valid" });
    }
    try {
        const { data: article, error } = await supabase
            .from("news_articles")
            .select("*")
            .eq("id", id)
            .single();

        if (error && error.code === "PGRST116") {
            return res.status(404).json({ success: false, message: "Artikel tidak ditemukan" });
        }
        if (error) return dbError(res, error, "Gagal memuat artikel");

        const { data: sources } = await supabase
            .from("news_sources")
            .select("*")
            .eq("article_id", id)
            .order("created_at", { ascending: true });

        const cleanedArticle = {
            ...article,
            title: removeGeminiCitations(article.title),
            excerpt: removeGeminiCitations(article.excerpt || null),
            content: removeGeminiCitations(article.content || ""),
            seo_title: removeGeminiCitations(article.seo_title || null),
            seo_description: removeGeminiCitations(article.seo_description || null)
        };

        return res.json({ success: true, data: { ...cleanedArticle, sources: sources || [] } });
    } catch (err) {
        console.error("getArticleById error:", err);
        return res.status(500).json({ success: false, message: "Server gagal memuat artikel" });
    }
};

/**
 * POST /api/news/admin/articles
 * Buat artikel baru — default status: draft.
 */
exports.createArticle = async (req, res) => {
    const validation = validateArticlePayload(req.body || {}, true);
    if (validation.error) {
        return res.status(400).json({ success: false, message: validation.error });
    }

    try {
        // Buat slug dari judul (atau dari body.slug jika admin tentukan manual)
        const baseSlug = req.body.slug
            ? sanitizeSlug(req.body.slug)
            : generateSlug(validation.value.title);

        if (!baseSlug) {
            return res.status(400).json({ success: false, message: "Slug tidak dapat dibuat dari judul ini" });
        }

        const slug = await ensureUniqueSlug(baseSlug);
        const words = String(validation.value.content || "").replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;

        const row = {
            ...validation.value,
            slug,
            word_count: words,
            status:    "draft",
            created_at: new Date().toISOString()
        };

        const { data, error } = await supabase
            .from("news_articles")
            .insert([row])
            .select()
            .single();

        if (error) return dbError(res, error, "Gagal menyimpan artikel");

        notify("news", `${req.user.email} membuat artikel baru: "${data.title}" [draft]`);

        return res.status(201).json({
            success: true,
            message: "Artikel berhasil disimpan sebagai draft",
            data
        });
    } catch (err) {
        if (err && err.code) return dbError(res, err, "Gagal menyimpan artikel");
        console.error("createArticle error:", err);
        return res.status(500).json({ success: false, message: "Server gagal menyimpan artikel" });
    }
};

/**
 * PUT /api/news/admin/articles/:id
 * Edit artikel. Status tidak berubah di sini (gunakan /publish, /unpublish, /schedule).
 */
exports.updateArticle = async (req, res) => {
    const id = parseInt(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ success: false, message: "ID artikel tidak valid" });
    }

    const validation = validateArticlePayload(req.body || {}, false);
    if (validation.error) {
        return res.status(400).json({ success: false, message: validation.error });
    }

    try {
        // Slug: jika admin ubah manual, sanitasi dan cek uniqueness
        let slug;
        if (req.body.slug) {
            slug = sanitizeSlug(req.body.slug);
            if (!slug) return res.status(400).json({ success: false, message: "Slug tidak valid" });
            slug = await ensureUniqueSlug(slug, id);
        } else {
            // Tidak ada slug dari body — generate dari judul baru tapi cek dulu apakah berbeda
            const { data: existing } = await supabase
                .from("news_articles")
                .select("slug, title")
                .eq("id", id)
                .single();

            if (existing && existing.title === validation.value.title) {
                // Judul sama → pertahankan slug existing
                slug = existing.slug;
            } else {
                // Judul berubah → generate slug baru
                const newBase = generateSlug(validation.value.title);
                slug = newBase ? await ensureUniqueSlug(newBase, id) : (existing && existing.slug) || "";
            }
        }
        const words = String(validation.value.content || "").replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;

        const { data, error } = await supabase
            .from("news_articles")
            .update({ ...validation.value, slug, word_count: words })
            .eq("id", id)
            .select()
            .single();

        if (error && error.code === "PGRST116") {
            return res.status(404).json({ success: false, message: "Artikel tidak ditemukan" });
        }
        if (error) return dbError(res, error, "Gagal memperbarui artikel");

        notify("news", `${req.user.email} memperbarui artikel: "${data.title}"`);

        return res.json({ success: true, message: "Artikel berhasil diperbarui", data });
    } catch (err) {
        if (err && err.code) return dbError(res, err, "Gagal memperbarui artikel");
        console.error("updateArticle error:", err);
        return res.status(500).json({ success: false, message: "Server gagal memperbarui artikel" });
    }
};

/**
 * DELETE /api/news/admin/articles/:id
 * Hapus artikel (cascade ke news_sources).
 */
exports.deleteArticle = async (req, res) => {
    const id = parseInt(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ success: false, message: "ID artikel tidak valid" });
    }
    try {
        const { data, error } = await supabase
            .from("news_articles")
            .delete()
            .eq("id", id)
            .select("title")
            .single();

        if (error && error.code === "PGRST116") {
            return res.status(404).json({ success: false, message: "Artikel tidak ditemukan" });
        }
        if (error) return dbError(res, error, "Gagal menghapus artikel");

        notify("news", `${req.user.email} menghapus artikel: "${data.title}"`);

        return res.json({ success: true, message: "Artikel berhasil dihapus" });
    } catch (err) {
        console.error("deleteArticle error:", err);
        return res.status(500).json({ success: false, message: "Server gagal menghapus artikel" });
    }
};

/**
 * PATCH /api/news/admin/articles/:id/publish
 * Publish artikel — set status='published', published_at=NOW() jika belum diset.
 */
exports.publishArticle = async (req, res) => {
    const id = parseInt(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ success: false, message: "ID artikel tidak valid" });
    }
    try {
        // Cek status sekarang
        const { data: existing, error: fetchErr } = await supabase
            .from("news_articles")
            .select("id, title, status, published_at")
            .eq("id", id)
            .single();

        if (fetchErr && fetchErr.code === "PGRST116") {
            return res.status(404).json({ success: false, message: "Artikel tidak ditemukan" });
        }
        if (fetchErr) return dbError(res, fetchErr, "Gagal memuat artikel");

        const now = new Date().toISOString();
        const update = {
            status:      "published",
            published_at: existing.published_at || now,
            scheduled_at: null,
            updated_at:   now
        };

        const { data, error } = await supabase
            .from("news_articles")
            .update(update)
            .eq("id", id)
            .select()
            .single();

        if (error) return dbError(res, error, "Gagal mempublikasikan artikel");

        notify("news", `${req.user.email} mempublikasikan artikel: "${data.title}"`);

        return res.json({ success: true, message: "Artikel berhasil dipublikasikan", data });
    } catch (err) {
        console.error("publishArticle error:", err);
        return res.status(500).json({ success: false, message: "Server gagal mempublikasikan artikel" });
    }
};

/**
 * PATCH /api/news/admin/articles/:id/unpublish
 * Unpublish artikel — kembali ke draft.
 */
exports.unpublishArticle = async (req, res) => {
    const id = parseInt(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ success: false, message: "ID artikel tidak valid" });
    }
    try {
        const { data, error } = await supabase
            .from("news_articles")
            .update({ status: "draft", scheduled_at: null, updated_at: new Date().toISOString() })
            .eq("id", id)
            .select()
            .single();

        if (error && error.code === "PGRST116") {
            return res.status(404).json({ success: false, message: "Artikel tidak ditemukan" });
        }
        if (error) return dbError(res, error, "Gagal mengubah status artikel");

        return res.json({ success: true, message: "Artikel dikembalikan ke draft", data });
    } catch (err) {
        console.error("unpublishArticle error:", err);
        return res.status(500).json({ success: false, message: "Server gagal mengubah status artikel" });
    }
};

/**
 * PATCH /api/news/admin/articles/:id/schedule
 * Schedule artikel — set status='scheduled', scheduled_at dari body.
 */
exports.scheduleArticle = async (req, res) => {
    const id = parseInt(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ success: false, message: "ID artikel tidak valid" });
    }

    const scheduledAt = req.body && req.body.scheduled_at;
    if (!scheduledAt) {
        return res.status(400).json({ success: false, message: "scheduled_at wajib diisi" });
    }
    const d = new Date(scheduledAt);
    if (isNaN(d.getTime())) {
        return res.status(400).json({ success: false, message: "scheduled_at tidak valid" });
    }
    if (d <= new Date()) {
        return res.status(400).json({ success: false, message: "scheduled_at harus di masa depan" });
    }

    try {
        const { data, error } = await supabase
            .from("news_articles")
            .update({
                status:       "scheduled",
                scheduled_at: d.toISOString(),
                updated_at:   new Date().toISOString()
            })
            .eq("id", id)
            .select()
            .single();

        if (error && error.code === "PGRST116") {
            return res.status(404).json({ success: false, message: "Artikel tidak ditemukan" });
        }
        if (error) return dbError(res, error, "Gagal menjadwalkan artikel");

        notify("news", `${req.user.email} menjadwalkan artikel: "${data.title}" pada ${d.toLocaleString("id-ID")}`);

        return res.json({ success: true, message: "Artikel berhasil dijadwalkan", data });
    } catch (err) {
        console.error("scheduleArticle error:", err);
        return res.status(500).json({ success: false, message: "Server gagal menjadwalkan artikel" });
    }
};

/**
 * PATCH /api/news/admin/articles/bulk
 * Bulk action: publish | unpublish | delete
 */
exports.bulkArticleAction = async (req, res) => {
    const ids    = Array.isArray(req.body && req.body.ids)
        ? [...new Set(req.body.ids.map(Number))].filter(n => Number.isInteger(n) && n > 0)
        : [];
    const action = String(req.body && req.body.action || "");

    if (!ids.length || ids.length > 100) {
        return res.status(400).json({ success: false, message: "Pilih 1–100 artikel yang valid" });
    }
    if (!["publish", "unpublish", "delete"].includes(action)) {
        return res.status(400).json({ success: false, message: "Aksi bulk tidak valid" });
    }

    try {
        if (action === "delete") {
            const { error } = await supabase.from("news_articles").delete().in("id", ids);
            if (error) return dbError(res, error, "Gagal menghapus artikel terpilih");
            return res.json({ success: true, message: `${ids.length} artikel berhasil dihapus` });
        }

        const now = new Date().toISOString();
        const updates = {
            publish:   { status: "published", updated_at: now },
            unpublish: { status: "draft",     updated_at: now, scheduled_at: null }
        };

        if (action === "publish") {
            // Untuk publish bulk, set published_at hanya jika belum ada
            // Lakukan satu per satu untuk kasus ini agar conditional update aman
            for (const id of ids) {
                const { data: existing } = await supabase
                    .from("news_articles")
                    .select("published_at")
                    .eq("id", id)
                    .single();
                const upd = { status: "published", updated_at: now, scheduled_at: null };
                if (!existing || !existing.published_at) upd.published_at = now;
                await supabase.from("news_articles").update(upd).eq("id", id);
            }
            return res.json({ success: true, message: `${ids.length} artikel berhasil dipublikasikan` });
        }

        const { error } = await supabase.from("news_articles").update(updates[action]).in("id", ids);
        if (error) return dbError(res, error, "Gagal memperbarui artikel terpilih");

        return res.json({ success: true, message: `${ids.length} artikel berhasil diperbarui` });
    } catch (err) {
        console.error("bulkArticleAction error:", err);
        return res.status(500).json({ success: false, message: "Server gagal menjalankan aksi bulk" });
    }
};

// ─────────────────────────────────────────────
// SOURCE MANAGEMENT
// ─────────────────────────────────────────────

/**
 * GET /api/news/admin/articles/:id/sources
 */
exports.getArticleSources = async (req, res) => {
    const id = parseInt(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ success: false, message: "ID artikel tidak valid" });
    }
    try {
        const { data, error } = await supabase
            .from("news_sources")
            .select("*")
            .eq("article_id", id)
            .order("created_at", { ascending: true });

        if (error) return dbError(res, error, "Gagal memuat sumber artikel");

        return res.json({ success: true, data: data || [] });
    } catch (err) {
        console.error("getArticleSources error:", err);
        return res.status(500).json({ success: false, message: "Server gagal memuat sumber" });
    }
};

/**
 * POST /api/news/admin/articles/:id/sources
 */
exports.addArticleSource = async (req, res) => {
    const id = parseInt(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ success: false, message: "ID artikel tidak valid" });
    }

    const sourceName  = trimText(req.body && req.body.source_name  || "", MAX_SOURCE_NAME_LEN);
    const sourceUrl   = parseHttpsUrl(req.body && req.body.source_url);
    const sourceTitle = trimText(req.body && req.body.source_title  || "", MAX_SOURCE_TITLE_LEN);
    const notes       = trimText(req.body && req.body.notes         || "", MAX_NOTES_LEN);

    if (!sourceName) return res.status(400).json({ success: false, message: "source_name wajib diisi" });
    if (!sourceUrl)  return res.status(400).json({ success: false, message: "source_url harus berupa URL HTTPS yang valid" });

    let sourcePublishedAt = null;
    if (req.body && req.body.source_published_at) {
        const d = new Date(req.body.source_published_at);
        if (!isNaN(d.getTime())) sourcePublishedAt = d.toISOString();
    }

    try {
        // Pastikan artikel ada
        const { data: article, error: artErr } = await supabase
            .from("news_articles")
            .select("id")
            .eq("id", id)
            .single();

        if (artErr && artErr.code === "PGRST116") {
            return res.status(404).json({ success: false, message: "Artikel tidak ditemukan" });
        }
        if (artErr) return dbError(res, artErr, "Gagal memverifikasi artikel");

        const { data, error } = await supabase
            .from("news_sources")
            .insert([{
                article_id:          id,
                source_name:         sourceName,
                source_url:          sourceUrl,
                source_title:        sourceTitle || null,
                source_published_at: sourcePublishedAt,
                notes:               notes || null
            }])
            .select()
            .single();

        if (error) return dbError(res, error, "Gagal menyimpan sumber artikel");

        return res.status(201).json({ success: true, message: "Sumber berhasil ditambahkan", data });
    } catch (err) {
        console.error("addArticleSource error:", err);
        return res.status(500).json({ success: false, message: "Server gagal menyimpan sumber" });
    }
};

/**
 * DELETE /api/news/admin/articles/:id/sources/:sid
 */
exports.deleteArticleSource = async (req, res) => {
    const id  = parseInt(req.params.id);
    const sid = parseInt(req.params.sid);
    if (!Number.isInteger(id) || id < 1 || !Number.isInteger(sid) || sid < 1) {
        return res.status(400).json({ success: false, message: "ID tidak valid" });
    }
    try {
        const { data, error } = await supabase
            .from("news_sources")
            .delete()
            .eq("id", sid)
            .eq("article_id", id)
            .select("id")
            .single();

        if (error && error.code === "PGRST116") {
            return res.status(404).json({ success: false, message: "Sumber tidak ditemukan" });
        }
        if (error) return dbError(res, error, "Gagal menghapus sumber");

        return res.json({ success: true, message: "Sumber berhasil dihapus" });
    } catch (err) {
        console.error("deleteArticleSource error:", err);
        return res.status(500).json({ success: false, message: "Server gagal menghapus sumber" });
    }
};

/**
 * Digunakan oleh scheduled publish poller
 * Publish artikel yang scheduled_at <= NOW() secara atomic.
 * Return jumlah artikel yang dipublish.
 */
exports.runScheduledPublish = async () => {
    const now = new Date().toISOString();
    try {
        // Update atomic: hanya ubah status='scheduled' dengan scheduled_at <= now
        const { data, error } = await supabase
            .from("news_articles")
            .update({
                status:      "published",
                published_at: now,
                scheduled_at: null,
                updated_at:   now
            })
            .eq("status", "scheduled")
            .lte("scheduled_at", now)
            .select("id, title");

        if (error) {
            console.error("[scheduled-publish] DB error:", error);
            return 0;
        }

        if (data && data.length > 0) {
            console.log(`[scheduled-publish] Published ${data.length} artikel: ${data.map(a => `"${a.title}"`).join(", ")}`);
        }

        return (data && data.length) || 0;
    } catch (err) {
        console.error("[scheduled-publish] Unexpected error:", err);
        return 0;
    }
};

// Export internal functions for regression testing
exports._test = {
    sanitizeHtml,
    removeGeminiCitations
};
