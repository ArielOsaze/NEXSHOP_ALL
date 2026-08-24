"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

let passed = 0;
function check(label, condition) {
    if (!condition) {
        console.error(`  [FAIL] ${label}`);
        process.exitCode = 1;
        return;
    }
    passed += 1;
    console.log(`  [PASS] ${label}`);
}

console.log("NEXSHOP REGTEST 19: SECURITY & MARKETPLACE UX\n");

const optionalAuth = read("nexshop-backend/middleware/optionalAuthMiddleware.js");
const apiAuth = read("nexshop-backend/middleware/apiKeyAuthMiddleware.js");
const resellerApi = read("nexshop-backend/controllers/resellerApiController.js");
const adminSession = read("nexshop-backend/middleware/adminSession.js");
const adminPin = read("nexshop-backend/middleware/adminPinMiddleware.js");
const settings = read("nexshop-backend/controllers/settingsController.js");
const news = read("nexshop-backend/controllers/newsArticleController.js");
const seoThumbnail = read("nexshop-backend/services/seoThumbnailService.js");
const marketplace = read("nexshop-frontend/marketplace.html");
const marketplaceTheme = read("nexshop-frontend/marketplace-theme.css");
const portal = read("nexshop-frontend/portal-reseller.html");
const nginx = read("nginx-nexshop.conf");
const marketplaceNavbar = marketplace.match(/<nav class="mkt-nav"[\s\S]*?<\/nav>/)?.[0] || "";
const categoryClickHandler = marketplace.slice(
    marketplace.indexOf('wrap.querySelectorAll(".cat-btn")'),
    marketplace.indexOf("function hargaCoretHtml")
);

check(
    "checkout web tidak menerima API Key reseller sebagai autentikasi opsional",
    optionalAuth.includes('token.startsWith("nx_live_")') &&
        !optionalAuth.includes('from("reseller_api_keys")')
);
check(
    "Open API hanya mendokumentasikan API Key + Secret Key dan tidak menerima JWT",
    apiAuth.includes("API_CREDENTIALS_REQUIRED") &&
        !apiAuth.includes("jwt.verify") &&
        !apiAuth.includes("optionalApiKeyOrJwtAuth")
);
check(
    "saldo deposit tidak cukup menghasilkan kode dan status pembayaran yang eksplisit",
    resellerApi.includes("INSUFFICIENT_RESELLER_BALANCE") &&
        resellerApi.includes("? 402 : 400")
);
check(
    "role admin gagal tertutup saat database tidak dapat memverifikasi akses",
    adminSession.includes('code: "ADMIN_AUTH_UNAVAILABLE"') &&
        !adminSession.includes("sementara pakai role dari token")
);
check(
    "Security PIN sensitif memiliki pembatas percobaan lintas endpoint",
    adminPin.includes("PIN_MAX_FAILURES = 5") &&
        adminPin.includes("ADMIN_PIN_RATE_LIMITED")
);
check(
    "perubahan password akun konsisten minimal delapan karakter",
    settings.includes("new_password.length < 8") &&
        settings.includes("Password baru harus 8–128 karakter")
);
check(
    "URL Gateway WA melewati validasi anti-SSRF sebelum disimpan dan dipanggil",
    settings.includes("validateWebhookUrlShape(target)") &&
        settings.includes("await assertSafeOutboundUrl(outboundTarget)")
);
check(
    "browser SEO memvalidasi origin anti-SSRF dan executable melalui allowlist",
    seoThumbnail.includes("await assertSafeOutboundUrl(parsed.origin)") &&
        seoThumbnail.includes("isAllowedChromeExecutable(configured)") &&
        settings.includes("isAllowedChromeExecutable(executablePath)")
);
check(
    "sanitizer artikel memakai parser DOM dan public output disanitasi ulang",
    news.includes('require("cheerio")') &&
        news.includes("content:         sanitizeHtml(article.content") &&
        !news.includes("Implementasi ringan berbasis regex")
);
check(
    "data transaksi dan mutasi reseller di-escape sebelum masuk innerHTML",
    portal.includes("${escapeHtml(o.produk)}") &&
        portal.includes("${escapeHtml(m.description || m.reference_id)}") &&
        portal.includes("Gagal memuat transaksi: ${escapeHtml(e.message)}")
);
check(
    "Marketplace memuat 20 item, membatalkan request lama, dan memakai tombol kartu native",
    marketplace.includes("const MKT_PAGE_SIZE = 20") &&
        marketplace.includes("mktAbortController?.abort()") &&
        marketplace.includes('<button type="button" class="market-card"') &&
        !marketplace.includes("new IntersectionObserver")
);
check(
    "Marketplace menyimpan search/filter ke URL dan menyediakan reset hasil kosong",
    marketplace.includes("function syncMarketplaceUrl()") &&
        marketplace.includes("mktEmptyResetBtn") &&
        marketplace.includes("mktSearchClearBtn")
);
check(
    "Marketplace memakai dashboard layanan ala mobile banking tanpa dekorasi tumpang tindih",
    marketplace.includes('class="mkt-banking-actions"') &&
        marketplace.includes("data-mkt-track-trigger") &&
        !marketplace.includes('class="mkt-rail-deco"') &&
        marketplaceTheme.includes("MARKETPLACE BANKING DASHBOARD") &&
        marketplaceTheme.includes("grid-template-columns: repeat(4, minmax(0, 1fr))")
);
check(
    "navbar Marketplace tidak menduplikasi Wallet, transaksi, Top Up, atau Reseller dari dashboard",
    !marketplaceNavbar.includes("data-wallet-trigger") &&
        !marketplaceNavbar.includes("data-mkt-track-trigger") &&
        !marketplaceNavbar.includes('href="/#topup"') &&
        !marketplaceNavbar.includes('href="/reseller"')
);
check(
    "shortcut Top Up Game tetap di Marketplace dan pilihan kategori tidak memaksa scroll",
    marketplace.includes('href="/marketplace?q=game" class="mkt-banking-action"') &&
        categoryClickHandler.includes("loadCatalogPage(true)") &&
        !categoryClickHandler.includes("scrollIntoView")
);
check(
    "kartu operator dan produk Marketplace memakai lapisan kaca transparan",
    marketplaceTheme.includes("background: rgba(12, 18, 35, 0.45)") &&
        marketplaceTheme.includes("backdrop-filter: blur(16px) saturate(120%)") &&
        /\.mkt-product-tile\s*\{[\s\S]*?background:\s*rgba\(12, 18, 35, 0\.45\)/.test(marketplaceTheme) &&
        marketplaceTheme.includes(':root[data-theme="light"] .mkt-product-tile')
);

const cspMatch = nginx.match(/add_header Content-Security-Policy "([^"]+)" always;/);
check(
    "CSP mengizinkan CDN yang benar, memisahkan handler legacy, dan mengaktifkan HSTS",
    cspMatch && cspMatch[1].includes("https://cdnjs.cloudflare.com") &&
        cspMatch[1].includes("script-src-attr 'unsafe-inline'") &&
        nginx.includes('Strict-Transport-Security "max-age=31536000; includeSubDomains" always')
);

if (cspMatch) {
    const csp = cspMatch[1];
    const htmlFiles = [];
    function walk(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith(".html")) htmlFiles.push(full);
        }
    }
    walk(path.join(root, "nexshop-frontend"));
    let hashesValid = true;
    for (const file of htmlFiles) {
        const html = fs.readFileSync(file, "utf8");
        for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
            if (/\bsrc\s*=/.test(match[1]) || !match[2].trim()) continue;
            const digest = crypto.createHash("sha256").update(match[2], "utf8").digest("base64");
            if (!csp.includes(`'sha256-${digest}'`)) hashesValid = false;
        }
    }
    check("semua inline script frontend cocok dengan hash CSP saat ini", hashesValid);
}

if (!process.exitCode) console.log(`\nRINGKASAN: ${passed} pengujian lolos.`);
