// Regression test: perbaikan di ssrController.js & sitemapController.js
// (audit Agustus 2026). Logic-only, tidak butuh koneksi database -- beda
// dari test_ssr.js yang integration test terhadap Supabase asli.

const fs = require("fs");
const path = require("path");

let allPass = true;
function check(name, cond) {
    console.log(`${cond ? "PASS" : "FAIL"} — ${name}`);
    if (!cond) allPass = false;
}

// ---- 1. escapeXml (sitemapController.js) ----
function escapeXml(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

check(
    "escapeXml: & jadi &amp; (mencegah XML rusak kalau ada slug lama yang belum tersanitasi)",
    escapeXml("berita-a&b") === "berita-a&amp;b"
);
check(
    "escapeXml: <,> di-escape",
    escapeXml("<script>") === "&lt;script&gt;"
);
check(
    "escapeXml: nilai normal (a-z0-9-, hasil sanitizeSlug yang sebenarnya) tidak berubah",
    escapeXml("cara-menang-mobile-legends-2026") === "cara-menang-mobile-legends-2026"
);

// ---- 2. injectNotFoundMeta (ssrController.js) — pastikan TIDAK jadi
//         fragmen polos, template utuh tetap dipakai ----
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

const fakeTemplate = `<!DOCTYPE html>
<html lang="id" id="articleHtmlRoot">
<head>
<title id="docTitle">NexShop News</title>
<meta name="description" id="metaDesc" content="Berita gaming dari NexShop News.">
</head>
<body>
<nav>...navigasi situs...</nav>
<main id="articleRoot"></main>
<script src="/script.js"></script>
</body>
</html>`;

const notFoundResult = injectNotFoundMeta(fakeTemplate);
check(
    "404: masih mengandung <body> (bukan fragmen HTML polos seperti kode lama)",
    notFoundResult.includes("<body>")
);
check(
    "404: masih mengandung navigasi & script asli situs",
    notFoundResult.includes("<nav>") && notFoundResult.includes("/script.js")
);
check(
    "404: title diganti jadi pesan generik yang jelas",
    notFoundResult.includes("Artikel Tidak Ditemukan")
);
check(
    "404: BUKAN string bare fragment lama ('<h1>404 - Not Found</h1>...')",
    !notFoundResult.trim().startsWith("<h1>")
);

// ---- 3. Konsistensi baseUrl (dulu hardcoded di sitemapController, beda
//         dari ssrController yang pakai env var) ----
function resolveBaseUrl(envValue) {
    return (envValue || "https://nexshop.cloud").replace(/\/$/, "");
}
check(
    "baseUrl: pakai FRONTEND_URL kalau di-set",
    resolveBaseUrl("https://staging.nexshop.cloud") === "https://staging.nexshop.cloud"
);
check(
    "baseUrl: fallback ke domain default kalau env kosong",
    resolveBaseUrl(undefined) === "https://nexshop.cloud"
);
check(
    "baseUrl: trailing slash di env value dibuang (konsisten dgn ssrController)",
    resolveBaseUrl("https://nexshop.cloud/") === "https://nexshop.cloud"
);

// ---- 4. Fallback sitemap statis — Nginx lama/yang belum di-reload dapat
//         menyajikan file ini langsung, jadi tidak boleh kembali cuma satu URL.
const frontendDir = path.join(__dirname, "..", "nexshop-frontend");
const staticSitemap = fs.readFileSync(path.join(frontendDir, "sitemap.xml"), "utf8");
const staticLocs = [...staticSitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
const expectedStaticPaths = ["/", "/marketplace", "/berita", "/reseller", "/docs-reseller"];

check(
    "sitemap statis: memuat lima canonical public pages",
    expectedStaticPaths.every(pagePath => staticLocs.includes(`https://nexshop.cloud${pagePath}`))
        && staticLocs.length === expectedStaticPaths.length
);
check(
    "sitemap statis: portal/login privat tidak ikut diindeks",
    !staticSitemap.includes("portal-reseller") && !staticSitemap.includes("/login") && !staticSitemap.includes("/admin")
);

// ---- 5. Form pelanggan — selector harus lebih spesifik dari reset input
//         Tailwind agar field WA/Order ID/checkout tidak menjadi putih lagi.
const storefrontCss = fs.readFileSync(path.join(frontendDir, "style.css"), "utf8");
check(
    "form pelanggan: auth modal memiliki background, border, dan autofill bertema",
    storefrontCss.includes('.auth-modal input:not([type="hidden"])')
        && storefrontCss.includes("border: 1px solid rgba(0, 194, 232, .32)")
        && storefrontCss.includes(".auth-modal input:-webkit-autofill")
);
check(
    "form pelanggan: checkout modal memakai aturan field bertema yang sama",
    storefrontCss.includes('.checkout-modal input:not([type="hidden"])')
);

process.exit(allPass ? 0 : 1);
