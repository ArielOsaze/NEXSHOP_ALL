// Regression test: perbaikan di ssrController.js & sitemapController.js
// (audit Agustus 2026). Logic-only, tidak butuh koneksi database -- beda
// dari test_ssr.js yang integration test terhadap Supabase asli.

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

process.exit(allPass ? 0 : 1);
