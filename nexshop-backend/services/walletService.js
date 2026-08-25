const supabase = require("../config/db");
const { isMissingTableError } = require("./resellerService");

const WALLET_NOT_SETUP_CODE = "WALLET_NOT_SETUP";
const WALLET_NOT_SETUP_MESSAGE = "Fitur Dompet (Wallet) saat ini sedang tidak tersedia.";

class WalletNotSetupError extends Error {
    constructor() {
        super(WALLET_NOT_SETUP_MESSAGE);
        this.name = "WalletNotSetupError";
        this.code = WALLET_NOT_SETUP_CODE;
        this.status = 503;
    }
}

// RPC atomik di PostgreSQL mengembalikan bentuk yang BERBEDA antara jalur
// normal ({balance_before, balance_after, ...}) dan jalur idempotent
// ({balance, ...}). Pemanggil (mis. resellerApiController) membaca
// `balance_after`, jadi pada respons idempotent nilainya undefined dan
// saldo sisa yang dikirim ke mitra jadi kosong. Normalisasi di satu tempat:
// balance dan balance_after selalu terisi, apa pun jalurnya.
function normalizeWalletResult(result) {
    if (!result || typeof result !== "object") return result;
    const after = result.balance_after != null ? result.balance_after : result.balance;
    return {
        ...result,
        balance: Number(result.balance != null ? result.balance : after) || 0,
        balance_after: Number(after) || 0
    };
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
                return normalizeWalletResult(await fallbackCreditWallet({
                    userId,
                    type,
                    amount: numAmount,
                    referenceId,
                    externalTransactionId,
                    description,
                    metadata
                }));
            }
            if (isWalletMissing(error)) throw new WalletNotSetupError();
            throw error;
        }

        return normalizeWalletResult(data);
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
                return normalizeWalletResult(await fallbackDebitWallet({
                    userId,
                    type,
                    amount: numAmount,
                    referenceId,
                    externalTransactionId,
                    description,
                    metadata
                }));
            }
            if (isWalletMissing(error)) throw new WalletNotSetupError();
            throw error;
        }

        return normalizeWalletResult(data);
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

// ===========================================================
// JALUR CADANGAN (dipakai HANYA kalau RPC credit_wallet_atomic /
// debit_wallet_atomic belum ada di Supabase)
//
// Versi sebelumnya memakai pola baca-lalu-tulis polos:
//     baca saldo -> hitung saldo baru -> UPDATE wallets SET balance = baru
// Itu tidak aman untuk uang. Dua request bersamaan sama-sama membaca saldo
// lama, lalu keduanya menulis hasil hitungannya sendiri -- yang menang
// adalah penulis terakhir, dan potongan/penambahan yang satunya HILANG
// (lost update). Pada debit, versi lama juga sudah memasang
// `.gte("balance", amount)` tapi TIDAK PERNAH memeriksa apakah UPDATE-nya
// benar-benar mengenai baris: kalau saldo keburu habis, update-nya diam-diam
// nol baris, kodenya tetap lanjut mencatat mutasi, lalu MENIMPA
// users.balance dengan angka basi -- uang tercipta kembali.
//
// Sekarang keduanya memakai compare-and-swap: UPDATE hanya boleh mengenai
// baris yang saldonya MASIH sama persis dengan yang barusan dibaca
// (.eq("balance", balanceBefore)), dan hasilnya di-.select() supaya jumlah
// baris terdampak bisa diperiksa. Kalau 0 baris (ada yang menyalip), operasi
// diulang dengan saldo terbaru. Ini membuat jalur cadangan aman tanpa perlu
// transaksi database.
// ===========================================================

const CAS_MAX_RETRY = 5;

function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

// Idempotency: satu reference_id = satu mutasi, selamanya.
async function findExistingTransaction(referenceId) {
    const { data } = await supabase
        .from("wallet_transactions")
        .select("id, balance_after")
        .eq("reference_id", referenceId)
        .maybeSingle();
    return data || null;
}

/**
 * Inti compare-and-swap untuk kedua arah mutasi.
 * @param {"IN"|"OUT"} direction
 */
async function fallbackMutateWallet({
    userId,
    type,
    amount,
    referenceId,
    externalTransactionId,
    description,
    metadata,
    direction
}) {
    const existing = await findExistingTransaction(referenceId);
    if (existing) {
        const wallet = await getOrCreateWallet(userId);
        return {
            success: true,
            idempotent: true,
            message: "Transaksi sudah diproses sebelumnya",
            wallet_id: wallet.id,
            balance: wallet.balance,
            balance_after: wallet.balance,
            transaction_id: existing.id
        };
    }

    let lastError = null;

    for (let attempt = 0; attempt < CAS_MAX_RETRY; attempt++) {
        const wallet = await getOrCreateWallet(userId);

        if (wallet.status && wallet.status !== "ACTIVE") {
            throw new Error("Dompet saldo sedang dibekukan atau nonaktif.");
        }

        const balanceBefore = toNumber(wallet.balance);

        if (direction === "OUT" && balanceBefore < amount) {
            throw new Error(
                `Saldo tidak mencukupi. Saldo saat ini: Rp ${balanceBefore.toLocaleString("id-ID")}, dibutuhkan: Rp ${amount.toLocaleString("id-ID")}`
            );
        }

        const balanceAfter = direction === "OUT" ? balanceBefore - amount : balanceBefore + amount;

        // COMPARE-AND-SWAP: hanya kena kalau saldo belum berubah sejak dibaca.
        const { data: swapped, error: updErr } = await supabase
            .from("wallets")
            .update({ balance: balanceAfter, updated_at: new Date().toISOString() })
            .eq("id", wallet.id)
            .eq("balance", balanceBefore)
            .select("id, balance");

        if (updErr) {
            if (isWalletMissing(updErr)) throw new WalletNotSetupError();
            throw updErr;
        }

        // 0 baris = ada mutasi lain yang menyalip di antara baca & tulis.
        // Ulangi dari saldo terbaru, jangan pernah lanjut dengan angka basi.
        if (!swapped || swapped.length === 0) {
            lastError = new Error("Saldo sedang berubah oleh transaksi lain");
            continue;
        }

        // Catat mutasi ke ledger. reference_id UNIQUE di database, jadi kalau
        // request kembar menang balapan di sini, insert-nya gagal 23505 --
        // saldo dikembalikan ke nilai semula lalu hasil milik pemenang
        // dipakai, supaya tidak ada mutasi ganda untuk satu reference_id.
        const { data: trx, error: trxErr } = await supabase
            .from("wallet_transactions")
            .insert([{
                wallet_id: wallet.id,
                user_id: userId,
                type,
                amount,
                direction,
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

        if (trxErr) {
            await supabase
                .from("wallets")
                .update({ balance: balanceBefore, updated_at: new Date().toISOString() })
                .eq("id", wallet.id)
                .eq("balance", balanceAfter);

            if (String(trxErr.code) === "23505") {
                const winner = await findExistingTransaction(referenceId);
                const current = await getOrCreateWallet(userId);
                return {
                    success: true,
                    idempotent: true,
                    message: "Transaksi sudah diproses sebelumnya",
                    wallet_id: current.id,
                    balance: current.balance,
                    balance_after: current.balance,
                    transaction_id: winner ? winner.id : null
                };
            }
            throw trxErr;
        }

        // users.balance cuma cermin buat tampilan cepat; sumber kebenarannya
        // tetap tabel wallets. Ditulis setelah ledger aman.
        await supabase.from("users").update({ balance: balanceAfter }).eq("id", userId);

        return {
            success: true,
            idempotent: false,
            wallet_id: wallet.id,
            balance_before: balanceBefore,
            balance_after: balanceAfter,
            balance: balanceAfter,
            amount,
            transaction_id: trx ? trx.id : null
        };
    }

    throw lastError || new Error("Gagal memperbarui saldo setelah beberapa kali percobaan. Coba lagi sebentar lagi.");
}

async function fallbackCreditWallet(args) {
    return fallbackMutateWallet({ ...args, direction: "IN" });
}

async function fallbackDebitWallet(args) {
    return fallbackMutateWallet({ ...args, direction: "OUT" });
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
