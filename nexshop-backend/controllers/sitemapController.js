"use strict";

const supabase = require("../config/db");

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

        const baseUrl = "https://nexshop.cloud";
        const today = new Date().toISOString();

        let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
        xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

        // Homepage
        xml += `  <url>\n    <loc>${baseUrl}/</loc>\n    <lastmod>${today}</lastmod>\n  </url>\n`;
        
        // News Index
        xml += `  <url>\n    <loc>${baseUrl}/berita</loc>\n    <lastmod>${today}</lastmod>\n  </url>\n`;

        // Articles
        if (articles && articles.length > 0) {
            for (const article of articles) {
                const lastmod = article.updated_at || article.published_at || today;
                xml += `  <url>\n`;
                xml += `    <loc>${baseUrl}/berita/${article.slug}</loc>\n`;
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
