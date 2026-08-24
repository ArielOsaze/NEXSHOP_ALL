"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const portal = read("nexshop-frontend/portal-reseller.html");
const reseller = read("nexshop-frontend/reseller.html");
const marketplace = read("nexshop-frontend/marketplace.html");
const script = read("nexshop-frontend/script.js");
const style = read("nexshop-frontend/style.css");
const marketplaceTheme = read("nexshop-frontend/marketplace-theme.css");
const docs = read("nexshop-frontend/docs-reseller.html");
const consent = read("nexshop-frontend/cookie-consent.js");
const cleanUrl = read("nexshop-frontend/clean-url.js");
const controller = read("nexshop-backend/controllers/resellerController.js");

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

console.log("NEXSHOP REGTEST 18: PORTAL RESELLER & UI POLISH\n");

check(
    "wallet drawer dan badge INSTAN tidak lagi memakai palet ungu",
    style.includes("linear-gradient(135deg, #082f49, #0e7490)") &&
        marketplaceTheme.includes("linear-gradient(135deg, #082f49, #0e7490)") &&
        style.includes("color: #67e8f9") &&
        !/home-glass-badge[\s\S]{0,500}(?:216, 180, 254|167, 139, 250)/.test(style) &&
        !/(?:#1e1b4b|#312e81|167, 139, 250|#C4B5FD)/i.test(marketplaceTheme)
);
check(
    "hasil cek transaksi kosong tetap tersembunyi di home dan Marketplace",
    script.includes('tab !== "byid" || !result.innerHTML.trim()') &&
        marketplace.includes('tab !== "byid" || !result.innerHTML.trim()')
);
check(
    "FAQ docs memakai chevron CSS dan bukan teks expand_more",
    !docs.includes("content: 'expand_more'") &&
        docs.includes("border-right: 2px solid currentColor")
);
check(
    "kartu langkah dokumentasi punya grid stabil dan gap antarkartu",
    docs.includes("grid-template-columns: 2.5rem minmax(0, 1fr)") &&
        docs.includes("gap: 0.85rem")
);
check(
    "navbar reseller memiliki scope mobile dan target sentuh 44px",
    reseller.includes('class="reseller-page"') &&
        marketplaceTheme.includes(".reseller-page .mkt-nav-toggle") &&
        marketplaceTheme.includes("2.75rem")
);
check(
    "consent tersimpan di cookie dan localStorage agar tidak muncul berulang",
    consent.includes("localStorage.setItem(CONSENT_STORAGE, value)") &&
        consent.includes("localStorage.getItem(CONSENT_STORAGE)")
);
check(
    "compatibility clean URL memetakan halaman statis dua arah",
    cleanUrl.includes('"/marketplace": "/marketplace.html"') &&
        cleanUrl.includes("window.history.replaceState") &&
        cleanUrl.includes("window.location.replace")
);
check(
    "approval lama direkonsiliasi tanpa menimpa akun suspended/rejected",
    controller.includes('["none", "pending"].includes(status)') &&
        controller.includes('latestApp?.status === "approved"')
);
check(
    "riwayat portal memakai nama kolom topup_orders yang aktual",
    controller.includes("nama_produk, kode_produk") &&
        controller.includes("tv_sn, tv_message") &&
        controller.includes("produk: order.nama_produk")
);
check(
    "kategori portal dibangun dari katalog dan dicocokkan secara exact",
    portal.includes("function buildCategoryTabs()") &&
        portal.includes("portalCategoryKey(p.kategori) === portalCategoryKey(activeCategory)")
);
check(
    "portal menyediakan checkout saldo dengan harga reseller server-side",
    portal.includes("function openPortalPurchase") &&
        portal.includes('fetch(`${API_BASE}/topup`') &&
        portal.includes('payment_method: "wallet"') &&
        portal.includes("tv-btn-buy")
);
check(
    "banner verifikasi tidak berkedip pending sebelum respons server",
    portal.includes('id="tvPendingBanner" class="tv-pending-banner" style="display:none;"') &&
        portal.includes("Memeriksa status")
);

if (!process.exitCode) {
    console.log(`\nRINGKASAN: ${passed}/12 pengujian lolos.`);
}
