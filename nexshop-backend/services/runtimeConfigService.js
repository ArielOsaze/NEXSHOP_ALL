const supabase = require("../config/db");

// Tambahkan konfigurasi runtime baru di sini. Dashboard membaca daftar ini
// langsung dari backend, jadi penambahan field tidak membutuhkan perubahan
// skema database atau edit .env di VPS.
const RUNTIME_CONFIG_FIELDS = Object.freeze({
    TURNSTILE_SITE_KEY: {
        label: "Turnstile Site Key",
        description: "Site key publik dari Cloudflare Turnstile.",
        type: "text",
        secret: false,
        maxLength: 2048
    },
    TURNSTILE_SECRET_KEY: {
        label: "Turnstile Secret Key",
        description: "Secret key Turnstile. Nilainya selalu disamarkan.",
        type: "secret",
        secret: true,
        maxLength: 4096
    },
    TURNSTILE_ALLOWED_HOSTNAMES: {
        label: "Hostname yang diizinkan",
        description: "Pisahkan dengan koma, mis. nexshop.cloud, www.nexshop.cloud.",
        type: "text",
        secret: false,
        maxLength: 1024
    },
    TURNSTILE_REQUIRED: {
        label: "Wajibkan Turnstile",
        description: "Jika aktif, registrasi dan login ditolak saat verifikasi Turnstile belum siap.",
        type: "boolean",
        secret: false
    },
    GOOGLE_OAUTH_CLIENT_ID: {
        label: "Google OAuth Client ID",
        description: "OAuth 2.0 Client ID dari Google Cloud.",
        type: "text",
        secret: false,
        maxLength: 2048
    },
    GOOGLE_OAUTH_CLIENT_SECRET: {
        label: "Google OAuth Client Secret",
        description: "Client secret Google OAuth. Nilainya selalu disamarkan.",
        type: "secret",
        secret: true,
        maxLength: 4096
    },
    GOOGLE_OAUTH_REDIRECT_URI: {
        label: "Google OAuth Redirect URI",
        description: "Harus sama persis dengan Authorized redirect URI di Google Cloud.",
        type: "url",
        secret: false,
        maxLength: 2048
    }
});

const CACHE_TTL_MS = 30 * 1000;
let runtimeConfigCache = { data: null, ts: 0 };

function envFallback() {
    const fallback = {};
    for (const [key, field] of Object.entries(RUNTIME_CONFIG_FIELDS)) {
        const raw = process.env[key];
        fallback[key] = field.type === "boolean" ? raw === "true" : String(raw || "").trim();
    }
    return fallback;
}

async function getRuntimeConfig({ fresh = false, strict = false } = {}) {
    const now = Date.now();
    if (!fresh && runtimeConfigCache.data && now - runtimeConfigCache.ts < CACHE_TTL_MS) {
        return runtimeConfigCache.data;
    }

    const { data, error } = await supabase
        .from("runtime_config")
        .select("config")
        .eq("id", 1)
        .maybeSingle();

    if (error) {
        console.warn("Gagal mengambil runtime_config, memakai fallback .env:", error.message);
        if (strict) throw error;
    }

    const stored = data && data.config && typeof data.config === "object" ? data.config : {};
    const merged = envFallback();
    for (const [key, field] of Object.entries(RUNTIME_CONFIG_FIELDS)) {
        if (stored[key] === undefined || stored[key] === null || stored[key] === "") continue;
        merged[key] = field.type === "boolean" ? stored[key] === true || stored[key] === "true" : String(stored[key]).trim();
    }

    runtimeConfigCache = { data: merged, ts: now };
    return merged;
}

function normalizeHostnameList(value) {
    const hostnames = String(value || "").split(",").map(item => item.trim().toLowerCase()).filter(Boolean);
    if (hostnames.some(hostname => !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname))) {
        throw new Error("Hostname Turnstile tidak valid. Gunakan nama domain tanpa http:// atau path.");
    }
    return [...new Set(hostnames)].join(",");
}

function normalizeRedirectUri(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    let parsed;
    try {
        parsed = new URL(raw);
    } catch (_) {
        throw new Error("Google OAuth Redirect URI tidak valid.");
    }
    const local = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) {
        throw new Error("Google OAuth Redirect URI harus URL HTTP(S) tanpa kredensial atau fragment.");
    }
    if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:" && !local) {
        throw new Error("Google OAuth Redirect URI wajib HTTPS di production.");
    }
    if (parsed.pathname !== "/api/auth/google/callback" || parsed.search) {
        throw new Error("Google OAuth Redirect URI harus berakhir dengan /api/auth/google/callback tanpa query.");
    }
    return parsed.toString();
}

function normalizeValue(key, value) {
    const field = RUNTIME_CONFIG_FIELDS[key];
    if (!field) throw new Error("Konfigurasi runtime tidak dikenali.");
    if (field.type === "boolean") {
        if (typeof value !== "boolean" && value !== "true" && value !== "false") {
            throw new Error(`${field.label} harus bernilai true atau false.`);
        }
        return value === true || value === "true";
    }
    const normalized = String(value || "").trim();
    if (normalized.length > field.maxLength) throw new Error(`${field.label} terlalu panjang.`);
    if (key === "TURNSTILE_ALLOWED_HOSTNAMES") return normalizeHostnameList(normalized);
    if (key === "GOOGLE_OAUTH_REDIRECT_URI") return normalizeRedirectUri(normalized);
    return normalized;
}

async function updateRuntimeConfig(values, clearKeys = []) {
    // Ambil raw config agar nilai yang kosong dari .env tidak ikut tersimpan
    // dan tetap dapat berubah lewat fallback environment.
    const { data: row, error: readError } = await supabase
        .from("runtime_config")
        .select("config")
        .eq("id", 1)
        .maybeSingle();
    if (readError) return { error: readError };

    const config = row?.config && typeof row.config === "object" ? { ...row.config } : {};
    const changedKeys = [];
    for (const [key, value] of Object.entries(values || {})) {
        if (!Object.prototype.hasOwnProperty.call(RUNTIME_CONFIG_FIELDS, key)) continue;
        // Secret kosong berarti tidak diubah. Gunakan clear_keys bila ingin
        // menghapus override dashboard dan kembali ke fallback .env.
        if (RUNTIME_CONFIG_FIELDS[key].secret && String(value || "").trim() === "") continue;
        config[key] = normalizeValue(key, value);
        changedKeys.push(key);
    }
    for (const key of clearKeys || []) {
        if (!Object.prototype.hasOwnProperty.call(RUNTIME_CONFIG_FIELDS, key)) continue;
        delete config[key];
        changedKeys.push(key);
    }

    const { error } = await supabase
        .from("runtime_config")
        .upsert({ id: 1, config, updated_at: new Date().toISOString() }, { onConflict: "id" });
    if (!error) runtimeConfigCache = { data: null, ts: 0 };
    return { error, changedKeys: [...new Set(changedKeys)] };
}

function mask(value) {
    const stringValue = String(value || "");
    if (!stringValue) return "";
    if (stringValue.length <= 6) return "••••••";
    return `${stringValue.slice(0, 4)}••••••••${stringValue.slice(-4)}`;
}

function getAdminRuntimeConfig(config) {
    return Object.entries(RUNTIME_CONFIG_FIELDS).map(([key, field]) => ({
        key,
        label: field.label,
        description: field.description,
        type: field.type,
        secret: field.secret,
        configured: field.type === "boolean" ? true : Boolean(config[key]),
        value: field.secret ? mask(config[key]) : config[key]
    }));
}

module.exports = {
    RUNTIME_CONFIG_FIELDS,
    getRuntimeConfig,
    updateRuntimeConfig,
    getAdminRuntimeConfig
};
