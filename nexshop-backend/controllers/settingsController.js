const supabase = require("../config/db");
const bcrypt = require("bcrypt");
const axios = require("axios");
const { notify } = require("../config/notify");
const { isValidSecurityPin, verifyAdminPin, logSensitiveAction } = require("../middleware/adminPinMiddleware");
const { sendAdminPinChangeOtpEmail } = require("../config/mailer");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { assertSafeOutboundUrl, validateWebhookUrlShape } = require("../utils/safeOutboundUrl");
const { isAllowedChromeExecutable } = require("../utils/chromeExecutable");

const PIN_CHANGE_OTP_TTL_MS = 5 * 60 * 1000;
const PIN_CHANGE_OTP_MAX_ATTEMPTS = 5;

function normalizeSeoSettings(payload) {
    const normalized = { ...payload };

    if (normalized.seo_screenshot_base_url !== undefined) {
        const rawUrl = String(normalized.seo_screenshot_base_url || "").trim();
        if (!rawUrl) {
            normalized.seo_screenshot_base_url = "";
        } else {
            let parsed;
            try {
                parsed = new URL(rawUrl);
            } catch {
                throw new Error("SEO Screenshot Base URL tidak valid.");
            }
            const isLocalDevelopment = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
            if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
                throw new Error("SEO Screenshot Base URL harus berupa origin HTTP(S) tanpa kredensial.");
            }
            if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:" && !isLocalDevelopment) {
                throw new Error("SEO Screenshot Base URL wajib HTTPS di production.");
            }
            if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
                throw new Error("SEO Screenshot Base URL hanya boleh berisi origin, tanpa path, query, atau hash.");
            }
            normalized.seo_screenshot_base_url = parsed.origin;
        }
    }

    if (normalized.chrome_executable_path !== undefined) {
        const executablePath = String(normalized.chrome_executable_path || "").trim();
        if (!executablePath) {
            normalized.chrome_executable_path = "";
        } else {
            const executableName = path.basename(executablePath).toLowerCase();
            const allowedBrowserName = /^(?:google-chrome(?:-stable)?|chromium(?:-browser)?|chrome|msedge)(?:\.exe)?$/;
            if (!path.isAbsolute(executablePath) || !allowedBrowserName.test(executableName)) {
                throw new Error("Chrome Executable Path harus path absolut menuju Chrome, Chromium, atau Edge.");
            }
            if (!fs.existsSync(executablePath)) {
                throw new Error("Chrome Executable Path tidak ditemukan pada server backend.");
            }
            if (!isAllowedChromeExecutable(executablePath)) {
                throw new Error("Chrome Executable Path harus menunjuk ke lokasi Chrome/Chromium sistem yang diizinkan.");
            }
            normalized.chrome_executable_path = path.normalize(executablePath);
        }
    }

    return normalized;
}

function hashPinChangeOtp(otp) {
    return crypto.createHash("sha256").update(otp).digest("hex");
}

function generatePinChangeOtp() {
    return String(crypto.randomInt(100000, 1000000));
}
const {
    getStoreSettings,
    updateStoreSettings,
    getApiKeys,
    updateApiKeys
} = require("../config/settings");
const {
    RUNTIME_CONFIG_FIELDS,
    getRuntimeConfig,
    updateRuntimeConfig,
    getAdminRuntimeConfig
} = require("../services/runtimeConfigService");

// ===========================================================
// STORE SETTINGS — nama toko, tagline, kontak, logo
// ===========================================================

// Publik — dipakai frontend toko buat nampilin nama/logo/kontak
exports.getStoreSettingsPublic = async (req, res) => {
    try {
        const data = await getStoreSettings();
        // API publik sengaja hanya mengirim field storefront yang aman.
        const publicSettings = (({
            store_name, tagline, contact_whatsapp, contact_email, contact_phone, contact_instagram, address,
            logo_url, faq, terms_content, refund_content, trust_bar_enabled,
            trust_bar_orders_offset, trust_bar_games_offset, event_mascot,
            ticker_text, ticker_speed_seconds
        }) => ({ store_name, tagline, contact_whatsapp, contact_email, contact_phone, contact_instagram, address,
            logo_url, faq, terms_content, refund_content, trust_bar_enabled,
            trust_bar_orders_offset, trust_bar_games_offset, event_mascot,
            ticker_text, ticker_speed_seconds }))(data);
        res.json(publicSettings);
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

// Admin only
exports.updateStoreSettingsAdmin = async (req, res) => {
    if (!["admin", "staff"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    try {
        const { data, error } = await updateStoreSettings(req.body);
        if (error) {
            console.log(error);
            return res.status(500).json({ message: "Gagal update pengaturan toko" });
        }
        notify("settings", `⚙️ ${req.user.email} mengubah pengaturan toko`);
        res.json({ message: "Pengaturan toko berhasil disimpan", data });
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

// ===========================================================
// API KEYS — iPaymu + TokoVoucher (admin only, key sensitif di-mask)
// ===========================================================
function mask(value) {
    if (!value) return "";
    if (value.length <= 6) return "••••••";
    return value.slice(0, 4) + "••••••••" + value.slice(-4);
}

function securityPinSchemaMessage(error) {
    const code = String(error && error.code || "");
    if (["42703", "PGRST204", "PGRST205", "42P01"].includes(code)) {
        return "Schema Security PIN belum tersedia. Jalankan migrations-18-admin-configuration-security.sql di Supabase SQL Editor.";
    }
    return "Gagal memeriksa Security PIN Admin";
}

exports.getAdminPinStatus = async (req, res) => {
    try {
        const { data, error } = await supabase.from("users").select("security_pin_hash").eq("id", req.user.id).maybeSingle();
        if (error) return res.status(500).json({ message: securityPinSchemaMessage(error) });
        if (!data) return res.status(404).json({ message: "User tidak ditemukan" });
        return res.json({ configured: !!data.security_pin_hash });
    } catch (err) {
        return res.status(500).json({ message: "Server gagal memeriksa Security PIN Admin" });
    }
};

exports.setupAdminPin = async (req, res) => {
    const pin = req.body && req.body.pin;
    const confirmation = req.body && req.body.confirmation;
    if (!isValidSecurityPin(pin) || pin !== confirmation) {
        return res.status(400).json({ message: "Security PIN harus 6 digit dan kedua input harus sama" });
    }
    try {
        const { data: user, error: readError } = await supabase.from("users").select("security_pin_hash").eq("id", req.user.id).maybeSingle();
        if (readError) return res.status(500).json({ message: securityPinSchemaMessage(readError) });
        if (!user) return res.status(404).json({ message: "User tidak ditemukan" });
        if (user.security_pin_hash) return res.status(409).json({ message: "Security PIN sudah dibuat. Gunakan verifikasi PIN." });
        const security_pin_hash = await bcrypt.hash(pin, 12);
        const { error: updateError } = await supabase.from("users").update({ security_pin_hash, security_pin_updated_at: new Date().toISOString() }).eq("id", req.user.id);
        if (updateError) return res.status(500).json({ message: securityPinSchemaMessage(updateError) });
        notify("security", `${req.user.email} membuat Security PIN Admin`);
        await logSensitiveAction(req, "PIN_CREATED");
        return res.status(201).json({ message: "Security PIN Admin berhasil dibuat" });
    } catch (err) {
        return res.status(500).json({ message: "Server gagal membuat Security PIN Admin" });
    }
};

exports.verifyAdminPin = async (req, res) => {
    const checked = await verifyAdminPin(req, req.body && req.body.pin);
    if (!checked.ok) {
        res.set("X-Admin-Pin-Error", "1");
        return res.status(checked.status).json({ message: checked.message, code: checked.code });
    }
    // Tidak ada token, TTL, atau sesi tepercaya setelah respons ini.
    return res.json({ message: "Security PIN terverifikasi" });
};

// Perubahan PIN adalah alur terpisah dari verifikasi aksi sensitif biasa.
// Tidak ada trusted-PIN session: hanya bukti OTP satu-kali milik admin yang
// bertahan sampai lima menit dan selalu dihapus setelah PIN diperbarui.
exports.requestAdminPinChangeOtp = async (req, res) => {
    try {
        const otp = generatePinChangeOtp();
        const expiresAt = new Date(Date.now() + PIN_CHANGE_OTP_TTL_MS).toISOString();
        const { error } = await supabase.from("users").update({
            security_pin_change_otp_hash: hashPinChangeOtp(otp),
            security_pin_change_otp_expires_at: expiresAt,
            security_pin_change_otp_attempts: 0,
            security_pin_change_otp_verified_at: null
        }).eq("id", req.user.id);
        if (error) return res.status(500).json({ message: securityPinSchemaMessage(error) });

        try {
            await sendAdminPinChangeOtpEmail(req.user.email, otp);
        } catch (mailError) {
            await supabase.from("users").update({
                security_pin_change_otp_hash: null,
                security_pin_change_otp_expires_at: null,
                security_pin_change_otp_attempts: 0,
                security_pin_change_otp_verified_at: null
            }).eq("id", req.user.id);
            return res.status(502).json({ message: "OTP tidak dapat dikirim. PIN tidak diubah." });
        }
        await logSensitiveAction(req, "PIN_CHANGE_OTP_SENT");
        return res.json({ message: "Kode OTP telah dikirim ke email admin.", expires_in_seconds: PIN_CHANGE_OTP_TTL_MS / 1000 });
    } catch (err) {
        return res.status(500).json({ message: "Server gagal mengirim OTP perubahan PIN" });
    }
};

exports.verifyAdminPinChangeOtp = async (req, res) => {
    const otp = typeof req.body?.otp === "string" ? req.body.otp.trim() : "";
    if (!/^\d{6}$/.test(otp)) return res.status(400).json({ message: "Masukkan kode OTP 6 digit yang valid" });
    try {
        const { data: user, error } = await supabase.from("users")
            .select("security_pin_change_otp_hash, security_pin_change_otp_expires_at, security_pin_change_otp_attempts")
            .eq("id", req.user.id).maybeSingle();
        if (error) return res.status(500).json({ message: securityPinSchemaMessage(error) });
        if (!user?.security_pin_change_otp_hash || !user.security_pin_change_otp_expires_at || new Date(user.security_pin_change_otp_expires_at) <= new Date()) {
            return res.status(400).json({ message: "OTP tidak tersedia atau sudah kedaluwarsa. Kirim ulang OTP." });
        }
        const attempts = Number(user.security_pin_change_otp_attempts || 0);
        if (attempts >= PIN_CHANGE_OTP_MAX_ATTEMPTS) return res.status(429).json({ message: "Batas percobaan OTP tercapai. Kirim OTP baru." });
        if (hashPinChangeOtp(otp) !== user.security_pin_change_otp_hash) {
            await supabase.from("users").update({ security_pin_change_otp_attempts: attempts + 1 }).eq("id", req.user.id);
            await logSensitiveAction(req, "PIN_CHANGE_OTP_FAILED", { attempts: attempts + 1 });
            return res.status(401).json({ message: "Kode OTP tidak sesuai" });
        }
        const { error: updateError } = await supabase.from("users").update({ security_pin_change_otp_verified_at: new Date().toISOString() }).eq("id", req.user.id);
        if (updateError) return res.status(500).json({ message: securityPinSchemaMessage(updateError) });
        await logSensitiveAction(req, "PIN_CHANGE_OTP_VERIFIED");
        return res.json({ message: "OTP terverifikasi. Buat PIN baru sekarang." });
    } catch (err) {
        return res.status(500).json({ message: "Server gagal memverifikasi OTP perubahan PIN" });
    }
};

exports.changeAdminPin = async (req, res) => {
    const pin = req.body?.pin;
    const confirmation = req.body?.confirmation;
    if (!isValidSecurityPin(pin) || pin !== confirmation) return res.status(400).json({ message: "Security PIN baru harus 6 digit dan kedua input harus sama" });
    try {
        const { data: user, error } = await supabase.from("users")
            .select("security_pin_change_otp_expires_at, security_pin_change_otp_verified_at")
            .eq("id", req.user.id).maybeSingle();
        if (error) return res.status(500).json({ message: securityPinSchemaMessage(error) });
        if (!user?.security_pin_change_otp_verified_at || !user.security_pin_change_otp_expires_at || new Date(user.security_pin_change_otp_expires_at) <= new Date()) {
            return res.status(403).json({ message: "Verifikasi OTP wajib dilakukan sebelum mengubah PIN" });
        }
        const security_pin_hash = await bcrypt.hash(pin, 12);
        const { data: updatedUser, error: updateError } = await supabase.from("users").update({
            security_pin_hash,
            security_pin_updated_at: new Date().toISOString(),
            security_pin_change_otp_hash: null,
            security_pin_change_otp_expires_at: null,
            security_pin_change_otp_attempts: 0,
            security_pin_change_otp_verified_at: null
        }).eq("id", req.user.id)
            .eq("security_pin_change_otp_verified_at", user.security_pin_change_otp_verified_at)
            .select("id").maybeSingle();
        if (updateError) return res.status(500).json({ message: securityPinSchemaMessage(updateError) });
        if (!updatedUser) return res.status(409).json({ message: "OTP sudah dipakai atau tidak lagi valid. Ulangi proses perubahan PIN." });
        notify("security", `${req.user.email} mengubah Security PIN Admin setelah verifikasi OTP`);
        await logSensitiveAction(req, "PIN_CHANGED_WITH_OTP");
        return res.json({ message: "Security PIN berhasil diubah." });
    } catch (err) {
        return res.status(500).json({ message: "Server gagal mengubah Security PIN" });
    }
};

exports.getApiKeysAdmin = async (req, res) => {
    if (!["admin", "staff"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    try {
        const keys = await getApiKeys({ fresh: true });
        // Template & toggle notifikasi Fonnte disimpan di store_settings (bukan
        // api_keys), tapi UI-nya ada di card yang sama ("API Keys" tab) — jadi
        // digabung di sini biar admin gak perlu 2 kali verifikasi PIN cuma buat
        // load 1 form.
        const storeSettings = await getStoreSettings({ fresh: true });
        res.json({
            ipaymu_va: keys.ipaymu_va, // VA bukan rahasia, gak perlu di-mask
            ipaymu_api_key: mask(keys.ipaymu_api_key),
            ipaymu_is_production: keys.ipaymu_is_production,
            tokovoucher_member_code: keys.tokovoucher_member_code,
            tokovoucher_secret: mask(keys.tokovoucher_secret),
            apigames_merchant_id: keys.apigames_merchant_id,
            apigames_secret_key: mask(keys.apigames_secret_key),
            brevo_api_key: mask(keys.brevo_api_key),
            brevo_sender_email: keys.brevo_sender_email, // bukan rahasia, gak perlu di-mask
            brevo_sender_name: keys.brevo_sender_name,
            waapi_url: keys.waapi_url, // URL gateway bukan rahasia, gak perlu di-mask
            waapi_key: mask(keys.waapi_key),
            waapi_target_number: keys.waapi_target_number,
            gemini_api_key: mask(keys.gemini_api_key),
            gemini_news_model: keys.gemini_news_model,
            smtp_host: keys.smtp_host,
            smtp_port: keys.smtp_port,
            smtp_user: keys.smtp_user,
            smtp_password: mask(keys.smtp_password),
            smtp_from_email: keys.smtp_from_email,
            smtp_from_name: keys.smtp_from_name,
            fonnte_token: mask(keys.fonnte_token),
            fonnte_configured: !!keys.fonnte_token,
            fonnte_user_enabled: !!storeSettings.fonnte_user_enabled,
            wa_template_otp: storeSettings.wa_template_otp,
            wa_template_pending: storeSettings.wa_template_pending,
            wa_template_success: storeSettings.wa_template_success,
            seo_screenshot_base_url: storeSettings.seo_screenshot_base_url
                || process.env.SEO_SCREENSHOT_BASE_URL
                || process.env.FRONTEND_URL
                || "https://nexshop.cloud",
            chrome_executable_path: storeSettings.chrome_executable_path
                || process.env.CHROME_EXECUTABLE_PATH
                || ""
        });
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

exports.revealApiKeysAdmin = async (req, res) => {
    if (!["admin", "staff"].includes(req.user.role)) return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    try {
        const keys = await getApiKeys({ fresh: true });
        const key = typeof req.body.key === "string" ? req.body.key : "";
        const secretKeys = new Set([
            "ipaymu_api_key", "tokovoucher_secret", "apigames_secret_key", "brevo_api_key",
            "waapi_key", "gemini_api_key", "smtp_password", "fonnte_token"
        ]);
        if (!secretKeys.has(key)) return res.status(400).json({ message: "Secret yang diminta tidak valid" });
        await logSensitiveAction(req, req.body.purpose === "copy" ? "COPY_SECRET" : "REVEAL_SECRET", { key });
        return res.json({ key, value: keys[key] || "" });
    } catch (err) {
        return res.status(500).json({ message: "Gagal membuka konfigurasi API" });
    }
};

exports.updateApiKeysAdmin = async (req, res) => {
    if (!["admin", "staff"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    try {
        // kalau field dikirim kosong/masih berupa mask (mengandung "••••"),
        // jangan ditimpa — anggap admin gak berniat mengganti value itu
        let payload = { ...req.body };
        delete payload.security_pin;
        for (const key of Object.keys(payload)) {
            if (typeof payload[key] === "string" && payload[key].includes("••")) {
                delete payload[key];
            }
        }

        if (payload.waapi_url !== undefined && String(payload.waapi_url).trim()) {
            const target = `${String(payload.waapi_url).trim().replace(/\/$/, "")}/api/whatsapp/send-message`;
            const validation = validateWebhookUrlShape(target);
            if (!validation.ok) {
                return res.status(400).json({ message: `URL Gateway WA ditolak: ${validation.reason}` });
            }
            payload.waapi_url = String(payload.waapi_url).trim().replace(/\/$/, "");
        }

        // Template pesan & toggle notifikasi Fonnte disimpan di store_settings,
        // bukan api_keys — tapi form-nya digabung 1 card di frontend. Pisahkan
        // di sini supaya masing-masing ditulis ke tabel yang benar, tetap dalam
        // 1 request/1 verifikasi PIN yang sama.
        const storeSettingsFields = [
            "fonnte_user_enabled", "wa_template_otp", "wa_template_pending", "wa_template_success",
            "seo_screenshot_base_url", "chrome_executable_path"
        ];
        try {
            payload = normalizeSeoSettings(payload);
        } catch (validationError) {
            return res.status(400).json({ message: validationError.message });
        }
        const storePayload = {};
        for (const key of storeSettingsFields) {
            if (payload[key] !== undefined) {
                storePayload[key] = payload[key];
                delete payload[key];
            }
        }

        // Browser headless akan membuka origin ini dari jaringan server.
        // Validasi DNS di production mencegah dashboard dipakai untuk
        // mengakses localhost, metadata cloud, atau jaringan privat.
        if (process.env.NODE_ENV === "production" && storePayload.seo_screenshot_base_url) {
            const safeScreenshotOrigin = await assertSafeOutboundUrl(storePayload.seo_screenshot_base_url);
            if (!safeScreenshotOrigin.ok) {
                return res.status(400).json({ message: `SEO Screenshot Base URL ditolak: ${safeScreenshotOrigin.reason}` });
            }
            storePayload.seo_screenshot_base_url = new URL(safeScreenshotOrigin.url).origin;
        }

        const { data, error } = await updateApiKeys(payload);
        if (error) {
            console.log(error);
            return res.status(500).json({ message: "Gagal update API keys" });
        }

        if (Object.keys(storePayload).length > 0) {
            const { error: storeError } = await updateStoreSettings(storePayload);
            if (storeError) {
                console.log(storeError);
                if (/seo_screenshot_base_url|chrome_executable_path|schema cache/i.test(storeError.message || "")) {
                    return res.status(503).json({
                        code: "SEO_SETTINGS_NOT_SETUP",
                        message: "Kolom SEO Thumbnail belum tersedia. Jalankan migration 012_add_seo_thumbnail_settings.sql di Supabase SQL Editor."
                    });
                }
                return res.status(500).json({ message: "API keys tersimpan, tapi gagal update template/toggle notifikasi Fonnte" });
            }

            if (storePayload.seo_screenshot_base_url !== undefined || storePayload.chrome_executable_path !== undefined) {
                const { resetSeoThumbnailRuntime } = require("../services/seoThumbnailService");
                await resetSeoThumbnailRuntime();
            }
        }

        notify("settings", `🔑 ${req.user.email} mengubah konfigurasi API/SEO`);
        await logSensitiveAction(req, "UPDATE_SECRET", { fields: [...Object.keys(payload), ...Object.keys(storePayload)] });
        res.json({ message: "Konfigurasi berhasil disimpan" });
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

// ===========================================================
// RUNTIME AUTH CONFIG â€” Turnstile + Google OAuth (super admin)
// ===========================================================
function runtimeConfigSchemaMessage(error) {
    const code = String(error?.code || "");
    const message = String(error?.message || "");
    if (["42P01", "PGRST205"].includes(code) || /runtime_config|schema cache/i.test(message)) {
        return "Konfigurasi autentikasi belum tersedia. Jalankan migrations/014_create_runtime_auth_config.sql di Supabase SQL Editor.";
    }
    return "Gagal memproses konfigurasi autentikasi.";
}

exports.getRuntimeConfigAdmin = async (req, res) => {
    try {
        const config = await getRuntimeConfig({ fresh: true, strict: true });
        return res.json({ fields: getAdminRuntimeConfig(config) });
    } catch (err) {
        return res.status(500).json({ message: runtimeConfigSchemaMessage(err) });
    }
};

exports.revealRuntimeConfigSecretAdmin = async (req, res) => {
    const key = typeof req.body?.key === "string" ? req.body.key : "";
    if (!RUNTIME_CONFIG_FIELDS[key]?.secret) {
        return res.status(400).json({ message: "Secret konfigurasi yang diminta tidak valid." });
    }
    try {
        const config = await getRuntimeConfig({ fresh: true, strict: true });
        await logSensitiveAction(req, req.body?.purpose === "copy" ? "COPY_RUNTIME_SECRET" : "REVEAL_RUNTIME_SECRET", { key });
        return res.json({ key, value: config[key] || "" });
    } catch (err) {
        return res.status(500).json({ message: runtimeConfigSchemaMessage(err) });
    }
};

exports.updateRuntimeConfigAdmin = async (req, res) => {
    const values = req.body?.values;
    const clearKeys = req.body?.clear_keys;
    if (!values || typeof values !== "object" || Array.isArray(values)) {
        return res.status(400).json({ message: "Nilai konfigurasi autentikasi tidak valid." });
    }
    if (clearKeys !== undefined && (!Array.isArray(clearKeys) || clearKeys.some(key => typeof key !== "string"))) {
        return res.status(400).json({ message: "Daftar konfigurasi yang akan dihapus tidak valid." });
    }

    try {
        const sanitizedValues = {};
        for (const [key, value] of Object.entries(values)) {
            if (!RUNTIME_CONFIG_FIELDS[key]) continue;
            // Nilai masked dari halaman admin bukan secret asli dan tidak boleh
            // pernah ditulis kembali ke database.
            if (typeof value === "string" && value.includes("••")) continue;
            sanitizedValues[key] = value;
        }
        const result = await updateRuntimeConfig(sanitizedValues, clearKeys || []);
        if (result.error) {
            return res.status(503).json({ code: "RUNTIME_CONFIG_NOT_SETUP", message: runtimeConfigSchemaMessage(result.error) });
        }
        notify("settings", `🔐 ${req.user.email} mengubah konfigurasi autentikasi: ${result.changedKeys.join(", ") || "tanpa perubahan"}`);
        await logSensitiveAction(req, "UPDATE_RUNTIME_CONFIG", { fields: result.changedKeys });
        return res.json({ message: "Konfigurasi autentikasi berhasil disimpan.", fields: result.changedKeys });
    } catch (err) {
        return res.status(400).json({ message: err.message || "Konfigurasi autentikasi tidak valid." });
    }
};

// Admin only — kirim pesan test ke WA Gateway (waapi.fyas.my.id) langsung dari
// dashboard, buat mastiin URL/Key/Nomor tujuan bener sebelum dipakai beneran
// buat notifikasi order/topup. Beda sama sendWhatsAppNotification() di
// config/whatsapp.js: yang itu sengaja silent-fail (gak boleh ganggu proses
// order), yang ini justru harus melaporkan hasil sukses/gagal apa adanya
// biar gampang di-debug dari admin dashboard.
exports.testWhatsAppAdmin = async (req, res) => {
    if (!["admin", "staff"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }

    try {
        // pakai config tersimpan sbg default, tapi admin boleh override nomor
        // & pesan dari form test — gak perlu save dulu buat coba-coba
        const keys = await getApiKeys({ fresh: true });
        const waapi_url = (req.body.waapi_url || keys.waapi_url || "").trim();
        const waapi_key = (req.body.waapi_key || keys.waapi_key || "").trim();
        const number = (req.body.number || keys.waapi_target_number || "").trim();
        const message = (req.body.message || "").trim() || "Test notifikasi WhatsApp dari NexShop Admin Dashboard ✅";

        if (!waapi_url || !waapi_key) {
            return res.status(400).json({ message: "URL Gateway & API Key WA belum diisi. Isi dulu di form API Keys (atau simpan dulu) sebelum test." });
        }
        if (!number) {
            return res.status(400).json({ message: "Nomor tujuan belum diisi." });
        }

        const outboundTarget = `${waapi_url.replace(/\/$/, "")}/api/whatsapp/send-message`;
        const safeTarget = await assertSafeOutboundUrl(outboundTarget);
        if (!safeTarget.ok) {
            return res.status(400).json({ success: false, message: `URL Gateway WA ditolak: ${safeTarget.reason}` });
        }

        const started = Date.now();
        try {
            const waRes = await axios.post(
                safeTarget.url,
                { number, message },
                {
                    headers: {
                        "Content-Type": "application/json",
                        "X-API-Key": waapi_key
                    },
                    timeout: 15000
                }
            );

            return res.json({
                success: true,
                message: `Pesan test berhasil dikirim ke ${number} (${Date.now() - started}ms)`,
                gateway_status: waRes.status,
                gateway_response: waRes.data
            });
        } catch (waErr) {
            // gagal panggil gateway-nya (bukan gagal server kita) — tetap 200
            // biar frontend bisa nampilin detail errornya, bukan cuma "Server Error"
            return res.status(200).json({
                success: false,
                message: waErr.response
                    ? `Gateway WA menolak request (HTTP ${waErr.response.status})`
                    : (waErr.code === "ECONNABORTED"
                        ? "Timeout — gateway WA gak merespon dalam 15 detik."
                        : `Gagal menghubungi gateway WA: ${waErr.message}`),
                gateway_status: waErr.response?.status || null,
                gateway_response: waErr.response?.data || null
            });
        }
    } catch (err) {
        console.log("testWhatsAppAdmin error:", err);
        res.status(500).json({ message: "Server Error" });
    }
};

exports.testUserWhatsApp = async (req, res) => {
    if (!["admin", "staff"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }

    try {
        const { testFonnteConnection } = require("../services/userWhatsAppService");
        const number = (req.body.number || "").trim();
        const message = (req.body.message || "").trim() || "Test notifikasi WhatsApp dari Fonnte NexShop ✅";

        if (!number) return res.status(400).json({ message: "Nomor tujuan belum diisi." });

        const started = Date.now();
        try {
            const waRes = await testFonnteConnection(number, message);
            return res.json({
                success: true,
                message: `Pesan test berhasil dikirim via Fonnte (${Date.now() - started}ms)`,
                gateway_response: waRes
            });
        } catch (waErr) {
            return res.status(200).json({
                success: false,
                message: "Gagal memanggil Fonnte API: " + (waErr.response?.data?.reason || waErr.message),
                gateway_response: waErr.response?.data || null
            });
        }
    } catch (err) {
        console.log("testUserWhatsApp error:", err);
        res.status(500).json({ message: "Server Error" });
    }
};

exports.testApiGamesAdmin = async (req, res) => {
    if (!["admin", "staff"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }

    try {
        const keys = await getApiKeys({ fresh: true });
        if (!keys.apigames_merchant_id || !keys.apigames_secret_key) {
            return res.status(400).json({ message: "ApiGames belum dikonfigurasi. Harap simpan Merchant ID dan Secret Key terlebih dahulu." });
        }
        
        // Karena ApiGames tidak memiliki endpoint "ping" atau "profile" non-billable
        // standar yang aman tanpa parameter target akun (game code & user_id valid), 
        // kita hanya memverifikasi kelengkapan setup.
        return res.json({ 
            success: true, 
            message: "Konfigurasi ApiGames tersimpan. Verifikasi akun dapat diuji menggunakan User ID pelanggan yang valid." 
        });
    } catch (err) {
        console.log("testApiGamesAdmin error:", err);
        return res.status(500).json({ message: "Server Error" });
    }
};

// ===========================================================
// PROFIL ADMIN — lihat & ubah nama/email/password akun sendiri
// ===========================================================
exports.getMe = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("users")
            .select("id, fullname, email, role, created_at")
            .eq("id", req.user.id)
            .maybeSingle();

        if (error || !data) return res.status(404).json({ message: "User tidak ditemukan" });
        res.json(data);
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

exports.updateMe = async (req, res) => {
    const { fullname, email, current_password, new_password } = req.body;

    try {
        const { data: user, error: findErr } = await supabase
            .from("users")
            .select("*")
            .eq("id", req.user.id)
            .maybeSingle();

        if (findErr || !user) return res.status(404).json({ message: "User tidak ditemukan" });

        const payload = {};
        if (fullname !== undefined) {
            const cleanFullname = typeof fullname === "string" ? fullname.trim() : "";
            if (cleanFullname.length < 2 || cleanFullname.length > 100) {
                return res.status(400).json({ message: "Nama harus 2–100 karakter" });
            }
            payload.fullname = cleanFullname;
        }

        let cleanEmail = null;
        if (email !== undefined) {
            cleanEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) || cleanEmail.length > 254) {
                return res.status(400).json({ message: "Format email tidak valid" });
            }
        }
        if (cleanEmail && cleanEmail !== String(user.email || "").toLowerCase()) {
            // cek dulu email itu belum dipakai akun lain, biar errornya jelas
            // (bukan cuma "Gagal update profil" generik dari duplicate key constraint)
            const { data: existing } = await supabase
                .from("users")
                .select("id")
                .eq("email", cleanEmail)
                .neq("id", req.user.id)
                .maybeSingle();

            if (existing) {
                return res.status(400).json({ message: "Email sudah dipakai akun lain" });
            }
            payload.email = cleanEmail;
        }

        if (new_password) {
            if (!current_password) {
                return res.status(400).json({ message: "Masukkan password saat ini untuk mengganti password" });
            }
            const validPassword = await bcrypt.compare(current_password, user.password);
            if (!validPassword) {
                return res.status(401).json({ message: "Password saat ini salah" });
            }
            if (typeof new_password !== "string" || new_password.length < 8 || new_password.length > 128) {
                return res.status(400).json({ message: "Password baru harus 8–128 karakter" });
            }
            payload.password = await bcrypt.hash(new_password, 10);
        }

        if (Object.keys(payload).length === 0) {
            return res.status(400).json({ message: "Tidak ada perubahan yang dikirim" });
        }

        const { data, error } = await supabase
            .from("users")
            .update(payload)
            .eq("id", req.user.id)
            .select("id, fullname, email, role")
            .maybeSingle();

        if (error) {
            // tampilkan pesan error asli dari Supabase (bukan generik) supaya
            // gampang di-diagnosis — misal RLS policy, kolom gak ada, dst.
            console.log("updateMe error:", error);
            return res.status(500).json({ message: "Gagal update profil" });
        }

        if (!data) {
            // update "berhasil" (tanpa error) tapi gak ada baris yang match —
            // biasanya karena RLS policy nge-block row ini walau service key
            // dipakai, atau id di token gak cocok sama id di tabel users
            return res.status(500).json({
                message: "Gagal update profil: tidak ada baris yang ter-update. Cek apakah SUPABASE_SERVICE_KEY di .env server benar-benar Service Role Key (bukan anon key), dan apakah RLS di tabel users mengizinkan service role."
            });
        }

        res.json({ message: "Profil berhasil diperbarui", data });
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server Error" });
    }
};
