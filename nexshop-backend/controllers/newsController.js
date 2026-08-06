const axios = require("axios");
const dns = require("dns");
const net = require("net");
const http = require("http");
const https = require("https");
const supabase = require("../config/db");
const { notify } = require("../config/notify");
const { getApiKeys } = require("../config/settings");

const MAX_IMPORT_BYTES = 1500000;
const SUMMARY_MIN_WORDS = 100;
const SUMMARY_MAX_WORDS = 600;

function asText(value, maxLength) {
    const text = typeof value === "string" ? value.trim() : "";
    return text.length <= maxLength ? text : "";
}

function parseHttpsUrl(value) {
    try {
        const url = new URL(String(value || "").trim());
        if (url.protocol !== "https:" || url.username || url.password) return null;
        if (net.isIP(url.hostname) && isBlockedNewsImportIp(url.hostname)) return null;
        return url;
    } catch (err) {
        return null;
    }
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

function wordCount(value) {
    return String(value || "").trim().split(/\s+/).filter(Boolean).length;
}

function normalizeTags(value) {
    const values = Array.isArray(value) ? value : String(value || "").split(",");
    return [...new Set(values.map((tag) => truncateText(tag, 40)).filter(Boolean))].slice(0, 8);
}

// Semua blok di bawah ini bukan alamat publik yang aman untuk di-fetch.
// Resolver tetap universal: publisher mana pun diperbolehkan selama DNS-nya
// menghasilkan alamat IP publik.
const blockedNewsImportIps = new net.BlockList();
[
    ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
    ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
    ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
    ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]
].forEach(([address, prefix]) => blockedNewsImportIps.addSubnet(address, prefix, "ipv4"));
[
    ["::", 128], ["::1", 128], ["100::", 64], ["2001:2::", 48], ["2001:10::", 28],
    ["2001:db8::", 32], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]
].forEach(([address, prefix]) => blockedNewsImportIps.addSubnet(address, prefix, "ipv6"));

function isBlockedNewsImportIp(address) {
    const family = net.isIP(address);
    if (!family) return true;
    return blockedNewsImportIps.check(address, family === 4 ? "ipv4" : "ipv6");
}

function safeLookup(hostname, options, callback) {
    const lookupOptions = typeof options === "function" ? {} : (options || {});
    const done = typeof options === "function" ? options : callback;
    if (typeof done !== "function") throw new TypeError("DNS lookup callback tidak tersedia");

    // Selalu ambil IPv4 dan IPv6 terlebih dahulu. Ini mencegah kegagalan jika
    // salah satu family diblokir atau tidak tersedia, lalu family lainnya tetap
    // dapat digunakan oleh Axios/Node.
    dns.lookup(hostname, { all: true, verbatim: true, family: 0 }, (dnsError, records) => {
        if (dnsError) return done(dnsError); // pertahankan ENOTFOUND, EAI_AGAIN, dll.

        const publicRecords = (records || []).filter((record) => record && record.address && !isBlockedNewsImportIp(record.address));
        if (!publicRecords.length) {
            const error = new Error("Host URL mengarah ke alamat privat, loopback, link-local, multicast, atau reserved");
            error.code = "EHOSTUNREACH";
            return done(error);
        }

        const preferredFamily = Number(lookupOptions.family) || 0;
        const orderedRecords = preferredFamily
            ? [...publicRecords.filter((record) => record.family === preferredFamily), ...publicRecords.filter((record) => record.family !== preferredFamily)]
            : publicRecords;

        // Node mengirim options.all=true pada beberapa jalur Agent. Pada mode
        // ini callback WAJIB menerima array records, bukan address tunggal.
        if (lookupOptions.all) return done(null, orderedRecords);

        const selected = orderedRecords[0];
        if (!selected || !selected.address) {
            const error = new Error("DNS tidak menghasilkan alamat publik yang valid");
            error.code = "ENOTFOUND";
            return done(error);
        }
        return done(null, selected.address, selected.family);
    });
}

const safeHttpAgent = new http.Agent({ keepAlive: false, lookup: safeLookup });
const safeHttpsAgent = new https.Agent({ keepAlive: false, lookup: safeLookup });

function diagnosticBody(value) {
    if (value === undefined || value === null) return value;
    if (typeof value === "string") return value.slice(0, 10000);
    try {
        return JSON.stringify(value).slice(0, 10000);
    } catch (err) {
        return "[Response body tidak dapat diserialisasi]";
    }
}

function diagnosticHeaders(headers) {
    if (!headers) return undefined;
    if (typeof headers.toJSON === "function") return headers.toJSON();
    return headers;
}

function originalImportError(err) {
    return err && (err.originalError || err.cause) || err;
}

function logNewsPreviewError(err, requestedUrl) {
    const original = originalImportError(err) || {};
    const response = original.response || err.response;
    const details = {
        name: original.name || err.name,
        message: original.message || err.message,
        code: original.code || err.code,
        stack: original.stack || err.stack,
        status: response && response.status || original.status || err.status,
        requestedUrl: original.config && original.config.url || err.requestedUrl || requestedUrl,
        responseHeaders: diagnosticHeaders(response && response.headers),
        responseBody: diagnosticBody(response && response.data)
    };
    console.error("Gaming news preview error (full exception):", err);
    console.error("Gaming news preview error message:", err && err.message);
    console.error("Gaming news preview error stack:", err && err.stack);
    console.error("Gaming news preview diagnostics:", details);
    return details;
}

function developmentPreviewMessage(err, details) {
    const reason = details.message || err.message || "Metadata artikel tidak dapat diekstrak";
    const status = details.status ? `HTTP ${details.status}` : "";
    const code = details.code ? `(${details.code})` : "";
    return [status, reason, code].filter(Boolean).join(" ");
}

function createImportFetchError(message, originalError, requestedUrl) {
    const error = new Error(message, { cause: originalError });
    error.name = "NewsImportFetchError";
    error.originalError = originalError;
    error.requestedUrl = requestedUrl;
    return error;
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
        if (["meta", "link", "script", "time"].includes(key)) continue;
        attributes[key] = (match[2] || "").replace(/^("|')|("|')$/g, "");
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

function extractLinkHref(html, relations) {
    const wanted = new Set(relations.map((relation) => relation.toLowerCase()));
    const tags = html.match(/<link\b[^>]*>/gi) || [];
    for (const tag of tags) {
        const attributes = parseTagAttributes(tag);
        const rel = String(attributes.rel || "").toLowerCase().split(/\s+/);
        if (rel.some((value) => wanted.has(value)) && attributes.href) return attributes.href;
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
            // Metadata tag tetap menjadi fallback jika JSON-LD publisher tidak strict.
        }
    }
    return objects;
}

function jsonLdValue(objects, keys) {
    for (const item of objects) {
        for (const key of keys) {
            const value = item[key];
            if (Array.isArray(value) && value.length) {
                const first = value[0];
                if (typeof first === "string") return cleanText(first);
                if (first && typeof first === "object") return cleanText(first.url || first.contentUrl || first.name || "");
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

function jsonLdPublisher(objects) {
    for (const item of objects) {
        const publisher = item.publisher || item.provider || item.author;
        const first = Array.isArray(publisher) ? publisher[0] : publisher;
        if (typeof first === "string" && first.trim()) return { name: cleanText(first), logo: "" };
        if (first && typeof first === "object") {
            const logo = first.logo && typeof first.logo === "object" ? (first.logo.url || first.logo.contentUrl) : first.logo;
            if (first.name || logo) return { name: cleanText(first.name || ""), logo: cleanText(logo || "") };
        }
    }
    return { name: "", logo: "" };
}

function extractTitleTag(html) {
    const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    return match ? cleanText(match[1]) : "";
}

function extractFirstParagraph(html) {
    const paragraphs = html.match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) || [];
    return paragraphs.map(cleanText).filter((text) => text.length >= 60).sort((a, b) => b.length - a.length)[0] || "";
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
        || jsonLdValue(jsonLdObjects, ["datePublished", "dateCreated"])
        || (() => {
            const match = html.match(/<time\b[^>]*datetime\s*=\s*(["'])(.*?)\1[^>]*>/i);
            return match ? match[2] : "";
        })();
    const date = new Date(raw);
    return raw && !Number.isNaN(date.getTime()) ? date.toISOString() : "";
}

function publisherFromHost(url) {
    return url.hostname.replace(/^www\./i, "").split(".").slice(0, -1).join(".") || url.hostname;
}

function buildPublisherLogo(html, jsonLdObjects, baseUrl) {
    const publisher = jsonLdPublisher(jsonLdObjects);
    return toAbsoluteHttpsUrl(
        extractMeta(html, ["og:logo", "twitter:site:logo", "logo"])
        || publisher.logo
        || extractLinkHref(html, ["icon", "shortcut icon", "apple-touch-icon"]),
        baseUrl
    );
}

function detectCategory(html, jsonLdObjects) {
    return truncateText(
        extractMeta(html, ["article:section", "article:tag", "category", "keywords"])
        || jsonLdValue(jsonLdObjects, ["articleSection", "genre", "keywords"])
        || "Gaming",
        80
    ) || "Gaming";
}

function detectTags(html, jsonLdObjects, category) {
    return normalizeTags(
        extractMeta(html, ["article:tag", "keywords", "news_keywords"])
        || jsonLdValue(jsonLdObjects, ["keywords", "articleSection", "genre"])
        || category
    );
}

function isLikelyIndonesian(value, html) {
    const locale = extractMeta(html, ["og:locale", "language"]).toLowerCase();
    if (locale.startsWith("id")) return true;
    return /\b(yang|dan|untuk|dengan|dari|pada|akan|berita|game|ini)\b/i.test(value);
}

function wordsAtMost(value, maxWords) {
    return String(value || "").trim().split(/\s+/).filter(Boolean).slice(0, maxWords).join(" ");
}

function cleanNewsSummary(value) {
    if (!value) return "";
    let text = decodeHtml(String(value))
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<[^>]*>/g, " ")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n");

    // Hapus frasa pengantar AI konvensional
    text = text.replace(/^(berikut (adalah|ringkasan|ulasan)|dalam berita ini|sebagai model ai|artikel ini membahas)[\s\S]*?:\s*/i, "");
    text = text.replace(/^(berikut (adalah|ringkasan|ulasan)|dalam berita ini|sebagai model ai)[\s\S]*?\n+/i, "");

    const paragraphs = text
        .split(/\n\s*\n+/)
        .map((p) => p.replace(/\s+/g, " ").trim())
        .filter((p) => p.length > 20 && !/^(ringkasan ini dibuat saat|sebagai model ai|metadata di bawah)/i.test(p));

    return paragraphs.join("\n\n");
}

function metadataSummaryFallback({ title, description, publisher }) {
    const pubName = publisher || "Publisher";
    const descText = wordsAtMost(description, 120) || `Kabar terbaru mengenai ${title}.`;
    return [
        `Berita utama dari ${pubName} membahas mengenai ${title}. ${descText}`,
        `Pengumuman ini memberikan wawasan penting bagi para gamer dan komunitas yang mengikuti perkembangan industri gaming terkini. Untuk membaca artikel selengkapnya dan melihat materi resmi, pembaca dapat mengakses tautan sumber asli dari ${pubName}.`
    ].join("\n\n");
}

function geminiOutputText(payload) {
    const candidates = payload && Array.isArray(payload.candidates) ? payload.candidates : [];
    return candidates.flatMap((candidate) => candidate && candidate.content && Array.isArray(candidate.content.parts) ? candidate.content.parts : [])
        .map((part) => part && part.text)
        .filter((text) => typeof text === "string")
        .join("\n");
}

async function generateIndonesianSummary({ title, description, publisher, isIndonesian }) {
    const fallback = metadataSummaryFallback({ title, description, publisher });
    try {
        const keys = await getApiKeys();
        const apiKey = keys.gemini_api_key || process.env.GEMINI_API_KEY;
        if (!apiKey) return fallback;
        const model = String(keys.gemini_news_model || process.env.GEMINI_NEWS_MODEL || "gemini-2.5-flash").trim();
        if (!/^[a-zA-Z0-9._-]{1,100}$/.test(model)) return fallback;
        const sourceLanguage = isIndonesian ? "Indonesia" : "Inggris";
        const prompt = `Buat ringkasan berita gaming profesional dalam bahasa Indonesia alami sebanyak 150 sampai 400 kata yang terdiri dari 2 hingga 4 paragraf rapi (pisahkan antar paragraf dengan dua kali baris baru).

Aturan penting:
1. Langsung tulis isi berita tanpa pengantar.
2. DILARANG membuat kata pembuka seperti "Berikut adalah...", "Dalam artikel ini...", atau "Sebagai AI...".
3. DILARANG mencantumkan teks sanggahan (disclaimer) atau penyebutan metadata AI.
4. Pertahankan nama game, studio, platform, tokoh, dan istilah gaming resmi.

Publisher: ${publisher}
Bahasa sumber: ${sourceLanguage}
Judul: ${title}
Deskripsi Sumber: ${description}`;

        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
            {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.2, maxOutputTokens: 900 }
            },
            { timeout: 20000, headers: { "Content-Type": "application/json" } }
        );
        const rawText = geminiOutputText(response.data);
        const summary = cleanNewsSummary(rawText);
        const count = wordCount(summary);
        return count >= SUMMARY_MIN_WORDS && count <= SUMMARY_MAX_WORDS ? summary : fallback;
    } catch (err) {
        console.warn("Gemini news summary unavailable; using metadata fallback:", err.response && err.response.status || err.code || err.message);
        return fallback;
    }
}

async function fetchArticle(url) {
    let currentUrl = url;
    for (let attempt = 0; attempt < 4; attempt += 1) {
        let response;
        try {
            response = await axios.get(currentUrl.href, {
                timeout: 15000,
                maxRedirects: 0,
                maxContentLength: MAX_IMPORT_BYTES,
                maxBodyLength: MAX_IMPORT_BYTES,
                responseType: "text",
                validateStatus: () => true,
                httpAgent: safeHttpAgent,
                httpsAgent: safeHttpsAgent,
                headers: {
                    "User-Agent": "NexShopNewsPreview/2.0 (+https://nexshop.cloud)",
                    Accept: "text/html,application/xhtml+xml",
                    "Accept-Language": "id-ID,id;q=0.9,en;q=0.8"
                }
            });
        } catch (err) {
            if (err.code === "ERR_BAD_RESPONSE" && /maxContentLength/i.test(err.message || "")) {
                throw createImportFetchError("Halaman publisher terlalu besar untuk dipreview", err, currentUrl.href);
            }
            throw createImportFetchError(
                err.message && /privat|internal|Hostname/i.test(err.message)
                    ? err.message
                    : "NexShop tidak dapat mengambil halaman dari URL tersebut",
                err,
                currentUrl.href
            );
        }
        if (response.status >= 300 && response.status < 400 && response.headers.location) {
            const nextUrl = parseHttpsUrl(new URL(response.headers.location, currentUrl).href);
            if (!nextUrl) throw new Error("Publisher memberikan redirect HTTPS yang tidak valid");
            currentUrl = nextUrl;
            continue;
        }
        if (response.status < 200 || response.status >= 300) {
            const error = new Error(`Publisher mengembalikan status ${response.status}`);
            error.name = "NewsImportHttpError";
            error.status = response.status;
            error.response = response;
            error.requestedUrl = currentUrl.href;
            throw error;
        }
        const contentType = String(response.headers["content-type"] || "").toLowerCase();
        if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
            const error = new Error("URL tersebut bukan halaman artikel HTML");
            error.name = "NewsImportContentTypeError";
            error.status = response.status;
            error.response = response;
            error.requestedUrl = currentUrl.href;
            throw error;
        }
        return { html: String(response.data || ""), finalUrl: currentUrl };
    }
    throw new Error("Terlalu banyak redirect dari publisher");
}

async function extractArticlePreview(html, originalUrl, finalUrl) {
    const jsonLdObjects = extractJsonLdObjects(html);
    const canonicalUrl = toAbsoluteHttpsUrl(extractLinkHref(html, ["canonical"]) || finalUrl.href, finalUrl);
    const title = truncateText(
        extractMeta(html, ["og:title"])
        || jsonLdValue(jsonLdObjects, ["headline", "name"])
        || extractMeta(html, ["twitter:title"])
        || extractMeta(html, ["title", "headline"])
        || extractTitleTag(html),
        255
    );
    const imageUrl = toAbsoluteHttpsUrl(
        extractMeta(html, ["og:image:secure_url", "og:image"])
        || jsonLdValue(jsonLdObjects, ["image", "thumbnailUrl"])
        || extractMeta(html, ["twitter:image", "twitter:image:src"])
        || extractMeta(html, ["image", "thumbnail", "thumbnailurl"]),
        finalUrl
    );
    const publisherJson = jsonLdPublisher(jsonLdObjects);
    const source = truncateText(
        extractMeta(html, ["og:site_name", "application-name", "publisher"])
        || publisherJson.name
        || publisherFromHost(finalUrl),
        80
    );
    const description = truncateText(
        extractMeta(html, ["og:description"])
        || jsonLdValue(jsonLdObjects, ["description"])
        || extractMeta(html, ["twitter:description"])
        || extractMeta(html, ["description"])
        || extractFirstParagraph(html),
        1200
    );
    const publishedAt = extractPublishedAt(html, jsonLdObjects);
    const publisherLogoUrl = buildPublisherLogo(html, jsonLdObjects, finalUrl);
    const category = detectCategory(html, jsonLdObjects);
    const missing = [];
    if (!title) missing.push("judul artikel");
    if (!imageUrl) missing.push("gambar utama");
    if (!description) missing.push("deskripsi artikel");
    if (!publishedAt) missing.push("tanggal publikasi");
    if (missing.length) return { error: `Metadata tidak lengkap: ${missing.join(", ")}. Gunakan URL artikel lain dari publisher tepercaya.` };

    const summary = await generateIndonesianSummary({
        title,
        description,
        publisher: source,
        isIndonesian: isLikelyIndonesian(`${title} ${description}`, html)
    });
    return {
        data: {
            title,
            summary,
            source,
            source_url: originalUrl.href,
            canonical_url: canonicalUrl || finalUrl.href,
            image_url: imageUrl,
            publisher_logo_url: publisherLogoUrl,
            published_at: publishedAt,
            category,
            tags: detectTags(html, jsonLdObjects, category),
            is_active: false,
            is_hidden: false,
            is_pinned: false,
            is_featured: false,
            sort_order: 0
        }
    };
}

function validateNewsPayload(body) {
    const title = asText(body.title, 255);
    const summary = asText(body.summary, 6000);
    const source = asText(body.source, 80);
    const sourceUrl = parseHttpsUrl(body.source_url);
    const canonicalUrl = parseHttpsUrl(body.canonical_url || body.source_url);
    const imageUrl = parseHttpsUrl(body.image_url);
    const publisherLogoUrl = body.publisher_logo_url ? parseHttpsUrl(body.publisher_logo_url) : null;
    const category = asText(body.category || "Gaming", 80);
    const tags = normalizeTags(body.tags);
    const publishedAt = new Date(body.published_at);
    const isActive = parseBoolean(body.is_active);
    const isHidden = parseBoolean(body.is_hidden);
    const isPinned = parseBoolean(body.is_pinned);
    const isFeatured = parseBoolean(body.is_featured);
    const summaryWords = wordCount(summary);

    if (!title || !summary || !source || !sourceUrl || !canonicalUrl || !imageUrl || !category || Number.isNaN(publishedAt.getTime())) {
        return { error: "Judul, ringkasan, publisher, URL asli, URL canonical, gambar, kategori, dan tanggal terbit wajib valid" };
    }
    if (summaryWords < SUMMARY_MIN_WORDS || summaryWords > SUMMARY_MAX_WORDS) {
        return { error: "Ringkasan harus berisi 300–600 kata" };
    }
    if (body.publisher_logo_url && !publisherLogoUrl) return { error: "Logo publisher harus berupa URL HTTPS yang valid" };
    if ([isActive, isHidden, isPinned, isFeatured].some((value) => value === null)) return { error: "Status berita tidak valid" };

    return {
        value: {
            title,
            summary,
            source,
            source_url: sourceUrl.href,
            canonical_url: canonicalUrl.href,
            image_url: imageUrl.href,
            publisher_logo_url: publisherLogoUrl ? publisherLogoUrl.href : "",
            category,
            tags,
            published_at: publishedAt.toISOString(),
            is_active: isActive,
            is_hidden: isHidden,
            is_pinned: isPinned,
            is_featured: isFeatured,
            sort_order: toSortOrder(body.sort_order)
        }
    };
}

function newsDatabaseMessage(error, fallback) {
    const code = String(error && error.code || "");
    if (code === "23505") return "Artikel yang sama sudah ada. Periksa URL asli atau canonical URL.";
    if (["42703", "PGRST204", "PGRST205", "42P01"].includes(code)) {
        return "Database Gaming News belum sesuai. Jalankan migrations-17-gaming-news-production.sql dan migrations-19-gaming-news-detail-experience.sql di Supabase SQL Editor, lalu refresh schema cache.";
    }
    if (code === "42501") return "Akses database ditolak. Pastikan backend memakai SUPABASE_SERVICE_KEY dan jalankan migration Gaming News.";
    return fallback;
}

function databaseError(res, error, fallback) {
    console.error("Gaming news database error:", error);
    return res.status(500).json({ message: newsDatabaseMessage(error, fallback), code: error && error.code });
}

async function findDuplicate(urls) {
    const candidates = [...new Set(urls.filter(Boolean))];
    if (!candidates.length) return null;
    const [sourceResult, canonicalResult] = await Promise.all([
        supabase.from("gaming_news").select("id, title, source_url, canonical_url").in("source_url", candidates).limit(1),
        supabase.from("gaming_news").select("id, title, source_url, canonical_url").in("canonical_url", candidates).limit(1)
    ]);
    if (sourceResult.error) throw sourceResult.error;
    if (canonicalResult.error) throw canonicalResult.error;
    return (sourceResult.data && sourceResult.data[0]) || (canonicalResult.data && canonicalResult.data[0]) || null;
}

exports.previewNews = async (req, res) => {
    const articleUrl = parseHttpsUrl(req.body && req.body.url);
    if (!articleUrl) return res.status(400).json({ message: "Masukkan satu URL HTTPS artikel yang valid" });
    try {
        const { html, finalUrl } = await fetchArticle(articleUrl);
        const preview = await extractArticlePreview(html, articleUrl, finalUrl);
        if (preview.error) return res.status(422).json({ message: preview.error });
        const duplicate = await findDuplicate([preview.data.source_url, preview.data.canonical_url]);
        if (duplicate) return res.status(409).json({ message: `Artikel duplikat: “${duplicate.title}” sudah ada di News Manager.`, duplicate });
        return res.json({ message: "Metadata artikel dan ringkasan Indonesia berhasil dibuat", data: preview.data });
    } catch (err) {
        const details = logNewsPreviewError(err, articleUrl.href);
        const isDevelopment = process.env.NODE_ENV !== "production";
        return res.status(422).json({
            message: isDevelopment ? developmentPreviewMessage(err, details) : (err.message || "Metadata artikel tidak dapat diekstrak"),
            ...(isDevelopment ? { error: details } : {})
        });
    }
};

exports.getPublicNews = async (req, res) => {
    try {
        const { data, error } = await supabase.from("gaming_news")
            .select("id, title, summary, source, source_url, canonical_url, image_url, publisher_logo_url, category, tags, published_at, is_pinned, is_featured")
            .eq("is_active", true).eq("is_hidden", false)
            .order("is_pinned", { ascending: false })
            .order("is_featured", { ascending: false })
            .order("sort_order", { ascending: true })
            .order("published_at", { ascending: false }).limit(50);
        if (error) return databaseError(res, error, "Gagal memuat berita game");
        return res.json(data || []);
    } catch (err) {
        console.error("Gaming news public error:", err);
        return res.status(500).json({ message: "Server gagal memuat berita game" });
    }
};

exports.getAllNews = async (req, res) => {
    try {
        const { data, error } = await supabase.from("gaming_news").select("*")
            .order("is_pinned", { ascending: false })
            .order("is_featured", { ascending: false })
            .order("published_at", { ascending: false });
        if (error) return databaseError(res, error, "Gagal memuat berita game");
        return res.json(data || []);
    } catch (err) {
        console.error("Gaming news admin error:", err);
        return res.status(500).json({ message: "Server gagal memuat News Manager" });
    }
};

exports.createNews = async (req, res) => {
    const result = validateNewsPayload(req.body || {});
    if (result.error) return res.status(400).json({ message: result.error });
    try {
        const duplicate = await findDuplicate([result.value.source_url, result.value.canonical_url]);
        if (duplicate) return res.status(409).json({ message: `Artikel duplikat: “${duplicate.title}” sudah ada.`, duplicate });
        const { data, error } = await supabase.from("gaming_news").insert([result.value]).select().single();
        if (error) return databaseError(res, error, "Gagal menyimpan berita game");
        notify("news", `${req.user.email} menambahkan berita game: "${data.title}"`);
        return res.status(201).json({
            message: data.is_active && !data.is_hidden ? "Berita game berhasil disimpan dan dipublikasikan" : "Berita game berhasil disimpan sebagai draft",
            data
        });
    } catch (err) {
        if (err && err.code) return databaseError(res, err, "Gagal menyimpan berita game");
        console.error("Gaming news create error:", err);
        return res.status(500).json({ message: "Server gagal menyimpan berita game" });
    }
};

exports.updateNews = async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ message: "ID berita tidak valid" });
    const result = validateNewsPayload(req.body || {});
    if (result.error) return res.status(400).json({ message: result.error });
    try {
        const duplicate = await findDuplicate([result.value.source_url, result.value.canonical_url]);
        if (duplicate && Number(duplicate.id) !== id) return res.status(409).json({ message: `Artikel duplikat: “${duplicate.title}” sudah ada.`, duplicate });
        const { data, error } = await supabase.from("gaming_news")
            .update(result.value).eq("id", id).select().single();
        if (error && error.code === "PGRST116") return res.status(404).json({ message: "Berita game tidak ditemukan" });
        if (error) return databaseError(res, error, "Gagal memperbarui berita game");
        notify("news", `${req.user.email} memperbarui berita game: "${data.title}"`);
        return res.json({ message: "Berita game berhasil diperbarui", data });
    } catch (err) {
        if (err && err.code) return databaseError(res, err, "Gagal memperbarui berita game");
        console.error("Gaming news update error:", err);
        return res.status(500).json({ message: "Server gagal memperbarui berita game" });
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
        const { data, error } = await supabase.from("gaming_news").update(changes).eq("id", id).select().single();
        if (error && error.code === "PGRST116") return res.status(404).json({ message: "Berita game tidak ditemukan" });
        if (error) return databaseError(res, error, "Gagal memperbarui status berita");
        return res.json({ message: "Status berita berhasil diperbarui", data });
    } catch (err) {
        console.error("Gaming news flag update error:", err);
        return res.status(500).json({ message: "Server gagal memperbarui status berita" });
    }
};

exports.bulkUpdateNews = async (req, res) => {
    const ids = Array.isArray(req.body && req.body.ids) ? [...new Set(req.body.ids.map(Number))] : [];
    const action = String(req.body && req.body.action || "");
    if (!ids.length || ids.some((id) => !Number.isInteger(id) || id < 1) || ids.length > 100) {
        return res.status(400).json({ message: "Pilih 1–100 berita yang valid" });
    }
    const updates = {
        publish: { is_active: true, is_hidden: false },
        unpublish: { is_active: false },
        hide: { is_hidden: true }
    };
    try {
        if (action === "delete") {
            const { error } = await supabase.from("gaming_news").delete().in("id", ids);
            if (error) return databaseError(res, error, "Gagal menghapus berita terpilih");
            return res.json({ message: `${ids.length} berita berhasil dihapus` });
        }
        if (!updates[action]) return res.status(400).json({ message: "Aksi bulk tidak valid" });
        const { error } = await supabase.from("gaming_news").update(updates[action]).in("id", ids);
        if (error) return databaseError(res, error, "Gagal memperbarui berita terpilih");
        return res.json({ message: `${ids.length} berita berhasil diperbarui` });
    } catch (err) {
        console.error("Gaming news bulk update error:", err);
        return res.status(500).json({ message: "Server gagal menjalankan aksi bulk berita" });
    }
};

exports.deleteNews = async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ message: "ID berita tidak valid" });
    try {
        const { data, error } = await supabase.from("gaming_news").delete().eq("id", id).select("title").single();
        if (error && error.code === "PGRST116") return res.status(404).json({ message: "Berita game tidak ditemukan" });
        if (error) return databaseError(res, error, "Gagal menghapus berita game");
        notify("news", `${req.user.email} menghapus berita game: "${data.title}"`);
        return res.json({ message: "Berita game berhasil dihapus" });
    } catch (err) {
        console.error("Gaming news delete error:", err);
        return res.status(500).json({ message: "Server gagal menghapus berita game" });
    }
};
