"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const catalogService = require(path.join(
    __dirname,
    "..",
    "nexshop-backend",
    "services",
    "resellerCatalogService"
));
const controllerSource = fs.readFileSync(
    path.join(__dirname, "..", "nexshop-backend", "controllers", "resellerController.js"),
    "utf8"
);
const topupControllerSource = fs.readFileSync(
    path.join(__dirname, "..", "nexshop-backend", "controllers", "topupController.js"),
    "utf8"
);
const apiControllerSource = fs.readFileSync(
    path.join(__dirname, "..", "nexshop-backend", "controllers", "resellerApiController.js"),
    "utf8"
);
const portalHtmlSource = fs.readFileSync(
    path.join(__dirname, "..", "nexshop-frontend", "portal-reseller.html"),
    "utf8"
);

function run() {
    assert.strictEqual(typeof catalogService.formatPortalProduct, "function", "formatter harga portal wajib tersedia");
    assert.strictEqual(typeof catalogService.filterSellablePortalProducts, "function", "filter katalog portal wajib tersedia");
    assert.strictEqual(typeof catalogService.paginatePortalProducts, "function", "pagination katalog portal wajib tersedia");

    const gold = catalogService.formatPortalProduct(
        {
            id: 10,
            kode_produk: "NX-100",
            nama: "Produk NexShop 100",
            kategori: "Gaming",
            source_operator_name: "NexShop Gaming",
            harga_beli: 90000,
            harga_jual: 100000,
            butuh_server_id: false,
            is_active: true
        },
        { isReseller: true, discountPercent: 3.5, tier: { code: "gold", name: "Gold" } }
    );
    assert.strictEqual(gold.diskon_persen, 3.5, "diskon harus berasal dari tier akun server");
    assert.strictEqual(gold.harga_normal, 100000, "harga normal harus tetap terlihat sebagai pembanding");
    assert.strictEqual(gold.harga_modal_reseller, 96500, "harga portal harus memakai diskon tier Gold");
    assert.ok(gold.harga_modal_reseller < gold.harga_normal, "akun reseller approved tidak boleh menerima harga retail");
    const silver = catalogService.formatPortalProduct(
        { ...gold, harga_beli: 90000, harga_jual: 100000 },
        { isReseller: true, discountPercent: 1, tier: { code: "silver", name: "Silver" } }
    );
    assert.notStrictEqual(gold.harga_modal_reseller, silver.harga_modal_reseller, "tier akun A dan B tidak boleh memakai harga yang sama secara global");

    const rows = [
        { id: 1, kode_produk: "ID-1", nama: "Produk Indonesia", kategori: "Gaming", is_active: true, source_status: "active" },
        { id: 2, kode_produk: "ID-2", nama: "Produk Lama", kategori: "Gaming", is_active: true, source_status: null },
        { id: 3, kode_produk: "PH-1", nama: "Produk Philippines", kategori: "Topup Game", is_active: true, source_status: "active" },
        { id: 4, kode_produk: "CHK-1", nama: "Cek Nickname Mobile Legends", kategori: "Gaming", is_active: true, source_status: "active" },
        { id: 5, kode_produk: "OFF-1", nama: "Produk Mati", kategori: "Gaming", is_active: false, source_status: "active" }
    ];
    const sellable = catalogService.filterSellablePortalProducts(rows);
    assert.deepStrictEqual(sellable.map((p) => p.kode_produk), ["ID-1", "ID-2"], "katalog portal harus berisi seluruh produk NexShop aktif yang sellable");

    const many = Array.from({ length: 1205 }, (_, i) => ({ id: i + 1, kode_produk: `SKU-${i + 1}`, nama: `Produk ${i + 1}` }));
    const page = catalogService.paginatePortalProducts(many, { page: 2, limit: 250 });
    assert.strictEqual(page.total, 1205, "total katalog tidak boleh dipotong 1000");
    assert.strictEqual(page.total_pages, 5, "jumlah halaman harus mencakup seluruh katalog");
    assert.strictEqual(page.items.length, 250, "halaman kedua harus berisi batch penuh");
    assert.strictEqual(page.items[0].kode_produk, "SKU-251", "offset pagination harus stabil");
    assert.strictEqual(page.has_more, true, "frontend harus tahu masih ada produk berikutnya");

    assert.match(controllerSource, /fetchAllRows/, "endpoint portal harus membaca seluruh halaman PostgREST");
    assert.doesNotMatch(controllerSource, /\.limit\(1000\)/, "endpoint portal tidak boleh memotong katalog pada limit 1000");
    assert.match(controllerSource, /has_more/, "response portal harus mengirim metadata pagination");
    assert.match(topupControllerSource, /RESELLER_PRICING_UNAVAILABLE/, "checkout portal harus fail closed jika tier approved tidak terbaca");
    assert.match(apiControllerSource, /fetchAllRows/, "Open API reseller juga harus membaca seluruh katalog");
    assert.match(portalHtmlSource, /searchParams\.set\("page"/, "frontend portal harus meminta halaman katalog berikutnya");
    assert.match(portalHtmlSource, /tvProductCatalogProgress/, "frontend harus menampilkan progres katalog agar hasil parsial tidak disangka lengkap");

    console.log("PASS qa_reseller_portal_catalog_pricing_contract: tier pricing server-side dan katalog >1000 terjaga");
}

try {
    run();
} catch (error) {
    console.error(`FAIL qa_reseller_portal_catalog_pricing_contract: ${error.message}`);
    process.exitCode = 1;
}
