"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
    getProductContract,
    buildSupplierTransactionInput
} = require("../nexshop-backend/utils/productContract");
const {
    evaluateAdminOrderAction
} = require("../nexshop-backend/utils/orderAdminPolicy");

function testVoucherDoesNotAskForGameId() {
    const contract = getProductContract({
        kategori: "Gaming",
        source_category_name: "Voucher Game",
        source_format_form: "1",
        butuh_server_id: true
    });

    assert.strictEqual(contract.target.kind, "recipient_phone");
    assert.strictEqual(contract.target.visible, false);
    assert.strictEqual(contract.target.required, false);
    assert.strictEqual(contract.server_id.required, false);

    const supplierPayload = buildSupplierTransactionInput(contract, {
        kode_produk: "FFV5",
        tujuan: "628123456789",
        recipient_phone: "628123456789",
        server_id: ""
    });
    assert.deepStrictEqual(supplierPayload, {
        produk: "FFV5",
        tujuan: "628123456789"
    });
}

function testVoucherNameOverridesLegacyGamingClassification() {
    const contract = getProductContract({
        kategori: "Gaming",
        source_category_name: "Gaming",
        source_operator_name: "Voucher Free Fire & FFMAX",
        nama: "Voucher Free Fire & FFMAX",
        butuh_server_id: true
    });

    assert.strictEqual(contract.target.kind, "recipient_phone");
    assert.strictEqual(contract.target.visible, false);
    assert.strictEqual(contract.target.required, false);
    assert.strictEqual(contract.server_id.required, false);
}

function testGameTopupKeepsPlayerAndServerFields() {
    const contract = getProductContract({
        kategori: "Gaming",
        source_category_name: "Topup Game",
        source_format_form: "2",
        butuh_server_id: false
    });

    assert.strictEqual(contract.target.kind, "player_id");
    assert.strictEqual(contract.target.visible, true);
    assert.strictEqual(contract.target.required, true);
    assert.strictEqual(contract.server_id.required, true);

    assert.deepStrictEqual(buildSupplierTransactionInput(contract, {
        kode_produk: "ML86",
        tujuan: "60034816",
        recipient_phone: "628123456789",
        server_id: "2001"
    }), {
        produk: "ML86",
        tujuan: "60034816",
        server_id: "2001"
    });
}

function testNonGamingAndUnknownFormatAreExplicit() {
    const phone = getProductContract({ kategori: "Pulsa", source_format_form: "1" });
    assert.strictEqual(phone.target.kind, "phone");
    assert.strictEqual(phone.target.visible, true);
    assert.strictEqual(phone.target.required, true);

    const dataVoucher = getProductContract({
        kategori: "Paket Data",
        nama: "VOUCHER INDOSAT",
        butuh_server_id: false
    });
    assert.strictEqual(dataVoucher.target.kind, "phone");
    assert.strictEqual(dataVoucher.target.visible, true);
    assert.strictEqual(dataVoucher.target.required, true);

    const custom = getProductContract({ kategori: "Lainnya", source_format_form: "3" });
    assert.strictEqual(custom.review_required, true);
    assert.strictEqual(custom.target.kind, "custom");
    assert.strictEqual(custom.target.required, true);
}

function testAdminOrderActionPolicy() {
    assert.deepStrictEqual(evaluateAdminOrderAction({
        orderType: "topup",
        status: "gagal",
        paymentMethod: "wallet",
        userId: 7,
        amount: 10000
    }, "refund"), { allowed: true, mode: "wallet" });

    assert.strictEqual(evaluateAdminOrderAction({
        orderType: "topup",
        status: "processing",
        paymentMethod: "wallet",
        userId: 7,
        amount: 10000
    }, "refund").allowed, false);

    assert.strictEqual(evaluateAdminOrderAction({
        orderType: "regular",
        status: "paid",
        paymentMethod: "qris",
        userId: 7,
        amount: 10000
    }, "refund").allowed, false);

    assert.strictEqual(evaluateAdminOrderAction({
        orderType: "topup",
        status: "sukses",
        paymentMethod: "wallet",
        userId: 7,
        amount: 10000
    }, "cancel").allowed, false);
}

function testIntegrationWiring() {
    const root = path.resolve(__dirname, "..");
    const tokoConfig = fs.readFileSync(path.join(root, "nexshop-backend/config/tokovoucher.js"), "utf8");
    const topupRoutes = fs.readFileSync(path.join(root, "nexshop-backend/routes/topupRoutes.js"), "utf8");
    const orderRoutes = fs.readFileSync(path.join(root, "nexshop-backend/routes/orderRoutes.js"), "utf8");
    const dashboard = fs.readFileSync(path.join(root, "nexshop-frontend/admin/js/dashboard.js"), "utf8");
    const migration = fs.readFileSync(path.join(root, "nexshop-backend/migrations/021_tokovoucher_contract_and_order_actions.sql"), "utf8");

    assert.ok(tokoConfig.includes("api.post(`/v1/transaksi`"));
    assert.ok(!/createTransaction[\\s\\S]*?params:\\s*\\{[^}]*secret/.test(tokoConfig));
    assert.ok(topupRoutes.includes('post("/admin/orders/:id/actions"'));
    assert.ok(orderRoutes.includes('post("/:id/actions"'));
    assert.ok(dashboard.includes("/topup/admin/orders/${orderId}/actions"));
    assert.ok(migration.includes("order_admin_actions"));
    assert.ok(migration.includes("source_format_form"));
    assert.ok(migration.includes("target_kind"));
}

testVoucherDoesNotAskForGameId();
testVoucherNameOverridesLegacyGamingClassification();
testGameTopupKeepsPlayerAndServerFields();
testNonGamingAndUnknownFormatAreExplicit();
testAdminOrderActionPolicy();
testIntegrationWiring();
console.log("sim40_tokovoucher_product_contract_and_admin_actions: passed");
