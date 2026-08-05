const axios = require("axios");
const supabase = require("../config/db");
const { notify } = require("../config/notify");

// Hanya URL yang ditempel admin yang diambil. NexShop tidak pernah mencari
// atau mengambil artikel secara otomatis.
const TRUSTED_SOURCES = [
    { name: "IGN", domains: ["ign.com"] },
    { name: "GameSpot", domains: ["gamespot.com"] },
    { name: "PC Gamer", domains: ["pcgamer.com"] },
    { name: "Eurogamer", domains: ["eurogamer.net"] },
    { name: "Rock Paper Shotgun", domains: ["rockpapershotgun.com"] },
    { name: "Xbox Wire", domains: ["news.xbox.com"] },
    { name: "PlayStation Blog", domains: ["blog.playstation.com"] },
    { name: "Steam News", domains: ["steamcommunity.com", "store.steampowered.com"] },
    { name: "Ubisoft News", domains: ["news.ubisoft.com"] },
    { name: "EA News", domains: ["ea.com", "news.ea.com"] },
    { name: "Gematsu", domains: ["gematsu.com"] },
    { name: "Polygon", domains: ["polygon.com"] },
    { name: "VG247", domains: ["vg247.com"] },
    { name: "GameRant", domains: ["gamerant.com"] }
];

function asText(value, maxLength) {
    const text = typeof value === "string" ? value.trim() : "";
    return text.length <= maxLength ? text : "";
}

function parseHttpsUrl(value) {
    try {
        const url = new URL(String(value || "").trim());
        return url.protocol === "https:" && !url.username && !url.password ? url : null;
    } catch (err) {
        return null;
    }
}

function domainMatches(hostname, domain) {
    const normalizedHost = String(hostname || "").toLowerCase().replace(/\.$/, "");
    const normalizedDomain = domain.toLowerCase();
    return normalizedHost === normalizedDomain || normalizedHost.endsWith(`.${normalizedDomain}`);
}

function getTrustedSource(url) {
    return TRUSTED_SOURCES.find((source) => source.domains.some((domain) => domainMatches(url.hostname, domain))) || null;
}

function parseBoolean(value) {
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
    return null;
}

function toSortOrder(value) {
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 && number <= 100000 ? number : 0;
}

function newsDatabaseMessage(error, fallback) {
    const code = String(error && error.code || "");
    if (code === "23505") return "Artikel dari URL tersebut sudah ada";
    if (["42703", "PGRST204", "PGRST205"].includes(code)) {
        return "Database Gaming News belum diperbarui. Jalankan migration 16 dan migration 17 di Supabase, lalu muat ulang schema cache Supabase.";
    }
    if (code === "42501") return "Akses database ditolak. Periksa permission service key dan policy tabel gaming_news.";
    return fallback;
}

function validateNewsPayload(body) {
    const title = asText(body.title, 255);
    const summary = asText(body.summary, 200);
    const sourceUrl = parseHttpsUrl(body.source_url);
    const imageUrl = parseHttpsUrl(body.image_url);
    const publisherLogoUrl = body.publisher_logo_url ? parseHttpsUrl(body.publisher_logo_url) : null;
    const publishedAt = new Date(body.published_at);
    const source = sourceUrl && getTrustedSource(sourceUrl);
    const isActive = parseBoolean(body.is_active);
    const isHidden = parseBoolean(body.is_hidden);
    const isPinned = parseBoolean(body.is_pinned);
    const isFeatured = parseBoolean(body.is_featured);

    if (!title || !summary || !sourceUrl || !imageUrl || Number.isNaN(publishedAt.getTime())) {
        return { error: "Judul, ringkasan, URL artikel, gambar, dan tanggal terbit wajib valid" };
    }
    if (body.publisher_logo_url && !publisherLogoUrl) {
        return { error: "Logo publisher harus berupa URL HTTPS yang valid" };
    }
    if (summary.length < 100) {
        return { error: "Ringkasan harus terdiri dari 100–200 karakter" };
    }
    if (!source) {
        return { error: "URL artikel harus berasal dari publisher tepercaya NexShop" };
    }
    if ([isActive, isHidden, isPinned, isFeatured].some((value) => value === null)) {
        return { error: "Status berita tidak valid" };
    }

    return {
        value: {
            title,
            summary,
            source: source.name,
            source_url: sourceUrl.href,
            image_url: imageUrl.href,
            publisher_logo_url: publisherLogoUrl ? publisherLogoUrl.href : "",
            published_at: publishedAt.toISOString(),
            is_active: isActive,
            is_hidden: isHidden,
            is_pinned: isPinned,
            is_featured: isFeatured,
            sort_order: toSortOrder(body.sort_order)
        }
    };
}

function decodeHtml(value) {
    const entities = { amp: "&", quot: "\"", apos: "'", lt: "<", gt: ">", nbsp: " " };
    return String(value || "").replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (match, entity) => {
        const lower = entity.toLowerCase();
        if (lower.startsWith("#x")) return String.fromCodePoint(parseInt(lower.slice(2), 16));
        if (lower.startsWith("#")) return String.fromCodePoint(parseInt(lower.slice(1), 10));
        return entities[lower] || match;
    });
}

function cleanText(value) {
    return decodeHtml(String(value || "")
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim());
}

function truncateText(value, maxLength) {
    const text = cleanText(value);
    if (text.length <= maxLength) return text;
    const clipped = text.slice(0, maxLength - 1);
    const lastSpace = clipped.lastIndexOf(" ");
    return `${(lastSpace > 40 ? clipped.slice(0, lastSpace) : clipped).trim()}…`;
}

function parseTagAttributes(tag) {
    const attributes = {};
    const attrPattern = /([^\s=/>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;
    let match;
    while ((match = attrPattern.exec(tag))) {
        const key = match[1].toLowerCase();
        if (key === "meta" || key === "script" || key === "time") continue;
        const rawValue = match[2] || "";
        attributes[key] = rawValue.replace(/^("|')|("|')$/g, "");
    }
    return attributes;
}

function extractMeta(html, names) {
    const wanted = new Set(names.map((name) => name.toLowerCase()));
    const tags = html.match(/<meta\b[^>]*>/gi) || [];
    for (const tag of tags) {
        const attributes = parseTagAttributes(tag);
        const key = String(attributes.property || attributes.name || attributes.itemprop || "").toLowerCase();
        const content = cleanText(attributes.content);
        if (wanted.has(key) && content) return content;
    }
    return "";
}

function extractJsonLdObjects(html) {
    const objects = [];
    const scripts = html.match(/<script\b[^>]*type\s*=\s*(["'])application\/ld\+json\1[^>]*>[\s\S]*?<\/script>/gi) || [];
    for (const script of scripts) {
        const contentMatch = script.match(/>([\s\S]*?)<\/script>\s*$/i);
        if (!contentMatch) continue;
        try {
            const parsed = JSON.parse(decodeHtml(contentMatch[1]).trim());
            const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
            while (queue.length) {
                const item = queue.shift();
                if (!item || typeof item !== "object") continue;
                objects.push(item);
                if (Array.isArray(item["@graph"])) queue.push(...item["@graph"]);
            }
        } catch (err) {
            // Banyak publisher menyisipkan JSON-LD yang tidak strict. Meta tag
            // tetap menjadi fallback tanpa membuat seluruh preview gagal.
        }
    }
    return objects;
}

function firstJsonLdValue(objects, keys) {
    for (const item of objects) {
        for (const key of keys) {
            const value = item[key];
            if (Array.isArray(value) && value.length) {
                const first = value[0];
                if (typeof first === "string") return cleanText(first);
                if (first && typeof first === "object") return cleanText(first.url || first.contentUrl || "");
            }
            if (value && typeof value === "object") {
                const objectValue = value.url || value.contentUrl || value.name || "";
                if (objectValue) return cleanText(objectValue);
            }
            if (typeof value === "string") return cleanText(value);
        }
    }
    return "";
}

function extractTitleTag(html) {
    const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    return match ? cleanText(match[1]) : "";
}

function extractFirstParagraph(html) {
    const paragraphs = html.match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) || [];
    const candidates = paragraphs.map(cleanText).filter((text) => text.length >= 80);
    return candidates.sort((left, right) => left.length - right.length)[0] || "";
}

function compactSummary(value) {
    const text = cleanText(value);
    if (!text) return "";
    if (text.length <= 200) return text;
    const clipped = text.slice(0, 197);
    const lastSpace = clipped.lastIndexOf(" ");
    return `${(lastSpace > 100 ? clipped.slice(0, lastSpace) : clipped).trim()}…`;
}

function toAbsoluteHttpsUrl(value, baseUrl) {
    try {
        const rawValue = String(value || "").trim();
        if (!rawValue) return "";
        const url = new URL(rawValue, baseUrl);
        return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
    } catch (err) {
        return "";
    }
}

function extractPublishedAt(html, jsonLdObjects) {
    const raw = extractMeta(html, ["article:published_time", "date", "datepublished", "publish-date", "pubdate"])
        || firstJsonLdValue(jsonLdObjects, ["datePublished", "dateCreated"])
        || (() => {
            const match = html.match(/<time\b[^>]*datetime\s*=\s*(["'])(.*?)\1[^>]*>/i);
            return match ? match[2] : "";
        })();
    const date = new Date(raw);
    return raw && !Number.isNaN(date.getTime()) ? date.toISOString() : "";
}

async function fetchTrustedArticle(url) {
    let currentUrl = url;
    let source = getTrustedSource(currentUrl);
    for (let attempt = 0; attempt < 4; attempt += 1) {
        let response;
        try {
            response = await axios.get(currentUrl.href, {
                timeout: 12000,
                maxRedirects: 0,
                maxContentLength: 1500000,
                maxBodyLength: 1500000,
                responseType: "text",
                validateStatus: () => true,
                headers: {
                    "User-Agent": "NexShopNewsPreview/1.0 (+https://nexshop.cloud)",
                    "Accept": "text/html,application/xhtml+xml",
                    "Accept-Language": "id-ID,id;q=0.9,en;q=0.8"
                }
            });
        } catch (err) {
            if (err.code === "ERR_BAD_RESPONSE" && /maxContentLength/i.test(err.message || "")) {
                throw new Error("Halaman publisher terlalu besar untuk dipreview");
            }
            throw new Error("NexShop tidak dapat mengambil halaman dari publisher tersebut");
        }

        if (response.status >= 300 && response.status < 400 && response.headers.location) {
            let nextUrl = null;
            try {
                nextUrl = parseHttpsUrl(new URL(response.headers.location, currentUrl).href);
            } catch (err) {
                throw new Error("Publisher memberikan redirect URL yang tidak valid");
            }
            const nextSource = nextUrl && getTrustedSource(nextUrl);
            if (!nextUrl || !nextSource || nextSource.name !== source.name) {
                throw new Error("Redirect URL tidak berasal dari publisher tepercaya yang sama");
            }
            currentUrl = nextUrl;
            source = nextSource;
            continue;
        }
        if (response.status < 200 || response.status >= 300) {
            throw new Error(`Publisher mengembalikan status ${response.status}`);
        }
        const contentType = String(response.headers["content-type"] || "").toLowerCase();
        if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
            throw new Error("URL tersebut bukan halaman artikel HTML");
        }
        return { html: String(response.data || ""), finalUrl: currentUrl, source };
    }
    throw new Error("Terlalu banyak redirect dari publisher");
}

function extractArticlePreview(html, finalUrl, source) {
    const jsonLdObjects = extractJsonLdObjects(html);
    const title = truncateText(
        extractMeta(html, ["og:title", "twitter:title"])
        || firstJsonLdValue(jsonLdObjects, ["headline", "name"])
        || extractTitleTag(html),
        255
    );
    const imageUrl = toAbsoluteHttpsUrl(
        extractMeta(html, ["og:image:secure_url", "og:image", "twitter:image", "twitter:image:src"])
        || firstJsonLdValue(jsonLdObjects, ["image", "thumbnailUrl"]),
        finalUrl
    );
    const description = extractMeta(html, ["og:description", "twitter:description", "description"])
        || firstJsonLdValue(jsonLdObjects, ["description"])
        || extractFirstParagraph(html);
    const summary = compactSummary(description);
    const publishedAt = extractPublishedAt(html, jsonLdObjects);
    const missing = [];
    if (!title) missing.push("judul artikel");
    if (!imageUrl) missing.push("gambar utama");
    if (!publishedAt) missing.push("tanggal publikasi");
    if (!summary || summary.length < 100) missing.push("ringkasan 100–200 karakter");
    if (missing.length) {
        return { error: `Metadata tidak lengkap: ${missing.join(", ")}. Periksa URL artikel atau isi data secara manual.` };
    }
    return {
        data: {
            title,
            summary,
            source: source.name,
            source_url: finalUrl.href,
            image_url: imageUrl,
            published_at: publishedAt,
            is_active: true,
            is_hidden: false,
            is_pinned: false,
            is_featured: false,
            sort_order: 0
        }
    };
}

exports.previewNews = async (req, res) => {
    const articleUrl = parseHttpsUrl(req.body && req.body.url);
    if (!articleUrl) return res.status(400).json({ message: "Masukkan URL HTTPS artikel yang valid" });
    const source = getTrustedSource(articleUrl);
    if (!source) return res.status(400).json({ message: "URL bukan dari publisher tepercaya NexShop" });
    try {
        const { html, finalUrl, source: finalSource } = await fetchTrustedArticle(articleUrl);
        const preview = extractArticlePreview(html, finalUrl, finalSource);
        if (preview.error) return res.status(422).json({ message: preview.error });
        res.json({ message: "Metadata artikel berhasil diekstrak", data: preview.data });
    } catch (err) {
        console.error("Gaming news preview error:", err.message);
        res.status(422).json({ message: err.message || "Metadata artikel tidak dapat diekstrak" });
    }
};

exports.getPublicNews = async (req, res) => {
    try {
        const { data, error } = await supabase.from("gaming_news")
            .select("id, title, summary, source, source_url, image_url, published_at, is_pinned, is_featured")
            .eq("is_active", true).eq("is_hidden", false)
            .order("is_pinned", { ascending: false })
            .order("is_featured", { ascending: false })
            .order("sort_order", { ascending: true })
            .order("published_at", { ascending: false }).limit(12);
        if (error) return res.status(500).json({ message: "Gagal memuat berita game" });
        res.json(data || []);
    } catch (err) {
        console.error("Gaming news public error:", err);
        res.status(500).json({ message: "Server Error" });
    }
};

exports.getAllNews = async (req, res) => {
    try {
        const { data, error } = await supabase.from("gaming_news").select("*")
            .order("is_pinned", { ascending: false })
            .order("is_featured", { ascending: false })
            .order("published_at", { ascending: false });
        if (error) return res.status(500).json({ message: "Gagal memuat berita game" });
        res.json(data || []);
    } catch (err) {
        console.error("Gaming news admin error:", err);
        res.status(500).json({ message: "Server Error" });
    }
};

exports.createNews = async (req, res) => {
    const result = validateNewsPayload(req.body || {});
    if (result.error) return res.status(400).json({ message: result.error });
    try {
        const { data, error } = await supabase.from("gaming_news").insert([result.value]).select().single();
        if (error && error.code === "23505") return res.status(409).json({ message: "Artikel dari URL tersebut sudah ada" });
        if (error) return res.status(500).json({ message: "Gagal menyimpan berita game" });
        notify("news", `${req.user.email} menambahkan berita game: "${data.title}"`);
        res.status(201).json({ message: "Berita game berhasil disimpan", data });
    } catch (err) {
        console.error("Gaming news create error:", err);
        res.status(500).json({ message: "Server Error" });
    }
};

exports.updateNews = async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ message: "ID berita tidak valid" });
    const result = validateNewsPayload(req.body || {});
    if (result.error) return res.status(400).json({ message: result.error });
    try {
        const { data, error } = await supabase.from("gaming_news")
            .update({ ...result.value, updated_at: new Date().toISOString() }).eq("id", id).select().single();
        if (error && error.code === "23505") return res.status(409).json({ message: "Artikel dari URL tersebut sudah ada" });
        if (error && error.code !== "PGRST116") return res.status(500).json({ message: "Gagal memperbarui berita game" });
        if (!data) return res.status(404).json({ message: "Berita game tidak ditemukan" });
        notify("news", `${req.user.email} memperbarui berita game: "${data.title}"`);
        res.json({ message: "Berita game berhasil diperbarui", data });
    } catch (err) {
        console.error("Gaming news update error:", err);
        res.status(500).json({ message: "Server Error" });
    }
};

exports.updateNewsFlags = async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ message: "ID berita tidak valid" });
    const changes = {};
    ["is_active", "is_hidden", "is_pinned", "is_featured"].forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) {
            const value = parseBoolean(req.body[key]);
            if (value !== null) changes[key] = value;
        }
    });
    if (!Object.keys(changes).length || Object.keys(changes).length !== Object.keys(req.body || {}).length) {
        return res.status(400).json({ message: "Perubahan status berita tidak valid" });
    }
    try {
        const { data, error } = await supabase.from("gaming_news")
            .update({ ...changes, updated_at: new Date().toISOString() }).eq("id", id).select().single();
        if (error && error.code !== "PGRST116") return res.status(500).json({ message: "Gagal memperbarui status berita" });
        if (!data) return res.status(404).json({ message: "Berita game tidak ditemukan" });
        res.json({ message: "Status berita berhasil diperbarui", data });
    } catch (err) {
        console.error("Gaming news flag update error:", err);
        res.status(500).json({ message: "Server Error" });
    }
};

exports.deleteNews = async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ message: "ID berita tidak valid" });
    try {
        const { data, error } = await supabase.from("gaming_news").delete().eq("id", id).select("title").single();
        if (error && error.code !== "PGRST116") return res.status(500).json({ message: "Gagal menghapus berita game" });
        if (!data) return res.status(404).json({ message: "Berita game tidak ditemukan" });
        notify("news", `${req.user.email} menghapus berita game: "${data.title}"`);
        res.json({ message: "Berita game berhasil dihapus" });
    } catch (err) {
        console.error("Gaming news delete error:", err);
        res.status(500).json({ message: "Server Error" });
    }
};

exports.TRUSTED_SOURCES = TRUSTED_SOURCES.map((source) => source.name);
