"use strict";

const assert = require("assert");
const {
    verifyIpaymuTransactionForTopup
} = require("../nexshop-backend/utils/ipaymuPaymentVerification");

function test(label, fn) {
    try {
        fn();
        console.log(`[PASS] ${label}`);
    } catch (error) {
        console.error(`[FAIL] ${label}: ${error.message}`);
        process.exitCode = 1;
    }
}

test("menolak transaksi iPaymu paid yang reference invoice-nya berbeda", () => {
    const result = verifyIpaymuTransactionForTopup(
        { ReferenceId: "WT-PAID-OTHER", Amount: 100000, TransactionId: "TV-PAID" },
        { id: "WT-OWN-INVOICE", amount: 100000 },
        "TV-PAID"
    );
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, "IPAYMU_REFERENCE_MISMATCH");
});

test("menolak transaksi iPaymu paid dengan nominal berbeda", () => {
    const result = verifyIpaymuTransactionForTopup(
        { ReferenceId: "WT-OWN-INVOICE", Amount: 50000, TransactionId: "TV-PAID" },
        { id: "WT-OWN-INVOICE", amount: 100000 },
        "TV-PAID"
    );
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, "IPAYMU_AMOUNT_MISMATCH");
});

test("menerima transaksi jika reference, nominal, dan trx cocok", () => {
    const result = verifyIpaymuTransactionForTopup(
        { ReferenceId: "WT-OWN-INVOICE", Amount: "100000", TransactionId: "TV-PAID" },
        { id: "WT-OWN-INVOICE", amount: 100000, ipaymu_trx_id: "TV-PAID" },
        "TV-PAID"
    );
    assert.deepStrictEqual(result, { ok: true });
});

if (process.exitCode) process.exit(1);
console.log("PASS sim112_wallet_callback_correlation");
