"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
    getProductContract,
    getProductAdminCategory
} = require("../nexshop-backend/utils/productContract");

const root = path.resolve(__dirname, "..");
const dashboard = fs.readFileSync(path.join(root, "nexshop-frontend/admin/dashboard.html"), "utf8");
const indexService = fs.readFileSync(path.join(root, "nexshop-backend/services/catalogIndexService.js"), "utf8");
const topupController = fs.readFileSync(path.join(root, "nexshop-backend/controllers/topupController.js"), "utf8");
const catalogSync = fs.readFileSync(path.join(root, "nexshop-frontend/admin/js/catalogSync.js"), "utf8");

function testGameAndGamepassBelongToOrders() {
    for (const product of [
        { kategori: "Gaming", nama: "86 Diamonds" },
        { kategori: "Gaming", nama: "Weekly Diamond Pass" },
        { kategori: "Game Pass", nama: "Xbox Game Pass 1 Month" }
    ]) {
        const contract = getProductContract(product);
        assert.strictEqual(contract.order_category, "orders");
        assert.strictEqual(getProductAdminCategory(product), "orders");
    }
}

function testNonGamingStaysOutsideOrders() {
    const contract = getProductContract({ kategori: "E-Money", nama: "DANA 20.000" });
    assert.strictEqual(contract.order_category, "catalog-sales");
    assert.strictEqual(getProductAdminCategory({ kategori: "Pulsa", nama: "Telkomsel 10.000" }), "catalog-sales");
}

function testAdminNavigationMatchesDataOwnership() {
    assert.match(dashboard, /data-nav-group="orders"[\s\S]*data-view="topup"[^>]*>[\s\S]*Produk Topup/);
    assert.match(dashboard, /data-nav-group="catalog-sales"[\s\S]*data-view="products"[^>]*>[\s\S]*Produk Toko/);
    assert.doesNotMatch(dashboard, /data-view="products"[^>]*>[\s\S]*Produk Game\s*\/\s*Gamepass/);
    assert.match(dashboard, /<h2>Orders Produk Topup<\/h2>/);
}

function testCategoryIsCarriedAcrossCatalogAndAdminOrderFeed() {
    assert.match(indexService, /order_category:\s*contract\.order_category/);
    assert.match(topupController, /order_category:\s*productContract\.order_category/);
    assert.match(catalogSync, /order_category/);
}

testGameAndGamepassBelongToOrders();
testNonGamingStaysOutsideOrders();
testAdminNavigationMatchesDataOwnership();
testCategoryIsCarriedAcrossCatalogAndAdminOrderFeed();
console.log("sim42_game_gamepass_orders_category: passed");
