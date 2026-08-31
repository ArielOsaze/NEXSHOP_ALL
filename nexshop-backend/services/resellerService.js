const supabase = require("../config/db");

// ===========================================================
// KONTEKS RESELLER
//
// Satu sumber kebenaran buat pertanyaan "user ini reseller bukan, dan
// diskonnya berapa persen?". Dipakai di checkout dan di feed katalog,
// jadi harga yang KELIHATAN di toko dan harga yang DITAGIH pas checkout
// selalu dihitung dari data yang sama.
//
// Daftar tier di-cache sebentar di memori: dia jarang berubah tapi kebaca
// di hampir tiap request katalog. Cache-nya dibuang otomatis pas admin
// ngubah persen tier (lihat invalidateTierCache).
// ===========================================================

const TIER_CACHE_TTL_MS = 60 * 1000;
const TIER_ELIGIBILITY = Object.freeze({
    silver: Object.freeze({ metric: "monthly_transaction_average", operator: "none", minimum: 0, requirement: "Belum ada minimum transaksi bulanan." }),
    gold: Object.freeze({ metric: "monthly_transaction_average", operator: "gte", minimum: 50000000, requirement: "Rata-rata transaksi per bulan minimal Rp50.000.000." }),
    platinum: Object.freeze({ metric: "monthly_transaction_average", operator: "gt", minimum: 100000000, requirement: "Rata-rata transaksi per bulan di atas Rp100.000.000." })
});

function getTierEligibility(code) {
    return TIER_ELIGIBILITY[String(code || "").toLowerCase()] || null;
}

let tierCache = null;
let tierCacheAt = 0;

// Tabel reseller belum ada = migration 008 belum dijalankan. Ditandai
// khusus supaya controller bisa balas pesan "belum di-setup" yang ramah,
// bukan error 500 mentah (pola yang sama dipakai fitur rating topup).
function isMissingTableError(error) {
    if (!error) return false;
    const kode = String(error.code || "");
    // 42P01: undefined_table
    // 42703: undefined_column (bukan bukti tabel belum di-setup)
    return kode === "42P01";
}

function invalidateTierCache() {
    tierCache = null;
    tierCacheAt = 0;
}

async function getTiers({ activeOnly = true } = {}) {
    const now = Date.now();
    if (tierCache && now - tierCacheAt < TIER_CACHE_TTL_MS) {
        return activeOnly ? tierCache.filter((t) => t.is_active) : tierCache;
    }

    const { data, error } = await supabase
        .from("reseller_tiers")
        .select("code, name, discount_percent, description, sort_order, is_active")
        .order("sort_order", { ascending: true });

    if (error) {
        if (isMissingTableError(error)) return [];
        throw error;
    }

    tierCache = (data || []).map((t) => ({ ...t, discount_percent: Number(t.discount_percent) || 0, eligibility: getTierEligibility(t.code) }));
    tierCacheAt = now;
    return activeOnly ? tierCache.filter((t) => t.is_active) : tierCache;
}

async function getTier(code) {
    if (!code) return null;
    const tiers = await getTiers({ activeOnly: false });
    return tiers.find((t) => String(t.code || "").toLowerCase() === String(code).toLowerCase()) || null;
}

// Konteks harga buat SATU user. Selalu balik objek (gak pernah null) biar
// pemanggilnya gak perlu ngecek null di mana-mana.
//   { isReseller, tier, discountPercent }
async function getResellerContext(userId) {
    const kosong = { isReseller: false, tier: null, discountPercent: 0 };
    if (!userId) return kosong;

    const { data, error } = await supabase
        .from("users")
        .select("reseller_status, reseller_tier")
        .eq("id", userId)
        .maybeSingle();

    // Kolomnya belum ada (migration belum jalan) atau user gak ketemu ->
    // perlakukan sebagai user biasa. Fitur reseller mati, checkout normal
    // tetap jalan.
    if (error || !data) return kosong;
    if (data.reseller_status !== "approved") return kosong;

    const tier = await getTier(data.reseller_tier);
    if (!tier || !tier.is_active) return kosong;

    return { isReseller: true, tier, discountPercent: Number(tier.discount_percent) || 0 };
}

module.exports = {
    getTiers,
    getTier,
    getResellerContext,
    invalidateTierCache,
    isMissingTableError
};
