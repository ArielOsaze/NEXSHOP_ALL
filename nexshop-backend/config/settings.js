const axios = require("axios");
const supabase = require("./db");

const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";
const GEMINI_FALLBACK_MODELS = [
    "gemini-flash-latest",
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-pro-latest",
    "gemini-3.5-flash",
    "gemini-2.0-flash-lite"
];

function normalizeGeminiModel(modelInput) {
    const trimmed = String(modelInput || "").trim();
    if (!trimmed || trimmed === "gemini-2.5-flash") {
        return DEFAULT_GEMINI_MODEL;
    }
    return trimmed;
}

async function callGeminiWithFallback({ apiKey, preferredModel, contents, generationConfig, timeoutMs = 10000 }) {
    const geminiProvider = require("../services/geminiProvider");
    const userPrompt = Array.isArray(contents) && contents[0]?.parts ? contents[0].parts.map(p => p.text).join("\n") : "Ping test";
    const res = await geminiProvider.generateContent({
        apiKey,
        preferredModel: normalizeGeminiModel(preferredModel),
        prompt: userPrompt,
        timeoutMs
    });
    return {
        success: res.success,
        reply: res.reply,
        activeModel: res.model,
        responseTimeMs: res.latencyMs,
        tokenUsage: res.tokenUsage,
        httpStatus: res.httpStatus,
        error: res.error
    };
}

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
        apigames_secret_key: (data && data.apigames_secret_key) || process.env.APIGAMES_SECRET_KEY || "",
        brevo_api_key: (data && data.brevo_api_key) || process.env.BREVO_API_KEY || "",
        brevo_sender_email: (data && data.brevo_sender_email) || process.env.EMAIL_USER || "",
        brevo_sender_name: (data && data.brevo_sender_name) || process.env.BREVO_SENDER_NAME || "NexShop",
        waapi_url: (data && data.waapi_url) || process.env.WAAPI_URL || "",
        waapi_key: (data && data.waapi_key) || process.env.WAAPI_KEY || "",
        waapi_target_number: (data && data.waapi_target_number) || process.env.WAAPI_TARGET_NUMBER || "",
        gemini_api_key: (data && data.gemini_api_key) || process.env.GEMINI_API_KEY || "",
        gemini_news_model: normalizeGeminiModel((data && data.gemini_news_model) || process.env.GEMINI_NEWS_MODEL),
        smtp_host: (data && data.smtp_host) || process.env.SMTP_HOST || "",
        smtp_port: (data && data.smtp_port) || process.env.SMTP_PORT || "",
        smtp_user: (data && data.smtp_user) || process.env.SMTP_USER || "",
        smtp_password: (data && data.smtp_password) || process.env.SMTP_PASSWORD || "",
        smtp_from_email: (data && data.smtp_from_email) || process.env.SMTP_FROM_EMAIL || "",
        smtp_from_name: (data && data.smtp_from_name) || process.env.SMTP_FROM_NAME || "NexShop"
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
        "apigames_secret_key",
        "brevo_api_key",
        "brevo_sender_email",
        "brevo_sender_name",
        "waapi_url",
        "waapi_key",
        "waapi_target_number",
        "gemini_api_key",
        "gemini_news_model",
        "smtp_host",
        "smtp_port",
        "smtp_user",
        "smtp_password",
        "smtp_from_email",
        "smtp_from_name"
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
        trust_bar_games_offset: 0,
        event_mascot: null,
        ticker_text: "Transaksi aman dan cepat 24/7|Pembayaran QRIS & e-Wallet didukung|100% Legal & Terpercaya|Customer Service siap membantu",
        ticker_speed_seconds: 30
    };

    storeSettingsCache = { data: merged, ts: now };
    return merged;
}

async function updateStoreSettings(payload) {
    const allowed = [
        "store_name", "tagline", "contact_whatsapp", "contact_email", "contact_phone",
        "address", "logo_url", "faq", "terms_content", "refund_content", "trust_bar_enabled",
        "trust_bar_orders_offset", "trust_bar_games_offset", "event_mascot",
        "ticker_text", "ticker_speed_seconds"
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
    updateStoreSettings,
    DEFAULT_GEMINI_MODEL,
    GEMINI_FALLBACK_MODELS,
    normalizeGeminiModel,
    callGeminiWithFallback
};
