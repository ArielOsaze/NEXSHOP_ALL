"use strict";

const fs = require("fs/promises");
const path = require("path");
const supabase = require("../config/db");

// Simple XML/HTML escape to prevent injection
function escapeHtml(unsafe) {
    if (!unsafe) return "";
    return String(unsafe)
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

// Menghapus tag sitasi internal Gemini
function removeGeminiCitations(text) {
    if (!text || typeof text !== "string") return text;
    return text.replace(/\uE200cite[^\uE201]*\uE201/g, "");
}

// BUG FIX (audit Agustus 2026): sebelumnya kalau artikel tidak ditemukan,
// server langsung kirim `res.send("<h1>404 - Not Found</h1>...")` -- fragmen
// HTML mentah tanpa <html>/<head>/<body>, tanpa CSS, tanpa navigasi sama
// sekali. Kalau ada yang share link artikel yang salah/sudah dihapus, mereka
// dapat halaman rusak/polos alih-alih pengalaman 404 situs yang normal.
// Sekarang: tetap kirim template berita-artikel.html YANG SAMA (JS di
// halaman itu sendiri akan menampilkan state "tidak ditemukan" miliknya
// sendiri, sama seperti sebelum fitur SSR ini ada -- tidak ada perubahan
// perilaku untuk pengguna asli), cuma meta title/description-nya diganti
// jadi generik + status HTTP 404 (benar secara SEO, dan mencegah preview
// menyesatkan kalau link yang salah itu sempat di-share).
function injectNotFoundMeta(html) {
    let out = html;
    out = out.replace(
        /<title id="docTitle">.*?<\/title>/i,
        `<title id="docTitle">Artikel Tidak Ditemukan — NexShop News</title>`
    );
    out = out.replace(
        /<meta name="description" id="metaDesc" content="[^"]*">/i,
        `<meta name="description" id="metaDesc" content="Artikel yang kamu cari tidak ditemukan atau sudah tidak tersedia.">`
    );
    return out;
}

exports.renderArticle = async (req, res) => {
    const slug = req.params.slug;

    // Path ke frontend & baca template lebih dulu -- dipakai baik untuk
    // artikel ketemu MAUPUN untuk kasus 404/error (supaya user tetap dapat
    // halaman situs yang utuh, bukan fragmen polos, di semua kondisi).
    const frontendPath = process.env.FRONTEND_DIST_PATH
        || path.join(__dirname, "../../nexshop-frontend");
    const htmlPath = path.join(frontendPath, "berita-artikel.html");

    let html;
    try {
        html = await fs.readFile(htmlPath, "utf-8");
    } catch (err) {
        console.error(`[SSR Article] Gagal baca template di ${htmlPath}:`, err.message);
        return res.status(500).send("Template HTML tidak ditemukan.");
    }

    if (!slug) {
        return res.status(404).type("html").send(injectNotFoundMeta(html));
    }

    let article, dbError;
    try {
        const result = await supabase
            .from("news_articles")
            .select("*")
            .eq("slug", slug)
            .eq("status", "published")
            .lte("published_at", new Date().toISOString())
            .single();
        article = result.data;
        dbError = result.error;
    } catch (err) {
        dbError = err;
    }

    // BUG FIX: sebelumnya `error || !article` diperlakukan SAMA (selalu
    // 404) -- padahal error DB asli (koneksi gagal, dst) bukan berarti
    // artikelnya tidak ada, itu masalah server. Dibedakan sekarang: error
    // DB asli -> 500 + kirim template apa adanya (fallback aman, JS di
    // halaman tetap bisa coba fetch sendiri via API biasa). Artikel
    // benar-benar tidak ketemu (query sukses, hasil kosong) -> 404 + meta
    // generik.
    if (dbError && dbError.code !== "PGRST116") {
        // PGRST116 = "no rows found" dari .single() -- itu genuinely
        // not-found, bukan error server. Selain itu, anggap error server.
        console.error("[SSR Article] Query error:", dbError);
        return res.status(200).type("html").send(html);
    }

    if (!article) {
        return res.status(404).type("html").send(injectNotFoundMeta(html));
    }

    // Siapkan metadata
    const baseUrl = (process.env.FRONTEND_URL || "https://nexshop.cloud").replace(/\/$/, "");
    const canonicalUrl = `${baseUrl}/berita/${encodeURIComponent(article.slug)}`;
    const defaultImage = `${baseUrl}/images/hero-bg.jpg`; // Fallback image jika tidak ada

    let imageUrl = article.image_url;
    if (!imageUrl) {
        imageUrl = defaultImage;
    } else if (imageUrl.startsWith("/")) {
        imageUrl = `${baseUrl}${imageUrl}`;
    }

    const safeTitle = escapeHtml(removeGeminiCitations(`${article.title} - NexShop News`));
    const safeDesc = escapeHtml(removeGeminiCitations(article.excerpt || "Berita gaming dari NexShop News."));
    const safeImage = escapeHtml(imageUrl);
    const safeUrl = escapeHtml(canonicalUrl);
    const safePublished = escapeHtml(article.published_at || "");
    const safeModified = escapeHtml(article.updated_at || "");
    const safeAuthor = escapeHtml(removeGeminiCitations(article.author || ""));
    const safeSection = escapeHtml(removeGeminiCitations(article.category || "Gaming"));

    // Inject meta tags menggunakan Regex replacement pada template asli

    // 1. Title
    html = html.replace(
        /<title id="docTitle">.*?<\/title>/i,
        `<title id="docTitle">${safeTitle}</title>`
    );

    // 2. Description
    html = html.replace(
        /<meta name="description" id="metaDesc" content="[^"]*">/i,
        `<meta name="description" id="metaDesc" content="${safeDesc}">`
    );

    // 3. Canonical
    html = html.replace(
        /<link rel="canonical" id="linkCanonical" href="[^"]*">/i,
        `<link rel="canonical" id="linkCanonical" href="${safeUrl}">`
    );

    // 4. Open Graph
    html = html.replace(/<meta id="ogUrl"[^>]*content="[^"]*">/i, `<meta id="ogUrl" property="og:url" content="${safeUrl}">`);
    html = html.replace(/<meta id="ogTitle"[^>]*content="[^"]*">/i, `<meta id="ogTitle" property="og:title" content="${safeTitle}">`);
    html = html.replace(/<meta id="ogDesc"[^>]*content="[^"]*">/i, `<meta id="ogDesc" property="og:description" content="${safeDesc}">`);
    html = html.replace(/<meta id="ogImage"[^>]*content="[^"]*">/i, `<meta id="ogImage" property="og:image" content="${safeImage}">`);

    // 5. Twitter
    html = html.replace(/<meta id="twTitle"[^>]*content="[^"]*">/i, `<meta id="twTitle" name="twitter:title" content="${safeTitle}">`);
    html = html.replace(/<meta id="twDesc"[^>]*content="[^"]*">/i, `<meta id="twDesc" name="twitter:description" content="${safeDesc}">`);
    html = html.replace(/<meta id="twImage"[^>]*content="[^"]*">/i, `<meta id="twImage" name="twitter:image" content="${safeImage}">`);

    // 6. Article Meta
    html = html.replace(/<meta id="artPublished"[^>]*content="[^"]*">/i, `<meta id="artPublished" property="article:published_time" content="${safePublished}">`);
    html = html.replace(/<meta id="artModified"[^>]*content="[^"]*">/i, `<meta id="artModified" property="article:modified_time" content="${safeModified}">`);
    html = html.replace(/<meta id="artAuthor"[^>]*content="[^"]*">/i, `<meta id="artAuthor" property="article:author" content="${safeAuthor}">`);
    html = html.replace(/<meta id="artSection"[^>]*content="[^"]*">/i, `<meta id="artSection" property="article:section" content="${safeSection}">`);

    // Tambahkan atribut data-ssr agar frontend script.js tahu metadata ini sudah SSR
    html = html.replace(/<html lang="id" id="articleHtmlRoot">/i, `<html lang="id" id="articleHtmlRoot" data-ssr="true">`);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
};
