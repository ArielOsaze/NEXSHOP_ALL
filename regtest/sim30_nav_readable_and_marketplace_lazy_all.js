"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { urutkanMarketplaceOperators, urutkanKategoriMarketplace } = require("../nexshop-backend/services/catalogIndexService");

const root = path.join(__dirname, "..");
const index = fs.readFileSync(path.join(root, "nexshop-frontend/index.html"), "utf8").replace(/\r\n/g, "\n");
const marketplace = fs.readFileSync(path.join(root, "nexshop-frontend/marketplace.html"), "utf8").replace(/\r\n/g, "\n");

const operators = [
    { name: "Zeta", category: "Pulsa" },
    { name: "Bravo", category: "E-Wallet" },
    { name: "Alpha", category: "E-Wallet" },
    { name: "Delta", category: "Pulsa" },
    { name: "Unknown Service", category: "Lainnya" },
    { name: "Other Service", category: "Lainnya" }
];
const sorted = urutkanMarketplaceOperators(operators);
assert.deepStrictEqual(sorted.map((item) => item.name), ["Alpha", "Bravo", "Delta", "Zeta", "Other Service", "Unknown Service"]);
assert.deepStrictEqual(urutkanKategoriMarketplace([
    { name: "Tagihan", count: 1 },
    { name: "Lainnya", count: 2 },
    { name: "E-Wallet", count: 3 }
]).map((item) => item.name), ["E-Wallet", "Tagihan", "Lainnya"]);
assert.strictEqual(sorted.length, operators.length, "sorting tidak boleh membuang operator");

const mainNav = index.slice(index.indexOf('<div class="hidden nx-main-nav-desktop'), index.indexOf('<div class="nx-nav-actions'));
assert.ok(!mainNav.includes("truncate"), "label navbar utama tidak boleh dipotong ellipsis");
assert.ok(index.includes('class="hidden nx-main-nav-desktop'), "navbar teks dipakai hanya saat ruang desktop cukup");
assert.ok(index.includes('class="nx-main-nav-mobile'), "menu navigasi tetap tersedia sebelum desktop cukup lebar");

assert.ok(marketplace.includes("const MKT_PAGE_SIZE = 24"), "batch lazy load marketplace harus jelas");
assert.ok(marketplace.includes("Menampilkan ${operators.length} dari ${mktTotal} layanan"), "progress lazy load harus terlihat");
assert.ok(marketplace.includes('rootMargin: "700px"'), "lazy load harus mulai sebelum sentinel terlalu jauh");

console.log("sim30_nav_readable_and_marketplace_lazy_all: passed");
