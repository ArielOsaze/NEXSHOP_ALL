"use strict";

const assert = require("assert");
const fs = require("fs");

const css = fs.readFileSync("nexshop-frontend/portal-reseller.css", "utf8");
const darkBrand = /html\.dark\s+\.rs-portal-page\s+\.tv-sidebar-brand\s*,\s*html\[data-theme="dark"\]\s+\.rs-portal-page\s+\.tv-sidebar-brand\s*\{[^}]*background:\s*var\(--portal-surface\)\s*!important/i;
const darkActions = /html\.dark\s+\.rs-portal-page\s+\.tv-topbar-link\s*,[\s\S]*?html\[data-theme="dark"\]\s+\.rs-portal-page\s+\.tv-subvariant-btn\s*\{[^}]*background:\s*var\(--portal-surface-soft\)\s*!important/i;
const darkChart = /html\.dark\s+\.rs-portal-page\s+\.tv-chart-container\s*,\s*html\[data-theme="dark"\]\s+\.rs-portal-page\s+\.tv-chart-container\s*\{[^}]*background:\s*var\(--portal-surface-soft\)\s*!important/i;
assert(darkBrand.test(css), "RED: dark portal brand header harus memakai surface tema gelap, bukan background putih");
assert(darkActions.test(css), "RED: tombol portal dark harus memakai surface soft dan teks kontras");
assert(darkChart.test(css), "RED: chart dark tidak boleh menjadi panel putih");
const darkProductCards = /html\.dark\s+\.rs-portal-page\s+\.tv-product-card-item\s*,\s*html\[data-theme="dark"\]\s+\.rs-portal-page\s+\.tv-product-card-item\s*\{[^}]*background:\s*var\(--portal-surface-soft\)\s*!important[^}]*color:\s*var\(--portal-ink\)\s*!important/i;
assert(darkProductCards.test(css), "RED: kartu katalog produk dark harus memakai surface portal, bukan putih");
assert(!/html\.dark\s+\.rs-portal-page\s+\.tv-auth-card\s*\{[^}]*background:\s*var\(--portal-surface-soft\)/i.test(css), "login auth card tidak boleh ikut diubah oleh override katalog");
const darkDepositApiFields = /html\.dark\s+\.rs-portal-page\s+#view-deposit\s+input\.form-control\s*,[\s\S]*?html\[data-theme="dark"\][\s\S]*?#view-api[^\{]*\{[^}]*background:\s*var\(--portal-surface-soft\)\s*!important[^}]*color:\s*var\(--portal-ink\)\s*!important/i;
assert(darkDepositApiFields.test(css), "RED: field Deposit dan Integrasi API dark tidak boleh memakai background putih");
console.log("sim110_portal_dark_contrast: PASS");
