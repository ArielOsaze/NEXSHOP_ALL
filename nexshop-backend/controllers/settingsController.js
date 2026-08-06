const supabase = require("../config/db");
const bcrypt = require("bcrypt");
const axios = require("axios");
const { notify } = require("../config/notify");
const { isValidSecurityPin, verifyAdminPin, logSensitiveAction } = require("../middleware/adminPinMiddleware");
const {
    getStoreSettings,
    updateStoreSettings,
    getApiKeys,
    updateApiKeys
} = require("../config/settings");

// ===========================================================
// STORE SETTINGS — nama toko, tagline, kontak, logo
// ===========================================================

// Publik — dipakai frontend toko buat nampilin nama/logo/kontak
exports.getStoreSettingsPublic = async (req, res) => {
    try {
        const data = await getStoreSettings();
        // API publik sengaja hanya mengirim field storefront yang aman.
        const publicSettings = (({
            store_name, tagline, contact_whatsapp, contact_email, contact_phone, address,
            logo_url, faq, terms_content, refund_content, trust_bar_enabled,
            trust_bar_orders_offset, trust_bar_games_offset, event_mascot
        }) => ({ store_name, tagline, contact_whatsapp, contact_email, contact_phone, address,
            logo_url, faq, terms_content, refund_content, trust_bar_enabled,
            trust_bar_orders_offset, trust_bar_games_offset, event_mascot }))(data);
        res.json(publicSettings);
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

// Admin only
exports.updateStoreSettingsAdmin = async (req, res) => {
    if (req.user.role !== "admin") {
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

exports.getApiKeysAdmin = async (req, res) => {
    if (req.user.role !== "admin") {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    try {
        const keys = await getApiKeys({ fresh: true });
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
            smtp_from_name: keys.smtp_from_name
        });
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

exports.revealApiKeysAdmin = async (req, res) => {
    if (req.user.role !== "admin") return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    try {
        const keys = await getApiKeys({ fresh: true });
        const key = typeof req.body.key === "string" ? req.body.key : "";
        const secretKeys = new Set([
            "ipaymu_api_key", "tokovoucher_secret", "apigames_secret_key", "brevo_api_key",
            "waapi_key", "gemini_api_key", "smtp_password"
        ]);
        if (!secretKeys.has(key)) return res.status(400).json({ message: "Secret yang diminta tidak valid" });
        await logSensitiveAction(req, req.body.purpose === "copy" ? "COPY_SECRET" : "REVEAL_SECRET", { key });
        return res.json({ key, value: keys[key] || "" });
    } catch (err) {
        return res.status(500).json({ message: "Gagal membuka konfigurasi API" });
    }
};

exports.updateApiKeysAdmin = async (req, res) => {
    if (req.user.role !== "admin") {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    try {
        // kalau field dikirim kosong/masih berupa mask (mengandung "••••"),
        // jangan ditimpa — anggap admin gak berniat mengganti value itu
        const payload = { ...req.body };
        delete payload.security_pin;
        for (const key of Object.keys(payload)) {
            if (typeof payload[key] === "string" && payload[key].includes("••")) {
                delete payload[key];
            }
        }

        const { data, error } = await updateApiKeys(payload);
        if (error) {
            console.log(error);
            return res.status(500).json({ message: "Gagal update API keys" });
        }
        notify("settings", `🔑 ${req.user.email} mengubah API Keys`);
        await logSensitiveAction(req, "UPDATE_SECRET", { fields: Object.keys(payload) });
        res.json({ message: "API keys berhasil disimpan" });
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

// Admin only — kirim pesan test ke WA Gateway (waapi.fyas.my.id) langsung dari
// dashboard, buat mastiin URL/Key/Nomor tujuan bener sebelum dipakai beneran
// buat notifikasi order/topup. Beda sama sendWhatsAppNotification() di
// config/whatsapp.js: yang itu sengaja silent-fail (gak boleh ganggu proses
// order), yang ini justru harus melaporkan hasil sukses/gagal apa adanya
// biar gampang di-debug dari admin dashboard.
exports.testWhatsAppAdmin = async (req, res) => {
    if (req.user.role !== "admin") {
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

        const started = Date.now();
        try {
            const waRes = await axios.post(
                `${waapi_url.replace(/\/$/, "")}/api/whatsapp/send-message`,
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
        if (fullname) payload.fullname = fullname;

        if (email && email !== user.email) {
            // cek dulu email itu belum dipakai akun lain, biar errornya jelas
            // (bukan cuma "Gagal update profil" generik dari duplicate key constraint)
            const { data: existing } = await supabase
                .from("users")
                .select("id")
                .eq("email", email)
                .neq("id", req.user.id)
                .maybeSingle();

            if (existing) {
                return res.status(400).json({ message: "Email sudah dipakai akun lain" });
            }
            payload.email = email;
        }

        if (new_password) {
            if (!current_password) {
                return res.status(400).json({ message: "Masukkan password saat ini untuk mengganti password" });
            }
            const validPassword = await bcrypt.compare(current_password, user.password);
            if (!validPassword) {
                return res.status(401).json({ message: "Password saat ini salah" });
            }
            if (new_password.length < 4) {
                return res.status(400).json({ message: "Password baru minimal 4 karakter" });
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
            return res.status(500).json({ message: `Gagal update profil: ${error.message}` });
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
        res.status(500).json({ message: err.message || "Server Error" });
    }
};
