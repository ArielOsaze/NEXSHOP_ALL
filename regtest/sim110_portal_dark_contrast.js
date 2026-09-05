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
console.log("sim110_portal_dark_contrast: PASS");
