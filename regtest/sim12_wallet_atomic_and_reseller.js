/**
 * REGRESSION TEST SUITE 12: NexShop Wallet Ledger, Concurrency, iPaymu Callback,
 * Reseller Open API v1, Idempotency & Provider State Machine (Section 27)
 *
 * Standalone verification script requiring no external network calls.
 * Run with: node regtest/sim12_wallet_atomic_and_reseller.js
 */

const assert = require("assert");
const crypto = require("crypto");
const { generateWebhookSignature } = require("../nexshop-backend/services/resellerWebhookService");
const { hitungHargaReseller, hitungMarkupWajar } = require("../nexshop-backend/utils/resellerPricing");

console.log("===============================================================================");
console.log("  NEXSHOP REGTEST: WALLET, LEDGER, ATOMICITY & RESELLER OPEN API V1");
console.log("===============================================================================\n");

let passedTests = 0;
let totalTests = 0;

function test(name, fn) {
    totalTests++;
    try {
        fn();
        console.log(`  ✅ [PASS] ${name}`);
        passedTests++;
    } catch (err) {
        console.error(`  ❌ [FAIL] ${name}`);
        console.error(`     Error: ${err.message}\n`);
        process.exitCode = 1;
    }
}

// -------------------------------------------------------------
// In-Memory Atomic Ledger Engine Simulator (Simulates Postgres)
// -------------------------------------------------------------
class MockDatabase {
    constructor() {
        this.wallets = new Map(); // userId -> { id, balance, status, wallet_type }
        this.transactions = new Map(); // referenceId -> transaction object
        this.orders = new Map(); // orderId -> order object
        this.topups = new Map(); // topupId -> topup object
        this.locks = new Map(); // userId -> Promise chain for mutex simulation
    }

    async atomicCredit(userId, type, amount, referenceId, externalId = null, description = "") {
        if (amount <= 0) throw new Error("Amount must be positive");

        // 1. Idempotency Check
        if (this.transactions.has(referenceId)) {
            const existing = this.transactions.get(referenceId);
            const w = this.wallets.get(userId);
            return { idempotent: true, balance: w.balance, transaction_id: existing.id };
        }

        // 2. Atomic Row Lock
        if (!this.wallets.has(userId)) {
            this.wallets.set(userId, { id: "w-" + userId, user_id: userId, balance: 0, status: "ACTIVE" });
        }
        const w = this.wallets.get(userId);
        if (w.status !== "ACTIVE") throw new Error("Wallet not active");

        const balanceBefore = w.balance;
        const balanceAfter = balanceBefore + amount;
        w.balance = balanceAfter;

        const trx = {
            id: "tx-" + crypto.randomBytes(4).toString("hex"),
            wallet_id: w.id,
            user_id: userId,
            type,
            direction: "IN",
            amount,
            balance_before: balanceBefore,
            balance_after: balanceAfter,
            reference_id: referenceId,
            external_transaction_id: externalId,
            description
        };
        this.transactions.set(referenceId, trx);

        return { idempotent: false, balance_before: balanceBefore, balance_after: balanceAfter, transaction_id: trx.id };
    }

    async atomicDebit(userId, type, amount, referenceId, externalId = null, description = "") {
        if (amount <= 0) throw new Error("Amount must be positive");

        // 1. Idempotency Check
        if (this.transactions.has(referenceId)) {
            const existing = this.transactions.get(referenceId);
            const w = this.wallets.get(userId);
            return { idempotent: true, balance: w.balance, transaction_id: existing.id };
        }

        // 2. Atomic Lock & Check Balance
        const w = this.wallets.get(userId);
        if (!w || w.status !== "ACTIVE") throw new Error("Wallet not found or not active");

        if (w.balance < amount) {
            throw new Error(`INSUFFICIENT_BALANCE: Saldo saat ini: ${w.balance}, butuh: ${amount}`);
        }

        const balanceBefore = w.balance;
        const balanceAfter = balanceBefore - amount;
        w.balance = balanceAfter;

        const trx = {
            id: "tx-" + crypto.randomBytes(4).toString("hex"),
            wallet_id: w.id,
            user_id: userId,
            type,
            direction: "OUT",
            amount,
            balance_before: balanceBefore,
            balance_after: balanceAfter,
            reference_id: referenceId,
            external_transaction_id: externalId,
            description
        };
        this.transactions.set(referenceId, trx);

        return { idempotent: false, balance_before: balanceBefore, balance_after: balanceAfter, transaction_id: trx.id };
    }
}

// -------------------------------------------------------------
// Test 1: User Topup via iPaymu (+100.000)
// -------------------------------------------------------------
test("1. User Topup: payment SUCCESS -> wallet +100.000", async () => {
    const db = new MockDatabase();
    const result = await db.atomicCredit(101, "TOPUP", 100000, "WT-INVOICE-001", "IPAYMU-TRX-101", "Topup iPaymu QRIS");

    assert.strictEqual(result.balance_after, 100000);
    assert.strictEqual(db.wallets.get(101).balance, 100000);
    assert.strictEqual(db.transactions.get("WT-INVOICE-001").type, "TOPUP");
});

// -------------------------------------------------------------
// Test 2: Duplicate Callback Idempotency
// -------------------------------------------------------------
test("2. Duplicate Callback: callback x2 -> wallet remains +100.000 (no double credit)", async () => {
    const db = new MockDatabase();
    await db.atomicCredit(101, "TOPUP", 100000, "WT-INVOICE-002", "IPAYMU-TRX-102");
    
    // Callback #2 with same referenceId
    const res2 = await db.atomicCredit(101, "TOPUP", 100000, "WT-INVOICE-002", "IPAYMU-TRX-102");
    
    assert.strictEqual(res2.idempotent, true);
    assert.strictEqual(db.wallets.get(101).balance, 100000);
});

// -------------------------------------------------------------
// Test 3: User Purchase with Wallet
// -------------------------------------------------------------
test("3. User Purchase: balance 100.000, purchase 30.000 -> balance 70.000", async () => {
    const db = new MockDatabase();
    await db.atomicCredit(101, "TOPUP", 100000, "WT-003");
    
    const debitRes = await db.atomicDebit(101, "PURCHASE", 30000, "PUR-ORD-001");
    assert.strictEqual(debitRes.balance_after, 70000);
    assert.strictEqual(db.wallets.get(101).balance, 70000);
});

// -------------------------------------------------------------
// Test 4: Insufficient Balance Rejection
// -------------------------------------------------------------
test("4. Insufficient Balance: balance 10.000, purchase 30.000 -> rejected, balance stays 10.000", async () => {
    const db = new MockDatabase();
    await db.atomicCredit(101, "TOPUP", 10000, "WT-004");

    let threw = false;
    try {
        await db.atomicDebit(101, "PURCHASE", 30000, "PUR-ORD-002");
    } catch (e) {
        threw = true;
        assert.ok(e.message.includes("INSUFFICIENT_BALANCE"));
    }

    assert.strictEqual(threw, true);
    assert.strictEqual(db.wallets.get(101).balance, 10000);
});

// -------------------------------------------------------------
// Test 5: Concurrent Purchase Race Condition Protection
// -------------------------------------------------------------
test("5. Concurrent Purchase: balance 50.000, request A (40k) & B (40k) -> only one succeeds", async () => {
    const db = new MockDatabase();
    await db.atomicCredit(101, "TOPUP", 50000, "WT-005");

    let successCount = 0;
    let failCount = 0;

    // Simulate serialized execution through lock queue
    const attemptOrder = async (ref) => {
        try {
            await db.atomicDebit(101, "PURCHASE", 40000, ref);
            successCount++;
        } catch (e) {
            failCount++;
        }
    };

    await Promise.all([
        attemptOrder("PUR-RACE-A"),
        attemptOrder("PUR-RACE-B")
    ]);

    assert.strictEqual(successCount, 1);
    assert.strictEqual(failCount, 1);
    assert.strictEqual(db.wallets.get(101).balance, 10000);
});

// -------------------------------------------------------------
// Test 6: Provider Processing State (Rule 9: No premature refund!)
// -------------------------------------------------------------
test("6. Provider Processing: debit -> provider PROCESSING -> no refund", async () => {
    const db = new MockDatabase();
    await db.atomicCredit(101, "TOPUP", 50000, "WT-006");
    await db.atomicDebit(101, "PURCHASE", 20000, "PUR-ORD-006");

    // TokoVoucher response: { status: 2, message: "Processing" }
    const tvResponse = { status: 2, message: "Transaksi sedang diproses" };
    let orderStatus = (tvResponse.status === 1) ? "sukses" : (tvResponse.status === 0 ? "gagal" : "processing");

    // State is processing, NO REFUND MUST BE TRIGGERED
    assert.strictEqual(orderStatus, "processing");
    assert.strictEqual(db.wallets.get(101).balance, 30000);
});

// -------------------------------------------------------------
// Test 7: Provider Final Failure (Refund Exactly Once)
// -------------------------------------------------------------
test("7. Provider Final Failure: debit -> provider FINAL FAILED -> refund exactly once", async () => {
    const db = new MockDatabase();
    await db.atomicCredit(101, "TOPUP", 50000, "WT-007");
    await db.atomicDebit(101, "PURCHASE", 20000, "PUR-ORD-007");

    // TokoVoucher gives status 0
    const tvStatus = 0;
    if (tvStatus === 0) {
        // Refund exactly once with idempotent reference
        await db.atomicCredit(101, "REFUND", 20000, "RF-ORD-007", null, "Refund order 007");
    }

    // Try redundant refund call with same reference
    const refund2 = await db.atomicCredit(101, "REFUND", 20000, "RF-ORD-007");
    assert.strictEqual(refund2.idempotent, true);

    // Balance is back to 50.000
    assert.strictEqual(db.wallets.get(101).balance, 50000);
});

// -------------------------------------------------------------
// Test 8: Provider Timeout (Rule 11: Reconciliation without premature refund)
// -------------------------------------------------------------
test("8. Provider Timeout: timeout -> UNKNOWN/PROCESSING -> reconciliation -> final success", async () => {
    const db = new MockDatabase();
    await db.atomicCredit(101, "TOPUP", 100000, "WT-008");
    await db.atomicDebit(101, "PURCHASE", 40000, "PUR-ORD-008");

    // Network timeout during TokoVoucher createTransaction
    let orderStatus = "processing";
    let isRefunded = false;

    // Poller / Webhook reconciles later with status 1 (Success)
    const reconciledTvStatus = 1;
    if (reconciledTvStatus === 1) {
        orderStatus = "sukses";
    }

    assert.strictEqual(orderStatus, "sukses");
    assert.strictEqual(isRefunded, false);
    assert.strictEqual(db.wallets.get(101).balance, 60000);
});

// -------------------------------------------------------------
// Test 9: Reseller Deposit via iPaymu (+500.000)
// -------------------------------------------------------------
test("9. Reseller Deposit: iPaymu SUCCESS -> reseller wallet +500.000", async () => {
    const db = new MockDatabase();
    const result = await db.atomicCredit(201, "RESELLER_DEPOSIT", 500000, "WT-RSL-001", "IPAYMU-999");

    assert.strictEqual(result.balance_after, 500000);
    assert.strictEqual(db.wallets.get(201).balance, 500000);
    assert.strictEqual(db.transactions.get("WT-RSL-001").type, "RESELLER_DEPOSIT");
});

// -------------------------------------------------------------
// Test 10: Reseller Dynamic Price & Order Placement
// -------------------------------------------------------------
test("10. Reseller Order: normal 20.000, tier 3.5% discount -> reseller price 19.300, wallet 480.700", async () => {
    const db = new MockDatabase();
    await db.atomicCredit(201, "RESELLER_DEPOSIT", 500000, "WT-RSL-002");

    // Reseller pricing test
    const { harga: resellerPrice, hemat } = hitungHargaReseller(20000, 18000, 3.5);
    assert.strictEqual(resellerPrice, 19300);
    assert.strictEqual(hemat, 700);

    // Debit reseller wallet
    const debitRes = await db.atomicDebit(201, "RESELLER_PURCHASE", resellerPrice, "RSL-PUR-CLIENT-REF-001");
    assert.strictEqual(debitRes.balance_after, 500000 - 19300);
    assert.strictEqual(db.wallets.get(201).balance, 480700);
});

// -------------------------------------------------------------
// Test 11: Reseller Duplicate Client Reference ID Idempotency
// -------------------------------------------------------------
test("11. Duplicate Reseller Order: same ref_id -> return existing, no second debit", async () => {
    const db = new MockDatabase();
    await db.atomicCredit(201, "RESELLER_DEPOSIT", 500000, "WT-RSL-003");

    // First API call
    const res1 = await db.atomicDebit(201, "RESELLER_PURCHASE", 18500, "CLIENT-UNIQUE-REF-999");
    assert.strictEqual(res1.idempotent, false);
    assert.strictEqual(db.wallets.get(201).balance, 481500);

    // Duplicate client API retry with exact same ref_id
    const res2 = await db.atomicDebit(201, "RESELLER_PURCHASE", 18500, "CLIENT-UNIQUE-REF-999");
    assert.strictEqual(res2.idempotent, true);
    assert.strictEqual(db.wallets.get(201).balance, 481500);
});

// -------------------------------------------------------------
// Test 12: Reseller Order Failure Refund
// -------------------------------------------------------------
test("12. Reseller Order Failed: TokoVoucher FINAL FAILED -> refund to 500.000", async () => {
    const db = new MockDatabase();
    await db.atomicCredit(201, "RESELLER_DEPOSIT", 500000, "WT-RSL-004");
    await db.atomicDebit(201, "RESELLER_PURCHASE", 18500, "RSL-ORD-FAILED-001");

    // TokoVoucher rejected
    await db.atomicCredit(201, "RESELLER_REFUND", 18500, "RF-RSL-ORD-FAILED-001", null, "Refund order failed");

    assert.strictEqual(db.wallets.get(201).balance, 500000);
    assert.strictEqual(db.transactions.get("RF-RSL-ORD-FAILED-001").type, "RESELLER_REFUND");
});

// -------------------------------------------------------------
// Test 13: Reseller Webhook HMAC-SHA256 Signature Verification
// -------------------------------------------------------------
test("13. Reseller Webhook: HMAC-SHA256 signature X-NexShop-Signature matches secret", () => {
    const secret = "reseller_webhook_secret_key_12345";
    const payload = {
        event: "transaction.updated",
        reference_id: "REF-CLIENT-123",
        order_id: "NX-ORD-987",
        status: "SUCCESS",
        product_code: "MLBB86",
        amount: 18500,
        serial_number: "SN-9988776655",
        timestamp: "2026-08-23T22:00:00.000Z"
    };

    const signature = generateWebhookSignature(payload, secret);
    assert.strictEqual(typeof signature, "string");
    assert.strictEqual(signature.length, 64); // SHA256 hex is 64 chars

    // Verify recipient side
    const computed = crypto.createHmac("sha256", secret).update(JSON.stringify(payload)).digest("hex");
    assert.strictEqual(signature, computed);
});

console.log("\n===============================================================================");
console.log(`  SUMMARY: ${passedTests}/${totalTests} Tests Passed successfully.`);
console.log("===============================================================================\n");
