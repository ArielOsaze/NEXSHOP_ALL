const supabase = require("./db");

// Cache ringan (30 detik) supaya tiap request checkout/transaksi gak selalu
// query dulu ke tabel settings — tapi tetap cukup responsif kalau admin baru
// saja ganti key dari dashboard.
const CACHE_TTL_MS = 30 * 1000;
let apiKeysCache = { data: null, ts: 0 };
let storeSettingsCache = { data: null, ts: 0 };

// ===========================
// API KEYS (iPaymu + TokoVoucher)
// ===========================
async function getApiKeys({ fresh = false } = {}) {
    const now = Date.now();
    if (!fresh && apiKeysCache.data && now - apiKeysCache.ts < CACHE_TTL_MS) {
        return apiKeysCache.data;
    }

    const { data, error } = await supabase
        .from("api_keys")
        .select("*")
        .eq("id", 1)
        .maybeSingle();

    if (error) {
        console.log("⚠️ Gagal ambil api_keys dari DB, pakai .env sebagai fallback:", error.message);
    }

    // fallback ke .env kalau baris DB kosong / kolom tertentu belum diisi admin
    const merged = {
        ipaymu_va: (data && data.ipaymu_va) || process.env.IPAYMU_VA || "",
        ipaymu_api_key: (data && data.ipaymu_api_key) || process.env.IPAYMU_API_KEY || "",
        ipaymu_is_production: data && data.ipaymu_is_production !== null
            ? data.ipaymu_is_production
            : (process.env.IPAYMU_IS_PRODUCTION === "true"),
        tokovoucher_member_code: (data && data.tokovoucher_member_code) || process.env.TOKOVOUCHER_MEMBER_CODE || "",
        tokovoucher_secret: (data && data.tokovoucher_secret) || process.env.TOKOVOUCHER_SECRET || "",
        apigames_merchant_id: (data && data.apigames_merchant_id) || process.env.APIGAMES_MERCHANT_ID || "",
        apigames_secret_key: (data && data.apigames_secret_key) || process.env.APIGAMES_SECRET_KEY || ""
    };

    apiKeysCache = { data: merged, ts: now };
    return merged;
}

async function updateApiKeys(payload) {
    const allowed = [
        "ipaymu_va",
        "ipaymu_api_key",
        "ipaymu_is_production",
        "tokovoucher_member_code",
        "tokovoucher_secret",
        "apigames_merchant_id",
        "apigames_secret_key"
    ];
    const updatePayload = { updated_at: new Date().toISOString() };
    for (const key of allowed) {
        if (payload[key] !== undefined && payload[key] !== "") {
            updatePayload[key] = payload[key];
        }
    }

    const { data, error } = await supabase
        .from("api_keys")
        .update(updatePayload)
        .eq("id", 1)
        .select()
        .maybeSingle();

    if (!error) {
        apiKeysCache = { data: null, ts: 0 }; // invalidate cache
    }

    return { data, error };
}

// ===========================
// STORE SETTINGS (nama toko, kontak, logo)
// ===========================
async function getStoreSettings({ fresh = false } = {}) {
    const now = Date.now();
    if (!fresh && storeSettingsCache.data && now - storeSettingsCache.ts < CACHE_TTL_MS) {
        return storeSettingsCache.data;
    }

    const { data, error } = await supabase
        .from("store_settings")
        .select("*")
        .eq("id", 1)
        .maybeSingle();

    if (error) {
        console.log("⚠️ Gagal ambil store_settings:", error.message);
    }

    const merged = data || {
        store_name: "NexShop",
        tagline: "Play More. Pay Less.",
        contact_whatsapp: "",
        contact_email: "",
        contact_phone: "",
        address: "",
        logo_url: "",
        faq: [],
        terms_content: "",
        refund_content: "",
        trust_bar_enabled: true,
        trust_bar_orders_offset: 0,
        trust_bar_games_offset: 0
    };

    storeSettingsCache = { data: merged, ts: now };
    return merged;
}

async function updateStoreSettings(payload) {
    const allowed = [
        "store_name", "tagline", "contact_whatsapp", "contact_email", "contact_phone",
        "address", "logo_url", "faq", "terms_content", "refund_content", "trust_bar_enabled",
        "trust_bar_orders_offset", "trust_bar_games_offset"
    ];
    const updatePayload = { updated_at: new Date().toISOString() };
    for (const key of allowed) {
        if (payload[key] !== undefined) {
            updatePayload[key] = payload[key];
        }
    }

    const { data, error } = await supabase
        .from("store_settings")
        .update(updatePayload)
        .eq("id", 1)
        .select()
        .maybeSingle();

    if (!error) {
        storeSettingsCache = { data: null, ts: 0 };
    }

    return { data, error };
}

module.exports = {
    getApiKeys,
    updateApiKeys,
    getStoreSettings,
    updateStoreSettings
};
