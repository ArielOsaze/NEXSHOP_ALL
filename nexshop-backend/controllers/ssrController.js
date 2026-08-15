"use strict";

const fs = require("fs");
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

exports.renderArticle = async (req, res) => {
    try {
        const slug = req.params.slug;
        if (!slug) {
            return res.status(400).send("Slug required");
        }

        // Ambil data artikel dari database
        const { data: article, error } = await supabase
            .from("news_articles")
            .select("*")
            .eq("slug", slug)
            .eq("status", "published")
            .lte("published_at", new Date().toISOString())
            .single();

        if (error || !article) {
            return res.status(404).send("<h1>404 - Not Found</h1><p>Artikel tidak ditemukan.</p>");
        }

        // Path ke frontend
        const frontendPath = path.join(__dirname, "../../nexshop-frontend");
        const htmlPath = path.join(frontendPath, "berita-artikel.html");

        if (!fs.existsSync(htmlPath)) {
            return res.status(500).send("Template HTML tidak ditemukan.");
        }

        let html = fs.readFileSync(htmlPath, "utf-8");

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

        const safeTitle = escapeHtml(`${article.title} - NexShop News`);
        const safeDesc = escapeHtml(article.excerpt || "Berita gaming dari NexShop News.");
        const safeImage = escapeHtml(imageUrl);
        const safeUrl = escapeHtml(canonicalUrl);
        const safePublished = escapeHtml(article.published_at || "");
        const safeModified = escapeHtml(article.updated_at || "");
        const safeAuthor = escapeHtml(article.author || "");
        const safeSection = escapeHtml(article.category || "Gaming");

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

    } catch (err) {
        console.error("SSR Article error:", err);
        res.status(500).send("Internal Server Error");
    }
};
