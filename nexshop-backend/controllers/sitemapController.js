"use strict";

const supabase = require("../config/db");

// BUG FIX (audit Agustus 2026): escape karakter XML-sensitif buat nilai yang
// masuk ke <loc> dkk. Slug artikel di-generate lewat sanitizeSlug() saat
// dibuat (newsArticleController.js) jadi SEHARUSNYA selalu aman (cuma
// a-z/0-9/-), tapi tetap di-escape di sini sebagai defense-in-depth --
// kalau ada baris lama yang slug-nya diinput manual lewat SQL sebelum
// validasi itu ada, sitemap tidak boleh menghasilkan XML yang rusak/tidak
// valid gara-gara karakter seperti & yang tidak di-escape.
function escapeXml(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

exports.generateSitemap = async (req, res) => {
    try {
        const { data: articles, error } = await supabase
            .from("news_articles")
            .select("slug, published_at, updated_at")
            .eq("status", "published")
            .lte("published_at", new Date().toISOString())
            .order("published_at", { ascending: false });

        if (error) {
            console.error("Sitemap generation error:", error);
            return res.status(500).send("Error generating sitemap");
        }

        // BUG FIX: sebelumnya baseUrl di-hardcode "https://nexshop.cloud",
        // tidak konsisten dengan ssrController.js (dan seluruh backend
        // lainnya) yang pakai process.env.FRONTEND_URL. Kalau domain situs
        // pernah pindah/beda antara staging & production, sitemap ini akan
        // terus menunjuk ke domain lama sementara halaman lain sudah benar.
        const baseUrl = (process.env.FRONTEND_URL || "https://nexshop.cloud").replace(/\/$/, "");
        const today = new Date().toISOString();

        let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
        xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

        // Homepage
        xml += `  <url>\n    <loc>${escapeXml(baseUrl)}/</loc>\n    <lastmod>${today}</lastmod>\n  </url>\n`;

        // News Index
        xml += `  <url>\n    <loc>${escapeXml(baseUrl)}/berita</loc>\n    <lastmod>${today}</lastmod>\n  </url>\n`;

        // Marketplace & program reseller — halaman statis yang layak diindeks
        xml += `  <url>\n    <loc>${escapeXml(baseUrl)}/marketplace</loc>\n    <lastmod>${today}</lastmod>\n  </url>\n`;
        xml += `  <url>\n    <loc>${escapeXml(baseUrl)}/reseller</loc>\n    <lastmod>${today}</lastmod>\n  </url>\n`;

        // Articles
        if (articles && articles.length > 0) {
            const seenSlugs = new Set();
            for (const article of articles) {
                if (seenSlugs.has(article.slug)) continue;
                seenSlugs.add(article.slug);

                const lastmod = article.updated_at || article.published_at || today;
                xml += `  <url>\n`;
                xml += `    <loc>${escapeXml(baseUrl)}/berita/${escapeXml(article.slug)}</loc>\n`;
                xml += `    <lastmod>${new Date(lastmod).toISOString()}</lastmod>\n`;
                xml += `  </url>\n`;
            }
        }

        xml += `</urlset>`;

        res.header("Content-Type", "application/xml; charset=utf-8");
        res.send(xml);

    } catch (err) {
        console.error("Unexpected sitemap error:", err);
        res.status(500).send("Internal Server Error");
    }
};
