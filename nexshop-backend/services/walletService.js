const supabase = require("../config/db");
const { isMissingTableError } = require("./resellerService");

const WALLET_NOT_SETUP_CODE = "WALLET_NOT_SETUP";
const WALLET_NOT_SETUP_MESSAGE =
    "Fitur NexShop Wallet belum di-setup di database. Jalankan migrations/011_create_nexshop_wallets.sql di Supabase SQL Editor.";

class WalletNotSetupError extends Error {
    constructor() {
        super(WALLET_NOT_SETUP_MESSAGE);
        this.name = "WalletNotSetupError";
        this.code = WALLET_NOT_SETUP_CODE;
        this.status = 503;
    }
}

function isWalletMissing(error) {
    if (!error) return false;
    const code = String(error.code || "");
    const message = String(error.message || "").toLowerCase();
    return (
        code === "42P01" ||
        code === "PGRST205" ||
        (message.includes("wallets") && message.includes("does not exist")) ||
        (message.includes("wallet_transactions") && message.includes("does not exist")) ||
        (message.includes("function") && message.includes("credit_wallet_atomic"))
    );
}

/**
 * Mendapatkan atau menginisialisasi wallet untuk user/reseller
 */
async function getOrCreateWallet(userId, walletType = "USER_WALLET") {
    if (!userId) throw new Error("User ID wajib diisi");

    try {
        const { data: existing, error } = await supabase
            .from("wallets")
            .select("id, user_id, wallet_type, balance, currency, status, created_at, updated_at")
            .eq("user_id", userId)
            .maybeSingle();

        if (error) {
            if (isWalletMissing(error)) throw new WalletNotSetupError();
            throw error;
        }

        if (existing) {
            return {
                ...existing,
                balance: Number(existing.balance) || 0
            };
        }

        // Buat wallet baru jika belum ada
        const { data: created, error: createErr } = await supabase
            .from("wallets")
            .insert([{
                user_id: userId,
                wallet_type: walletType,
                balance: 0.00,
                status: "ACTIVE"
            }])
            .select()
            .single();

        if (createErr) {
            if (isWalletMissing(createErr)) throw new WalletNotSetupError();
            throw createErr;
        }

        return {
            ...created,
            balance: Number(created.balance) || 0
        };
    } catch (err) {
        if (isWalletMissing(err)) throw new WalletNotSetupError();
        throw err;
    }
}

/**
 * Cek saldo wallet user saat ini
 */
async function getWalletBalance(userId) {
    const wallet = await getOrCreateWallet(userId);
    return Number(wallet.balance) || 0;
}

/**
 * Tambah saldo secara atomik via Stored Procedure / Supabase RPC
 */
async function creditWallet({
    userId,
    type = "TOPUP",
    amount,
    referenceId,
    externalTransactionId = null,
    description = "Penambahan saldo",
    metadata = {}
}) {
    const numAmount = Number(amount);
    if (!numAmount || numAmount <= 0) {
        throw new Error("Nominal topup/credit harus lebih besar dari 0");
    }
    if (!referenceId) {
        throw new Error("reference_id wajib disertakan untuk idempotency");
    }

    try {
        // Coba panggil Stored Procedure atomic di PostgreSQL
        const { data, error } = await supabase.rpc("credit_wallet_atomic", {
            p_user_id: userId,
            p_type: type,
            p_amount: numAmount,
            p_reference_id: referenceId,
            p_external_trx_id: externalTransactionId,
            p_description: description,
            p_metadata: metadata
        });

        if (error) {
            // Jika RPC belum ada di database, lakukan fallback transaksi aman di query
            if (error.message && (error.message.includes("function") || error.code === "42883")) {
                return await fallbackCreditWallet({
                    userId,
                    type,
                    amount: numAmount,
                    referenceId,
                    externalTransactionId,
                    description,
                    metadata
                });
            }
            if (isWalletMissing(error)) throw new WalletNotSetupError();
            throw error;
        }

        return data;
    } catch (err) {
        if (isWalletMissing(err)) throw new WalletNotSetupError();
        throw err;
    }
}

/**
 * Potong saldo secara atomik via Stored Procedure / Supabase RPC
 */
async function debitWallet({
    userId,
    type = "PURCHASE",
    amount,
    referenceId,
    externalTransactionId = null,
    description = "Pembelian menggunakan saldo",
    metadata = {}
}) {
    const numAmount = Number(amount);
    if (!numAmount || numAmount <= 0) {
        throw new Error("Nominal debit harus lebih besar dari 0");
    }
    if (!referenceId) {
        throw new Error("reference_id wajib disertakan untuk idempotency");
    }

    try {
        const { data, error } = await supabase.rpc("debit_wallet_atomic", {
            p_user_id: userId,
            p_type: type,
            p_amount: numAmount,
            p_reference_id: referenceId,
            p_external_trx_id: externalTransactionId,
            p_description: description,
            p_metadata: metadata
        });

        if (error) {
            if (error.message && (error.message.includes("function") || error.code === "42883")) {
                return await fallbackDebitWallet({
                    userId,
                    type,
                    amount: numAmount,
                    referenceId,
                    externalTransactionId,
                    description,
                    metadata
                });
            }
            if (isWalletMissing(error)) throw new WalletNotSetupError();
            throw error;
        }

        return data;
    } catch (err) {
        if (isWalletMissing(err)) throw new WalletNotSetupError();
        throw err;
    }
}

/**
 * Refund saldo otomatis jika transaksi fulfillment TokoVoucher gagal
 */
async function refundWallet({
    userId,
    amount,
    referenceId,
    originalOrderId,
    reason = "Pengembalian dana pesanan gagal",
    type = "REFUND"
}) {
    const refundRefId = `RF-${referenceId || originalOrderId}-${Date.now()}`;
    return await creditWallet({
        userId,
        type,
        amount,
        referenceId: refundRefId,
        externalTransactionId: originalOrderId,
        description: `Refund: ${reason} (Order #${originalOrderId})`,
        metadata: { original_order_id: originalOrderId, refund_reason: reason }
    });
}

/**
 * Fallback Credit jika RPC PostgreSQL belum dibuat di Supabase
 */
async function fallbackCreditWallet({
    userId,
    type,
    amount,
    referenceId,
    externalTransactionId,
    description,
    metadata
}) {
    // 1. Idempotency check
    const { data: existingTrx } = await supabase
        .from("wallet_transactions")
        .select("id, balance_after")
        .eq("reference_id", referenceId)
        .maybeSingle();

    if (existingTrx) {
        const wallet = await getOrCreateWallet(userId);
        return {
            success: true,
            idempotent: true,
            message: "Transaksi sudah diproses sebelumnya",
            wallet_id: wallet.id,
            balance: wallet.balance,
            transaction_id: existingTrx.id
        };
    }

    const wallet = await getOrCreateWallet(userId);
    const balanceBefore = Number(wallet.balance) || 0;
    const balanceAfter = balanceBefore + amount;

    // 2. Update wallet
    const { error: updErr } = await supabase
        .from("wallets")
        .update({ balance: balanceAfter, updated_at: new Date().toISOString() })
        .eq("id", wallet.id);

    if (updErr) throw updErr;

    // 3. Insert transaction
    const { data: trx, error: trxErr } = await supabase
        .from("wallet_transactions")
        .insert([{
            wallet_id: wallet.id,
            user_id: userId,
            type,
            amount,
            direction: "IN",
            balance_before: balanceBefore,
            balance_after: balanceAfter,
            reference_id: referenceId,
            external_transaction_id: externalTransactionId,
            description,
            status: "SUCCESS",
            metadata
        }])
        .select()
        .single();

    if (trxErr) throw trxErr;

    await supabase.from("users").update({ balance: balanceAfter }).eq("id", userId);

    return {
        success: true,
        idempotent: false,
        wallet_id: wallet.id,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        amount,
        transaction_id: trx?.id
    };
}

/**
 * Fallback Debit jika RPC PostgreSQL belum dibuat di Supabase
 */
async function fallbackDebitWallet({
    userId,
    type,
    amount,
    referenceId,
    externalTransactionId,
    description,
    metadata
}) {
    // 1. Idempotency check
    const { data: existingTrx } = await supabase
        .from("wallet_transactions")
        .select("id, balance_after")
        .eq("reference_id", referenceId)
        .maybeSingle();

    if (existingTrx) {
        const wallet = await getOrCreateWallet(userId);
        return {
            success: true,
            idempotent: true,
            message: "Transaksi sudah diproses sebelumnya",
            wallet_id: wallet.id,
            balance: wallet.balance,
            transaction_id: existingTrx.id
        };
    }

    const wallet = await getOrCreateWallet(userId);
    const balanceBefore = Number(wallet.balance) || 0;

    if (balanceBefore < amount) {
        throw new Error(`Saldo tidak mencukupi. Saldo saat ini: Rp ${balanceBefore.toLocaleString('id-ID')}, dibutuhkan: Rp ${amount.toLocaleString('id-ID')}`);
    }

    const balanceAfter = balanceBefore - amount;

    // 2. Update wallet
    const { error: updErr } = await supabase
        .from("wallets")
        .update({ balance: balanceAfter, updated_at: new Date().toISOString() })
        .eq("id", wallet.id)
        .gte("balance", amount); // pencegahan race condition di update level

    if (updErr) throw updErr;

    // 3. Insert transaction
    const { data: trx, error: trxErr } = await supabase
        .from("wallet_transactions")
        .insert([{
            wallet_id: wallet.id,
            user_id: userId,
            type,
            amount,
            direction: "OUT",
            balance_before: balanceBefore,
            balance_after: balanceAfter,
            reference_id: referenceId,
            external_transaction_id: externalTransactionId,
            description,
            status: "SUCCESS",
            metadata
        }])
        .select()
        .single();

    if (trxErr) throw trxErr;

    await supabase.from("users").update({ balance: balanceAfter }).eq("id", userId);

    return {
        success: true,
        idempotent: false,
        wallet_id: wallet.id,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        amount,
        transaction_id: trx?.id
    };
}

/**
 * Riwayat Mutasi Transaksi Wallet
 */
async function getWalletMutations(userId, { limit = 20, offset = 0, type = null } = {}) {
    try {
        let query = supabase
            .from("wallet_transactions")
            .select("id, type, amount, direction, balance_before, balance_after, reference_id, external_transaction_id, description, status, metadata, created_at", { count: "exact" })
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .range(offset, offset + limit - 1);

        if (type) {
            query = query.eq("type", type);
        }

        const { data, count, error } = await query;
        if (error) {
            if (isWalletMissing(error)) return { transactions: [], total: 0 };
            throw error;
        }

        return {
            transactions: data || [],
            total: count || 0
        };
    } catch (err) {
        if (isWalletMissing(err)) return { transactions: [], total: 0 };
        throw err;
    }
}

module.exports = {
    getOrCreateWallet,
    getWalletBalance,
    creditWallet,
    debitWallet,
    refundWallet,
    getWalletMutations,
    WalletNotSetupError,
    WALLET_NOT_SETUP_CODE,
    isWalletMissing
};
