const supabase = require("./db");

// Cache ringan (30 detik) supaya tiap request checkout/transaksi gak selalu
// query dulu ke tabel settings — tapi tetap cukup responsif kalau admin baru
// saja ganti key dari dashboard.
const CACHE_TTL_MS = 30 * 1000;
let apiKeysCache = { data: null, ts: 0 };
let storeSettingsCache = { data: null, ts: 0 };

// ===========================
// API KEYS (Midtrans + TokoVoucher)
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
        midtrans_server_key: (data && data.midtrans_server_key) || process.env.MIDTRANS_SERVER_KEY || "",
        midtrans_client_key: (data && data.midtrans_client_key) || process.env.MIDTRANS_CLIENT_KEY || "",
        midtrans_is_production: data && data.midtrans_is_production !== null
            ? data.midtrans_is_production
            : (process.env.MIDTRANS_IS_PRODUCTION === "true"),
        tokovoucher_member_code: (data && data.tokovoucher_member_code) || process.env.TOKOVOUCHER_MEMBER_CODE || "",
        tokovoucher_secret: (data && data.tokovoucher_secret) || process.env.TOKOVOUCHER_SECRET || ""
    };

    apiKeysCache = { data: merged, ts: now };
    return merged;
}

async function updateApiKeys(payload) {
    const allowed = [
        "midtrans_server_key",
        "midtrans_client_key",
        "midtrans_is_production",
        "tokovoucher_member_code",
        "tokovoucher_secret"
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
        logo_url: ""
    };

    storeSettingsCache = { data: merged, ts: now };
    return merged;
}

async function updateStoreSettings(payload) {
    const allowed = ["store_name", "tagline", "contact_whatsapp", "contact_email", "logo_url"];
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
