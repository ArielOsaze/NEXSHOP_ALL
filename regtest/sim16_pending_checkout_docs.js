/**
 * REGRESSION TEST SUITE 16: checkout pending, portal berita, dan docs reseller.
 * Tidak membutuhkan jaringan maupun database.
 */

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
    cariProdukTumpangTindih,
    responsCheckoutPending
} = require("../nexshop-backend/services/pendingCheckoutService");

const root = path.join(__dirname, "..");
const baca = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

let passed = 0;
let total = 0;
function test(name, fn) {
    total++;
    try {
        fn();
        passed++;
        console.log("  [PASS] " + name);
    } catch (error) {
        console.error("  [FAIL] " + name + "\n         " + error.message);
        process.exitCode = 1;
    }
}

console.log("NEXSHOP REGTEST 16: CHECKOUT PENDING, BERITA, DAN DOCS RESELLER\n");

test("overlap produk pending dibandingkan dengan normalisasi ID", () => {
    const overlap = cariProdukTumpangTindih(
        [{ id: 12, qty: 1 }, { id: "game-pass", qty: 2 }],
        ["12", "produk-lain"]
    );
    assert.deepStrictEqual(overlap, ["12"]);
});

test("respons duplikat memakai HTTP contract dan notifikasi yang jelas", () => {
    const response = responsCheckoutPending({ id: "TPABC", nama_produk: "Minecraft" });
    assert.strictEqual(response.code, "DUPLICATE_PENDING_CHECKOUT");
    assert.strictEqual(response.existing_order_id, "TPABC");
    assert.match(response.message, /belum diselesaikan/i);
    assert.match(response.message, /Minecraft/);
});

const orderController = baca("nexshop-backend/controllers/orderController.js");
const topupController = baca("nexshop-backend/controllers/topupController.js");
const marketplace = baca("nexshop-frontend/marketplace.html");

test("kedua jalur checkout memblokir pending order dengan status 409", () => {
    assert.ok(orderController.includes("cariCheckoutProdukPending"));
    assert.ok(topupController.includes("cariCheckoutTopupPending"));
    assert.ok(orderController.includes("res.status(409)"));
    assert.ok(topupController.includes("res.status(409)"));
});

test("Marketplace menyertakan token login saat checkout topup", () => {
    assert.ok(marketplace.includes('const checkoutHeaders = { "Content-Type": "application/json" };'));
    assert.ok(marketplace.includes("checkoutHeaders.Authorization = `Bearer ${token}`"));
    assert.ok(marketplace.includes("headers: checkoutHeaders"));
});

const berita = baca("nexshop-frontend/berita.html");
test("portal berita hanya memiliki satu kontrol kategori", () => {
    assert.ok(berita.includes('id="catFilterWrap"'));
    assert.ok(!berita.includes('#catNavLinks a[data-cat]'));
    const nav = berita.slice(berita.indexOf('id="catNavLinks"'), berita.indexOf("</ul>", berita.indexOf('id="catNavLinks"')));
    assert.ok(!nav.includes("data-cat="), "navbar atas tidak boleh menduplikasi filter kategori");
});

const docs = baca("nexshop-frontend/docs-reseller.html");
const resellerPage = baca("nexshop-frontend/reseller.html");
const resellerController = baca("nexshop-backend/controllers/resellerController.js");

test("seluruh SLA verifikasi reseller konsisten 3x24 jam", () => {
    const gabungan = docs + resellerPage + resellerController;
    assert.ok(!/1\s*[x×]\s*24/i.test(gabungan));
    assert.match(gabungan, /3\s*[x×]\s*24/i);
});

test("tutorial menggunakan endpoint dan respons Open API yang nyata", () => {
    assert.ok(docs.includes("/api/v1/reseller/products"));
    assert.ok(docs.includes("/api/v1/reseller/check-nickname"));
    assert.ok(docs.includes("/api/v1/reseller/orders"));
    assert.ok(docs.includes("/api/v1/reseller/orders/:id"));
    assert.ok(!docs.includes('<span class="docs-endpoint-url">/api/topup'));
    assert.ok(!docs.includes('"qr_string"'));
});

test("contoh webhook sama dengan payload dan signature produksi", () => {
    assert.ok(docs.includes("HEX(HMAC_SHA256(webhook_secret, raw_body))"));
    assert.ok(docs.includes('"reference_id"'));
    assert.ok(docs.includes('"serial_number"'));
    assert.ok(!docs.includes("X-NexShop-Timestamp"));
    assert.ok(!docs.includes('signature = "sha256="'));
    assert.ok(resellerController.includes("generateWebhookSignature(rawBody, secret)"));
});

test("dokumentasi menyediakan endpoint download PDF", () => {
    const server = baca("nexshop-backend/server.js");
    const route = baca("nexshop-backend/routes/docsRoutes.js");
    const controller = baca("nexshop-backend/controllers/docsController.js");
    assert.ok(docs.includes('href="/api/docs/reseller.pdf"'));
    assert.ok(server.includes('app.use("/api/docs", docsRoutes)'));
    assert.ok(route.includes('router.get("/reseller.pdf"'));
    assert.ok(controller.includes('Content-Type", "application/pdf"'));
});

console.log(`\nRINGKASAN: ${passed}/${total} pengujian lolos.`);
if (passed !== total) process.exitCode = 1;
