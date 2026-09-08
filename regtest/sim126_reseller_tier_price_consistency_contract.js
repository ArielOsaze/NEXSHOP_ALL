"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { hitungHargaReseller } = require("../nexshop-backend/utils/resellerPricing");
const { formatPortalProduct } = require("../nexshop-backend/services/resellerCatalogService");

const root = path.join(__dirname, "..");
const portalHtml = fs.readFileSync(path.join(root, "nexshop-frontend", "portal-reseller.html"), "utf8");
const topupController = fs.readFileSync(path.join(root, "nexshop-backend", "controllers", "topupController.js"), "utf8");
const resellerApiController = fs.readFileSync(path.join(root, "nexshop-backend", "controllers", "resellerApiController.js"), "utf8");
const resellerService = fs.readFileSync(path.join(root, "nexshop-backend", "services", "resellerService.js"), "utf8");

const product = { harga_jual: 100000, harga_beli: 80000, kategori: "Voucher Game", source_operator_name: "QA" };
const expected = { silver: 98000, gold: 96500, platinum: 95000 };
const prices = Object.fromEntries(Object.entries(expected).map(([tier, discount]) => [
    tier,
    hitungHargaReseller(product.harga_jual, product.harga_beli, { silver: 2, gold: 3.5, platinum: 5 }[tier])
]));

for (const [tier, expectedPrice] of Object.entries(expected)) {
    assert.strictEqual(prices[tier].sellable, true, `${tier} harus sellable`);
    assert.strictEqual(prices[tier].harga, expectedPrice, `${tier} salah menghitung potongan`);
}
assert(prices.silver.harga > prices.gold.harga, "Gold harus lebih murah dari Silver");
assert(prices.gold.harga > prices.platinum.harga, "Platinum harus lebih murah dari Gold");

const formatted = Object.fromEntries(Object.entries({ silver: 2, gold: 3.5, platinum: 5 }).map(([tier, discountPercent]) => [
    tier,
    formatPortalProduct({ id: 1, kode_produk: `QA-${tier}`, nama: "Produk QA", is_active: true, source_status: "active", ...product }, { isReseller: true, discountPercent })
]));
for (const [tier, row] of Object.entries(formatted)) {
    assert.strictEqual(row.harga_modal_reseller, expected[tier], `katalog Portal ${tier} tidak sama dengan rumus`);
    assert.strictEqual(row.diskon_persen, { silver: 2, gold: 3.5, platinum: 5 }[tier]);
}

const floor = hitungHargaReseller(100000, 99000, 5);
assert.strictEqual(floor.sellable, true);
assert.strictEqual(floor.harga, 99990, "floor margin harus menjaga margin minimum tanpa melebihi harga normal");
assert.strictEqual(hitungHargaReseller(80000, 80000, 5).sellable, false, "harga jual sama dengan modal harus ditolak");

assert(resellerService.includes('.from("reseller_tiers")'), "tier harus dibaca dari tabel reseller_tiers");
assert(topupController.includes("hitungHargaReseller(product.harga_jual, product.harga_beli, konteksReseller.discountPercent)"), "checkout Portal harus menghitung ulang harga dari DB");
assert(resellerApiController.includes("hitungHargaReseller(product.harga_jual, product.harga_beli, konteksReseller.discountPercent)"), "Open API harus memakai rumus tier yang sama");
assert(portalHtml.includes("kode_produk: selectedPortalProduct.kode_produk"), "Portal mengirim SKU untuk checkout");
assert(!portalHtml.includes("harga: selectedPortalProduct.harga_modal_reseller"), "Portal tidak boleh mengirim harga sebagai sumber kebenaran");

console.log("PASS sim126_reseller_tier_price_consistency_contract");
