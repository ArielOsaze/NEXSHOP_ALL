"use strict";

const express = require("../nexshop-backend/node_modules/express");
const ssrController = require("../nexshop-backend/controllers/ssrController");
const sitemapController = require("../nexshop-backend/controllers/sitemapController");
const supabase = require("../nexshop-backend/config/db");
const http = require("http");

const app = express();
app.get("/berita/:slug", ssrController.renderArticle);
app.get("/api/sitemap", sitemapController.generateSitemap);

const server = http.createServer(app);
const PORT = 3009;

// Helper to make local http requests
function fetchLocal(path) {
    return new Promise((resolve, reject) => {
        const req = http.get(`http://localhost:${PORT}${path}`, (res) => {
            let data = "";
            res.on("data", chunk => data += chunk);
            res.on("end", () => resolve({ status: res.statusCode, data, headers: res.headers }));
        });
        req.on("error", reject);
    });
}

// Very minimal HTML parser helper for assertions
function extractRegex(html, pattern) {
    const match = html.match(pattern);
    return match ? match[1] : null;
}

async function runTests() {
    console.log("=========================================");
    console.log("Menjalankan SSR Regression Tests...");
    console.log("=========================================");
    
    // Start server
    await new Promise((resolve) => server.listen(PORT, resolve));
    
    // Setup a dummy injected record if necessary, or just use real DB
    const { data: validArticles, error } = await supabase
        .from("news_articles")
        .select("slug, title, excerpt, image_url")
        .eq("status", "published")
        .limit(2);
    
    if (error || !validArticles || validArticles.length < 2) {
        console.warn("Peringatan: Tidak cukup artikel valid di database untuk membandingkan 2 artikel. Menjalankan test 1 artikel saja jika ada.");
        if (!validArticles || validArticles.length === 0) {
            console.error("Test gagal: Tidak ada artikel.");
            process.exit(1);
        }
    }
    
    const articleA = validArticles[0];
    const articleB = validArticles.length > 1 ? validArticles[1] : null;

    // TEST 1: Valid article returns 200 and has all correct tags
    console.log(`[TEST 1] Mengakses artikel A: /berita/${articleA.slug}`);
    let resA = await fetchLocal(`/berita/${articleA.slug}`);
    
    if (resA.status !== 200) throw new Error(`Status HTTP salah, expected 200, got ${resA.status}`);
    
    const htmlA = resA.data;
    
    const titleRegex = /<title id="docTitle">([^<]+)<\/title>/i;
    const descRegex = /<meta name="description" id="metaDesc" content="([^"]+)">/i;
    const ogTitle = /<meta id="ogTitle" property="og:title" content="([^"]+)">/i;
    const ogDesc = /<meta id="ogDesc" property="og:description" content="([^"]+)">/i;
    const ogImage = /<meta id="ogImage" property="og:image" content="([^"]+)">/i;
    const ogUrl = /<meta id="ogUrl" property="og:url" content="([^"]+)">/i;
    const twTitle = /<meta id="twTitle" name="twitter:title" content="([^"]+)">/i;
    const canonical = /<link rel="canonical" id="linkCanonical" href="([^"]+)">/i;
    
    if (!extractRegex(htmlA, titleRegex)) throw new Error("Title tag tidak ditemukan atau format salah.");
    if (!extractRegex(htmlA, descRegex)) throw new Error("Description tag tidak ditemukan.");
    if (!extractRegex(htmlA, ogTitle)) throw new Error("og:title tidak ditemukan.");
    if (!extractRegex(htmlA, ogDesc)) throw new Error("og:description tidak ditemukan.");
    if (!extractRegex(htmlA, ogImage)) throw new Error("og:image tidak ditemukan.");
    if (!extractRegex(htmlA, ogUrl)) throw new Error("og:url tidak ditemukan.");
    if (!extractRegex(htmlA, twTitle)) throw new Error("twitter:title tidak ditemukan.");
    if (!extractRegex(htmlA, canonical)) throw new Error("canonical link tidak ditemukan.");
    
    const imgUrlVal = extractRegex(htmlA, ogImage);
    if (!imgUrlVal.startsWith("http")) throw new Error(`og:image URL tidak absolute: ${imgUrlVal}`);
    
    console.log("✓ HTML tags lengkap (title, description, og:*, twitter:*, canonical) untuk Artikel A.");
    console.log("✓ og:image adalah absolute URL.");

    if (articleB) {
        console.log(`[TEST 1B] Mengakses artikel B: /berita/${articleB.slug}`);
        let resB = await fetchLocal(`/berita/${articleB.slug}`);
        if (resB.status !== 200) throw new Error(`Status HTTP salah untuk artikel B`);
        const titleA = extractRegex(htmlA, ogTitle);
        const titleB = extractRegex(resB.data, ogTitle);
        if (titleA === titleB) throw new Error(`Metadata duplikat! Artikel A dan B memiliki og:title yang sama: ${titleA}`);
        console.log("✓ Data dinamis terverifikasi: Metadata artikel A dan B berbeda sesuai isi masing-masing.");
    }
    
    // TEST 2: Invalid article returns 404
    console.log(`[TEST 2] Mengakses artikel invalid: /berita/slug-ngawur-12345`);
    let res404 = await fetchLocal(`/berita/slug-ngawur-12345`);
    if (res404.status !== 404) throw new Error(`Status HTTP salah, expected 404, got ${res404.status}`);
    console.log("✓ Status 404 didapatkan untuk artikel invalid.");
    
    // TEST 3: Escaping XSS Test
    console.log(`[TEST 3] HTML Escaping Check`);
    // Insert a dummy article with XSS payload
    const dummySlug = "test-xss-" + Date.now();
    const maliciousTitle = "<script>alert(1)</script> & \"malicious\" 'title'";
    const escapedTitle = "&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;malicious&quot; &#039;title&#039; - NexShop News";
    
    await supabase.from("news_articles").insert({
        slug: dummySlug,
        title: maliciousTitle,
        content: "test content",
        author: "tester",
        status: "published",
        published_at: new Date().toISOString()
    });
    
    let resXss = await fetchLocal(`/berita/${dummySlug}`);
    if (resXss.status === 200) {
        const titleMatch = extractRegex(resXss.data, titleRegex);
        if (titleMatch !== escapedTitle) {
            console.error(`Expected: ${escapedTitle}`);
            console.error(`Got:      ${titleMatch}`);
            throw new Error("HTML tidak ter-escape dengan benar!");
        }
        console.log("✓ String berbahaya berhasil di-escape HTML.");
    }
    
    // Cleanup dummy article
    await supabase.from("news_articles").delete().eq("slug", dummySlug);

    // TEST 4: Sitemap XML Validation
    console.log(`[TEST 4] Validasi Sitemap`);
    let resSitemap = await fetchLocal(`/api/sitemap`);
    if (resSitemap.status !== 200) throw new Error("Sitemap gagal dimuat.");
    
    const contentType = resSitemap.headers["content-type"];
    if (!contentType || !contentType.includes("application/xml")) {
        throw new Error(`Sitemap Content-Type salah: ${contentType}`);
    }
    
    const xml = resSitemap.data;
    if (!xml.startsWith("<?xml")) throw new Error("Sitemap tidak dimulai dengan tag XML.");
    
    // Check no duplicate locs
    const locRegex = /<loc>([^<]+)<\/loc>/g;
    let match;
    const locs = [];
    while ((match = locRegex.exec(xml)) !== null) {
        locs.push(match[1]);
    }
    
    const uniqueLocs = new Set(locs);
    if (uniqueLocs.size !== locs.length) {
        throw new Error("Ditemukan duplikat URL di dalam sitemap.");
    }
    
    for (const url of locs) {
        if (!url.startsWith("http")) throw new Error(`URL Sitemap tidak absolute: ${url}`);
    }
    
    console.log("✓ Sitemap mengembalikan Content-Type: application/xml.");
    console.log("✓ Format Sitemap valid dan URL absolute.");
    console.log("✓ Tidak ada duplikasi URL.");

    console.log("=========================================");
    console.log("✅ SEMUA TEST BERHASIL LULUS.");
    console.log("=========================================");
    
    server.close();
}

runTests().catch(err => {
    console.error("Test gagal:", err);
    server.close();
    process.exit(1);
});
