const crypto = require("crypto");
const net = require("net");
const axios = require("axios");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const supabase = require("../config/db");
const { notify } = require("../config/notify");
const { getTiers, getTier, getResellerContext, invalidateTierCache, isMissingTableError } = require("../services/resellerService");
const { hitungHargaReseller } = require("../utils/resellerPricing");
const { hitungMarkupWajar, cleanProductName } = require("../utils/topupHelpers");
const { validateWebhookUrlShape, assertSafeOutboundUrl } = require("../utils/safeOutboundUrl");
const { decryptDocument, parseDocumentRef, isDocumentRef } = require("../utils/secureDocument");
const { generateWebhookSignature } = require("../services/resellerWebhookService");
const { getTurnstileConfig, isTurnstileRequired, verifyTurnstile } = require("../services/turnstileService");
const {
    buildOtpAuthUri,
    decryptSecret,
    encryptSecret,
    generateRecoveryCodes,
    generateTotpSecret,
    normalizeRecoveryCode,
    verifyTotp
} = require("../services/resellerTwoFactorService");

// ===========================================================
// PROGRAM RESELLER & PARTNER PORTAL NEXSHOP
//
// Alurnya:
// 1. Pendaftar membuat akun Portal Reseller dengan email + password TERPISAH
//    dari akun storefront NexShop, lalu mengisi data KYC KTP & usaha.
// 2. Admin meninjau data usaha & foto KTP di Admin Dashboard -> Setujui / Tolak.
// 3. Setelah disetujui (status: 'approved'), identity portal mendapatkan:
//    - Potongan harga otomatis di etalase web saat memakai jalur reseller.
//    - Akses ke Partner Portal (/portal-reseller) untuk mengelola API Key,
//      Secret Key, IP Whitelist, Webhook Endpoint, dan daftar harga modal.
// JWT customer biasa tidak pernah diterima oleh endpoint portal.
// ===========================================================

const BELUM_SETUP = "Fitur kemitraan NexShop saat ini sedang tidak tersedia. Silakan coba lagi nanti.";

async function requireResellerHumanVerification(req, res) {
    const { secretKey } = await getTurnstileConfig();
    if (!secretKey && !(await isTurnstileRequired())) return true;
    if (!secretKey) {
        res.status(503).json({ message: "Verifikasi keamanan sedang belum dikonfigurasi. Coba lagi nanti.", code: "TURNSTILE_NOT_CONFIGURED" });
        return false;
    }
    const verification = await verifyTurnstile(req.body?.captcha_token, req.ip);
    if (verification.ok) return true;
    const unavailable = verification.reason === "verification_unavailable";
    res.status(unavailable ? 503 : 400).json({
        message: unavailable
            ? "Verifikasi keamanan sedang tidak tersedia. Coba lagi sebentar."
            : "Verifikasi keamanan tidak berhasil. Silakan ulangi tantangannya.",
        code: unavailable ? "TURNSTILE_UNAVAILABLE" : "TURNSTILE_FAILED"
    });
    return false;
}

function bersihkan(nilai, maksimal) {
    return String(nilai ?? "").trim().slice(0, maksimal);
}

function normalisasiWhatsApp(nomor) {
    const digit = String(nomor || "").replace(/\D/g, "");
    if (!/^(0|62)\d{8,14}$/.test(digit)) return null;
    return digit.startsWith("0") ? "62" + digit.slice(1) : digit;
}

function generateResellerApiKey() {
    return "nx_live_" + crypto.randomBytes(16).toString("hex");
}

function generateResellerSecretKey() {
    return "nx_sec_" + crypto.randomBytes(24).toString("hex");
}

function generateResellerWebhookSecret() {
    return "whsec_" + crypto.randomBytes(24).toString("hex");
}

// Netralkan CSV/Excel formula injection. Sel yang diawali = + - @ (atau
// tab/CR yang bikin Excel menggeser parsing) dieksekusi sebagai rumus saat
// file dibuka -- itu jalan masuk untuk perintah berbahaya lewat nama produk
// yang berasal dari katalog supplier. Prefiks tanda kutip tunggal memaksa
// Excel & LibreOffice memperlakukannya sebagai teks biasa.
function csvCell(value) {
    let teks = value === null || value === undefined ? "" : String(value);
    if (/^[=+\-@\t\r]/.test(teks)) {
        teks = "'" + teks;
    }
    return '"' + teks.replace(/"/g, '""') + '"';
}

function maskSecret(secret) {
    if (!secret || secret.length < 10) return "••••••••••••••••";
    return secret.slice(0, 7) + "••••••••••••••••" + secret.slice(-4);
}

// IP whitelist disimpan sebagai daftar dipisah koma. Sebelumnya nilai apa
// pun langsung ditelan mentah, jadi salah ketik ("192.168.1", "my-server")
// diam-diam bikin SELURUH request reseller ditolak 403 tanpa petunjuk
// letak salahnya. Sekarang tiap entri divalidasi dan dinormalisasi dulu.
function validasiIpWhitelist(raw) {
    const value = String(raw || "").trim();
    if (!value) return { ok: true, value: null };
    if (value.length > 1000) return { ok: false, reason: "Daftar IP whitelist terlalu panjang (maksimal 1000 karakter)." };

    const entries = value.split(",").map((x) => x.trim()).filter(Boolean);
    if (entries.length > 50) return { ok: false, reason: "Maksimal 50 alamat IP dalam whitelist." };

    const bersih = [];
    for (const entry of entries) {
        if (entry === "*") {
            // Opt-out eksplisit: pemilik akun sengaja mematikan pembatasan IP.
            bersih.push("*");
            continue;
        }
        if (net.isIP(entry) === 0) {
            return { ok: false, reason: `"${entry}" bukan alamat IP yang valid. Isi alamat IPv4/IPv6 publik server kamu, dipisah koma.` };
        }
        bersih.push(entry);
    }
    // Buang duplikat supaya daftarnya rapi & idempoten.
    return { ok: true, value: [...new Set(bersih)].join(",") };
}

function createPortalAccessToken(user, portalAccount, twoFactorVerified = false) {
    return jwt.sign(
        {
            id: user.id,
            portal_account_id: portalAccount.id,
            auth_context: "reseller_portal",
            email: portalAccount.email,
            fullname: user.fullname,
            role: user.role,
            is_reseller: true,
            reseller_status: user.reseller_status || portalAccount.status || "pending",
            two_factor_verified: Boolean(twoFactorVerified)
        },
        process.env.JWT_SECRET,
        { expiresIn: "14d" }
    );
}

async function loadPortalTwoFactor(portalAccountId) {
    const result = await supabase
        .from("reseller_portal_2fa")
        .select("id, portal_account_id, secret_ciphertext, recovery_codes_hashes, enabled, last_used_at, updated_at")
        .eq("portal_account_id", portalAccountId)
        .maybeSingle();
    if (result.error && !isMissingTableError(result.error)) throw result.error;
    return result.error ? null : result.data;
}

async function verifyPortalPassword(portalAccountId, password) {
    const { data, error } = await supabase
        .from("reseller_portal_accounts")
        .select("id, user_id, email, password_hash, status")
        .eq("id", portalAccountId)
        .maybeSingle();
    if (error) {
        if (isMissingTableError(error)) return { setupMissing: true };
        throw error;
    }
    if (!data || !password || !await bcrypt.compare(String(password), data.password_hash)) return null;
    return data;
}

async function consumeRecoveryCode(factor, code) {
    const normalized = normalizeRecoveryCode(code);
    if (!normalized) return false;
    const hashes = Array.isArray(factor.recovery_codes_hashes) ? factor.recovery_codes_hashes : [];
    for (let index = 0; index < hashes.length; index += 1) {
        if (!await bcrypt.compare(normalized, String(hashes[index]))) continue;
        const remaining = hashes.filter((_, itemIndex) => itemIndex !== index);
        const { data, error } = await supabase
            .from("reseller_portal_2fa")
            .update({ recovery_codes_hashes: remaining, last_used_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq("id", factor.id)
            .eq("updated_at", factor.updated_at)
            .select("id");
        if (error) throw error;
        return Array.isArray(data) && data.length > 0;
    }
    return false;
}

function issuePortalTwoFactorChallenge(user, portalAccount) {
    return jwt.sign(
        {
            kind: "portal_2fa_challenge",
            auth_context: "reseller_portal",
            id: user.id,
            portal_account_id: portalAccount.id,
            email: portalAccount.email,
            fullname: user.fullname,
            role: user.role,
            reseller_status: user.reseller_status || portalAccount.status || "pending"
        },
        process.env.JWT_SECRET,
        { expiresIn: "5m" }
    );
}

// ===========================================================
// AUTENTIKASI KHUSUS MITRA RESELLER (REGISTER & LOGIN)
// ===========================================================

exports.resellerRegister = async (req, res) => {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "").trim();
    const fullname = bersihkan(req.body.fullname, 120);
    const whatsapp = normalisasiWhatsApp(req.body.whatsapp || req.body.phone);
    const nik = bersihkan(req.body.nik, 20);
    const storeName = bersihkan(req.body.store_name, 120);
    const channel = bersihkan(req.body.channel, 80);
    const monthlyEstimate = bersihkan(req.body.monthly_estimate, 60);
    const note = bersihkan(req.body.note, 500);
    const ktpUrl = bersihkan(req.body.ktp_url, 500);

    if (!await requireResellerHumanVerification(req, res)) return;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ message: "Format email tidak valid" });
    }
    if (!password || password.length < 6) {
        return res.status(400).json({ message: "Password minimal 6 karakter" });
    }
    if (fullname.length < 3) {
        return res.status(400).json({ message: "Nama lengkap wajib diisi (minimal 3 karakter)" });
    }
    if (!whatsapp) {
        return res.status(400).json({ message: "Nomor WhatsApp tidak valid (contoh: 08xxxxxxxxxx atau 628xxxxxxxxxx)" });
    }
    if (!nik || nik.length < 16) {
        return res.status(400).json({ message: "Nomor NIK KTP wajib 16 digit" });
    }
    if (!ktpUrl) {
        return res.status(400).json({ message: "Foto KTP (KYC) wajib diunggah untuk verifikasi kemitraan reseller." });
    }

    try {
        // Schema dedicated wajib tersedia. Jangan pernah fallback ke login
        // customer lama karena itu menggabungkan dua boundary autentikasi.
        const { error: portalSchemaErr } = await supabase
            .from("reseller_portal_accounts")
            .select("id")
            .limit(1);
        if (portalSchemaErr) {
            if (isMissingTableError(portalSchemaErr)) {
                return res.status(503).json({ message: "Akun Portal Reseller belum siap. Admin perlu menerapkan migration 023 terlebih dahulu.", code: "RESELLER_PORTAL_NOT_SETUP" });
            }
            throw portalSchemaErr;
        }

        const { data: existingUser, error: findErr } = await supabase
            .from("users")
            .select("id, email")
            .eq("email", email)
            .maybeSingle();
        if (findErr) {
            if (isMissingTableError(findErr)) return res.status(503).json({ message: BELUM_SETUP, code: "RESELLER_NOT_SETUP" });
            throw findErr;
        }

        // Email akun Portal harus identity baru. Tidak boleh mengadopsi,
        // menimpa, atau memakai password akun belanja utama.
        if (existingUser) {
            return res.status(409).json({
                message: "Email tersebut sudah dipakai akun belanja NexShop. Untuk keamanan, buat akun Portal Reseller dengan email dan password yang berbeda.",
                code: "PORTAL_EMAIL_MUST_BE_SEPARATE"
            });
        }

        const internalPassword = await bcrypt.hash(crypto.randomBytes(32).toString("base64url"), 10);
        const { data: newUser, error: insertUserErr } = await supabase
            .from("users")
            .insert([{
                fullname,
                email,
                password: internalPassword,
                phone: whatsapp,
                role: "user",
                email_verified: true,
                reseller_status: "pending",
                account_scope: "portal_only"
            }])
            .select("id, email, fullname, role")
            .maybeSingle();

        if (insertUserErr) {
            console.error("resellerRegister insert portal identity error:", insertUserErr);
            if (insertUserErr.code === "23505") {
                return res.status(409).json({
                    message: "Email tersebut baru saja dipakai akun lain. Gunakan email Portal Reseller yang berbeda.",
                    code: "PORTAL_EMAIL_MUST_BE_SEPARATE"
                });
            }
            if (isMissingTableError(insertUserErr) || String(insertUserErr.message || "").toLowerCase().includes("account_scope")) {
                return res.status(503).json({ message: "Identity Portal Reseller belum siap. Admin perlu menerapkan migration 023 terlebih dahulu.", code: "RESELLER_PORTAL_NOT_SETUP" });
            }
            throw insertUserErr;
        }

        const portalPasswordHash = await bcrypt.hash(password, 10);
        const { data: portalAccount, error: portalAccountErr } = await supabase
            .from("reseller_portal_accounts")
            .insert([{
                user_id: newUser.id,
                email,
                password_hash: portalPasswordHash,
                status: "pending"
            }])
            .select("id")
            .maybeSingle();
        if (portalAccountErr || !portalAccount) {
            await supabase.from("users").delete().eq("id", newUser.id);
            if (portalAccountErr && isMissingTableError(portalAccountErr)) {
                return res.status(503).json({ message: "Akun Portal Reseller belum siap. Admin perlu menerapkan migration 023 terlebih dahulu.", code: "RESELLER_PORTAL_NOT_SETUP" });
            }
            if (portalAccountErr?.code === "23505") {
                return res.status(409).json({ message: "Email Portal Reseller sudah terdaftar. Gunakan email lain.", code: "PORTAL_EMAIL_ALREADY_REGISTERED" });
            }
            throw portalAccountErr || new Error("Portal account tidak terbentuk");
        }

        const userId = newUser.id;
        const portalAccountId = portalAccount.id;
        const rollbackPortalIdentity = async () => {
            await supabase.from("reseller_portal_accounts").delete().eq("id", portalAccountId);
            await supabase.from("users").delete().eq("id", userId);
        };

        // Sampai titik ini identity portal dan password portal sudah terbentuk.
        // Tidak ada jalur yang memakai kredensial akun storefront.

        // Simpan atau perbarui pengajuan ke reseller_applications
        const appPayload = {
            user_id: userId,
            fullname,
            whatsapp,
            store_name: storeName || null,
            channel: channel || null,
            monthly_estimate: monthlyEstimate || null,
            note: note || null,
            ktp_url: ktpUrl || null,
            nik: nik || null,
            status: "pending"
        };

        // Cek apakah user sudah punya pengajuan berstatus pending
        const { data: existingApp } = await supabase
            .from("reseller_applications")
            .select("id")
            .eq("user_id", userId)
            .eq("status", "pending")
            .maybeSingle();

        let appErr;
        if (existingApp) {
            const updateAppRes = await supabase
                .from("reseller_applications")
                .update(appPayload)
                .eq("id", existingApp.id);
            appErr = updateAppRes.error;
        } else {
            const insertAppRes = await supabase
                .from("reseller_applications")
                .insert([appPayload]);
            appErr = insertAppRes.error;

            // Race condition pada unique pending index: ambil baris pending
            // yang sudah dibuat request lain dan perbarui secara idempoten.
            if (appErr && (appErr.code === "23505" || String(appErr.message || "").includes("idx_reseller_app_one_pending"))) {
                const fallbackUpdate = await supabase
                    .from("reseller_applications")
                    .update(appPayload)
                    .eq("user_id", userId)
                    .eq("status", "pending");
                appErr = fallbackUpdate.error;
            }
        }

        if (appErr) {
            console.error("resellerRegister application insert/update error:", appErr);
            await rollbackPortalIdentity();
            if (isMissingTableError(appErr) || String(appErr.message || "").toLowerCase().includes("ktp_url") || String(appErr.message || "").toLowerCase().includes("nik") || appErr.code === "42703") {
                return res.status(503).json({ message: "Modul KYC belum siap di server. Admin perlu menerapkan migration 010 dan 023 terlebih dahulu.", code: "RESELLER_KYC_NOT_SETUP" });
            }
            return res.status(500).json({ message: "Gagal menyimpan pengajuan kemitraan." });
        }

        try {
            if (typeof notify === "function") {
                notify("reseller", `🤝 Pengajuan reseller baru (+KYC KTP) dari ${fullname} (${email}) — WhatsApp: ${whatsapp}`).catch(() => {});
            }
        } catch (_) {}

        return res.status(201).json({
            message: "Akun Portal Reseller berhasil dibuat! Silakan login menggunakan email dan password Portal setelah pendaftaran selesai. Pengajuan KYC Anda sedang diverifikasi admin (Maksimal 3x24 Jam kerja).",
            requires_login: true,
            status: "pending",
            user: {
                id: userId,
                fullname,
                email,
                phone: whatsapp,
                store_name: storeName,
                reseller_status: "pending"
            }
        });
    } catch (err) {
        console.error("resellerRegister error:", err);
        return res.status(500).json({ message: "Terjadi kesalahan server saat mendaftar reseller: " + (err.message || "") });
    }
};

exports.resellerLogin = async (req, res) => {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = typeof req.body.password === "string" ? req.body.password : "";

    if (!await requireResellerHumanVerification(req, res)) return;

    if (!email || !password) {
        return res.status(400).json({ message: "Email dan password Portal wajib diisi" });
    }

    try {
        // Login portal hanya membaca credential dari tabel dedicated. Tidak ada
        // fallback ke users.email/users.password milik akun belanja.
        const { data: portalAccount, error: portalErr } = await supabase
            .from("reseller_portal_accounts")
            .select("id, user_id, email, password_hash, status")
            .eq("email", email)
            .maybeSingle();

        if (portalErr) {
            if (isMissingTableError(portalErr)) {
                return res.status(503).json({ message: "Akun Portal Reseller belum siap. Admin perlu menerapkan migration 023 terlebih dahulu.", code: "RESELLER_PORTAL_NOT_SETUP" });
            }
            console.error("resellerLogin portal account error:", portalErr);
            return res.status(500).json({ message: "Database Error" });
        }

        if (!portalAccount || !await bcrypt.compare(password, portalAccount.password_hash)) {
            return res.status(401).json({ message: "Email atau password Portal Reseller salah." });
        }
        if (portalAccount.status === "suspended") {
            return res.status(403).json({ message: "Akun Portal Reseller sedang dibekukan. Hubungi admin NexShop.", code: "RESELLER_PORTAL_SUSPENDED" });
        }

        const { data: user, error: userErr } = await supabase
            .from("users")
            .select("id, email, fullname, role, phone, reseller_status, account_scope, is_blacklisted")
            .eq("id", portalAccount.user_id)
            .maybeSingle();
        if (userErr) {
            if (isMissingTableError(userErr)) return res.status(503).json({ message: BELUM_SETUP, code: "RESELLER_NOT_SETUP" });
            console.error("resellerLogin portal owner error:", userErr);
            return res.status(500).json({ message: "Database Error" });
        }
        if (!user || user.account_scope !== "portal_only") {
            return res.status(403).json({ message: "Identity Portal Reseller tidak valid. Hubungi admin NexShop.", code: "PORTAL_IDENTITY_INVALID" });
        }
        if (user.is_blacklisted) {
            return res.status(403).json({ message: "Akun Portal Reseller telah diblokir. Hubungi admin NexShop." });
        }

        const status = user.reseller_status || portalAccount.status || "pending";
        const twoFactor = await loadPortalTwoFactor(portalAccount.id);
        if (twoFactor?.enabled) {
            return res.json({
                message: "Masukkan kode authenticator untuk melanjutkan login.",
                code: "PORTAL_2FA_REQUIRED",
                two_factor_required: true,
                challenge_token: issuePortalTwoFactorChallenge(user, portalAccount),
                user: { email: portalAccount.email, fullname: user.fullname }
            });
        }

        await supabase
            .from("reseller_portal_accounts")
            .update({ last_login_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq("id", portalAccount.id);

        const token = createPortalAccessToken(user, portalAccount, false);

        return res.json({
            message: status === "approved"
                ? "Login Portal Reseller berhasil"
                : "Login Portal Reseller berhasil. Pengajuan KYC masih menunggu proses admin.",
            token,
            status,
            user: {
                id: user.id,
                portal_account_id: portalAccount.id,
                fullname: user.fullname,
                email: portalAccount.email,
                phone: user.phone,
                role: user.role,
                reseller_status: status
            }
        });
    } catch (err) {
        console.error("resellerLogin error:", err);
        return res.status(500).json({ message: "Terjadi kesalahan server saat login Portal Reseller" });
    }
};

exports.verifyResellerTwoFactor = async (req, res) => {
    const challengeToken = String(req.body.challenge_token || "");
    const code = String(req.body.code || "");
    if (!challengeToken || !code) return res.status(400).json({ message: "Challenge dan kode authenticator wajib diisi." });

    let challenge;
    try {
        challenge = jwt.verify(challengeToken, process.env.JWT_SECRET);
    } catch (_) {
        return res.status(401).json({ message: "Challenge 2FA sudah tidak berlaku. Silakan login ulang.", code: "PORTAL_2FA_CHALLENGE_INVALID" });
    }
    if (challenge.kind !== "portal_2fa_challenge" || challenge.auth_context !== "reseller_portal" || !challenge.portal_account_id || !challenge.id) {
        return res.status(401).json({ message: "Challenge 2FA tidak valid.", code: "PORTAL_2FA_CHALLENGE_INVALID" });
    }

    try {
        const factor = await loadPortalTwoFactor(challenge.portal_account_id);
        if (!factor?.enabled) return res.status(401).json({ message: "2FA akun ini belum aktif.", code: "PORTAL_2FA_NOT_ENABLED" });

        let verified = false;
        try {
            verified = verifyTotp(decryptSecret(factor.secret_ciphertext), code);
        } catch (_) {
            return res.status(503).json({ message: "Konfigurasi 2FA tidak dapat dibaca server.", code: "PORTAL_2FA_UNAVAILABLE" });
        }
        if (!verified) verified = await consumeRecoveryCode(factor, code);
        if (!verified) return res.status(401).json({ message: "Kode authenticator atau recovery code salah.", code: "PORTAL_2FA_INVALID" });

        const { data: portalAccount, error: portalErr } = await supabase
            .from("reseller_portal_accounts")
            .select("id, user_id, email, status")
            .eq("id", challenge.portal_account_id)
            .maybeSingle();
        if (portalErr) throw portalErr;
        const { data: user, error: userErr } = await supabase
            .from("users")
            .select("id, email, fullname, role, phone, reseller_status, account_scope, is_blacklisted")
            .eq("id", challenge.id)
            .maybeSingle();
        if (userErr) throw userErr;
        if (!portalAccount || !user || portalAccount.user_id !== user.id || user.account_scope !== "portal_only") {
            return res.status(403).json({ message: "Identity Portal Reseller tidak valid.", code: "PORTAL_IDENTITY_INVALID" });
        }
        if (portalAccount.status === "suspended" || user.is_blacklisted) {
            return res.status(403).json({ message: "Akun Portal Reseller sedang dibekukan.", code: "RESELLER_PORTAL_SUSPENDED" });
        }

        const now = new Date().toISOString();
        await supabase.from("reseller_portal_2fa").update({ last_used_at: now, updated_at: now }).eq("id", factor.id);
        await supabase.from("reseller_portal_accounts").update({ last_login_at: now, updated_at: now }).eq("id", portalAccount.id);
        const token = createPortalAccessToken(user, portalAccount, true);
        return res.json({
            message: "Login Portal Reseller berhasil",
            token,
            status: user.reseller_status || portalAccount.status || "pending",
            user: { id: user.id, portal_account_id: portalAccount.id, fullname: user.fullname, email: portalAccount.email, phone: user.phone, role: user.role, reseller_status: user.reseller_status || portalAccount.status || "pending" }
        });
    } catch (err) {
        if (isMissingTableError(err)) return res.status(503).json({ message: "Fitur 2FA belum siap di server.", code: "PORTAL_2FA_NOT_SETUP" });
        console.error("verifyResellerTwoFactor:", err.message);
        return res.status(500).json({ message: "Verifikasi 2FA gagal diproses." });
    }
};

exports.getResellerTwoFactorStatus = async (req, res) => {
    try {
        const factor = await loadPortalTwoFactor(req.user.portal_account_id);
        return res.json({ enabled: Boolean(factor?.enabled), configured: Boolean(factor) });
    } catch (err) {
        if (isMissingTableError(err)) return res.json({ enabled: false, configured: false });
        console.error("getResellerTwoFactorStatus:", err.message);
        return res.status(500).json({ message: "Status 2FA tidak dapat dibaca." });
    }
};

exports.setupResellerTwoFactor = async (req, res) => {
    const password = String(req.body.password || "");
    if (!password) return res.status(400).json({ message: "Password Portal Reseller wajib dikonfirmasi." });
    try {
        const account = await verifyPortalPassword(req.user.portal_account_id, password);
        if (account?.setupMissing) return res.status(503).json({ message: "Portal Reseller belum siap di server.", code: "RESELLER_PORTAL_NOT_SETUP" });
        if (!account) return res.status(401).json({ message: "Password Portal Reseller salah.", code: "PORTAL_REAUTH_REQUIRED" });
        if (account.status === "suspended") return res.status(403).json({ message: "Akun sedang dibekukan.", code: "RESELLER_PORTAL_SUSPENDED" });

        const existing = await loadPortalTwoFactor(account.id);
        if (existing?.enabled) return res.status(409).json({ message: "2FA sudah aktif di akun ini.", code: "PORTAL_2FA_ALREADY_ENABLED" });

        const secret = generateTotpSecret();
        const recoveryCodes = generateRecoveryCodes();
        const recoveryHashes = await Promise.all(recoveryCodes.map((code) => bcrypt.hash(normalizeRecoveryCode(code), 12)));
        const { error } = await supabase.from("reseller_portal_2fa").upsert([{
            portal_account_id: account.id,
            secret_ciphertext: encryptSecret(secret),
            recovery_codes_hashes: recoveryHashes,
            enabled: false,
            updated_at: new Date().toISOString()
        }], { onConflict: "portal_account_id" });
        if (error) throw error;
        return res.json({
            message: "Scan secret ini di aplikasi authenticator, lalu konfirmasi dengan kode 6 digit.",
            secret,
            otpauth_url: buildOtpAuthUri(secret, account.email),
            recovery_codes: recoveryCodes
        });
    } catch (err) {
        if (isMissingTableError(err)) return res.status(503).json({ message: "Migration 024 untuk 2FA belum diterapkan.", code: "PORTAL_2FA_NOT_SETUP" });
        console.error("setupResellerTwoFactor:", err.message);
        return res.status(500).json({ message: "Setup 2FA gagal diproses." });
    }
};

exports.enableResellerTwoFactor = async (req, res) => {
    const code = String(req.body.code || "");
    if (!code) return res.status(400).json({ message: "Kode authenticator wajib diisi untuk mengaktifkan 2FA." });
    try {
        const factor = await loadPortalTwoFactor(req.user.portal_account_id);
        if (!factor) return res.status(400).json({ message: "Mulai setup 2FA terlebih dahulu.", code: "PORTAL_2FA_SETUP_REQUIRED" });
        if (factor.enabled) return res.json({ enabled: true });
        if (!verifyTotp(decryptSecret(factor.secret_ciphertext), code)) return res.status(401).json({ message: "Kode authenticator salah. 2FA belum diaktifkan.", code: "PORTAL_2FA_INVALID" });
        const { error } = await supabase.from("reseller_portal_2fa").update({ enabled: true, updated_at: new Date().toISOString() }).eq("id", factor.id).eq("enabled", false);
        if (error) throw error;
        return res.json({ message: "2FA Portal Reseller berhasil diaktifkan.", enabled: true });
    } catch (err) {
        if (isMissingTableError(err)) return res.status(503).json({ message: "Migration 024 untuk 2FA belum diterapkan.", code: "PORTAL_2FA_NOT_SETUP" });
        console.error("enableResellerTwoFactor:", err.message);
        return res.status(500).json({ message: "2FA belum dapat diaktifkan." });
    }
};

exports.disableResellerTwoFactor = async (req, res) => {
    const password = String(req.body.password || "");
    const code = String(req.body.code || "");
    if (!password || !code) return res.status(400).json({ message: "Password portal dan kode authenticator wajib diisi." });
    try {
        const account = await verifyPortalPassword(req.user.portal_account_id, password);
        if (account?.setupMissing) return res.status(503).json({ message: "Portal Reseller belum siap di server.", code: "RESELLER_PORTAL_NOT_SETUP" });
        if (!account) return res.status(401).json({ message: "Password Portal Reseller salah.", code: "PORTAL_REAUTH_REQUIRED" });
        const factor = await loadPortalTwoFactor(account.id);
        if (!factor?.enabled) return res.json({ enabled: false });
        if (!verifyTotp(decryptSecret(factor.secret_ciphertext), code)) return res.status(401).json({ message: "Kode authenticator salah. 2FA tetap aktif.", code: "PORTAL_2FA_INVALID" });
        const { error } = await supabase.from("reseller_portal_2fa").update({ enabled: false, updated_at: new Date().toISOString() }).eq("id", factor.id);
        if (error) throw error;
        return res.json({ message: "2FA Portal Reseller berhasil dinonaktifkan.", enabled: false });
    } catch (err) {
        if (isMissingTableError(err)) return res.status(503).json({ message: "Migration 024 untuk 2FA belum diterapkan.", code: "PORTAL_2FA_NOT_SETUP" });
        console.error("disableResellerTwoFactor:", err.message);
        return res.status(500).json({ message: "2FA belum dapat dinonaktifkan." });
    }
};

// ===========================================================
// PUBLIK — daftar tier + persen diskonnya
// ===========================================================
exports.getPublicTiers = async (req, res) => {
    try {
        const tiers = await getTiers({ activeOnly: true });
        res.json(
            tiers.map((t) => ({
                code: t.code,
                name: t.name,
                discount_percent: t.discount_percent,
                description: t.description || null,
                eligibility: t.eligibility || null
            }))
        );
    } catch (err) {
        console.error("getPublicTiers:", err.message);
        res.status(500).json({ message: "Gagal memuat tingkatan reseller" });
    }
};

// ===========================================================
// USER — status reseller & pengajuan miliknya sendiri
// ===========================================================
exports.getMyResellerStatus = async (req, res) => {
    try {
        const { data: user, error } = await supabase
            .from("users")
            .select("reseller_status, reseller_tier, reseller_since, fullname, phone")
            .eq("id", req.user.id)
            .maybeSingle();

        if (error) {
            if (isMissingTableError(error)) return res.status(503).json({ message: BELUM_SETUP, code: "RESELLER_NOT_SETUP" });
            throw error;
        }

        const { data: pengajuan } = await supabase
            .from("reseller_applications")
            .select("id, status, tier_code, admin_note, created_at, reviewed_at, ktp_url, nik")
            .eq("user_id", req.user.id)
            .order("created_at", { ascending: false })
            .limit(1);

        const status = user?.reseller_status || "none";
        const tier = status === "approved" ? await getTier(user.reseller_tier) : null;

        res.json({
            status,
            tier: tier ? { code: tier.code, name: tier.name, discount_percent: tier.discount_percent } : null,
            since: user?.reseller_since || null,
            profil: { fullname: user?.fullname || "", phone: user?.phone || "" },
            pengajuan_terakhir: (pengajuan && pengajuan[0]) || null
        });
    } catch (err) {
        console.error("getMyResellerStatus:", err.message);
        res.status(500).json({ message: "Gagal memuat status reseller" });
    }
};

exports.applyReseller = async (req, res) => {
    const fullname = bersihkan(req.body.fullname, 120);
    const whatsapp = normalisasiWhatsApp(req.body.whatsapp);
    const storeName = bersihkan(req.body.store_name, 120);
    const channel = bersihkan(req.body.channel, 80);
    const monthlyEstimate = bersihkan(req.body.monthly_estimate, 60);
    const note = bersihkan(req.body.note, 500);
    const ktpUrl = bersihkan(req.body.ktp_url, 500);
    const nik = bersihkan(req.body.nik, 20);

    if (fullname.length < 3) return res.status(400).json({ message: "Nama lengkap wajib diisi (minimal 3 karakter)" });
    if (!whatsapp) return res.status(400).json({ message: "Nomor WhatsApp tidak valid (contoh: 08xxxxxxxxxx)" });
    if (!ktpUrl) return res.status(400).json({ message: "Foto KTP (KYC) wajib diunggah untuk verifikasi kemitraan reseller." });

    try {
        const { data: user, error: userErr } = await supabase
            .from("users")
            .select("reseller_status, email_verified")
            .eq("id", req.user.id)
            .maybeSingle();

        if (userErr) {
            if (isMissingTableError(userErr)) return res.status(503).json({ message: BELUM_SETUP, code: "RESELLER_NOT_SETUP" });
            throw userErr;
        }
        if (user.reseller_status === "approved") {
            return res.status(400).json({ message: "Akun kamu sudah terdaftar sebagai reseller aktif." });
        }
        if (user.reseller_status === "pending") {
            return res.status(400).json({ message: "Pengajuan kamu sedang ditinjau. Tunggu kabar dari admin ya." });
        }
        if (user.reseller_status === "suspended") {
            return res.status(403).json({ message: "Status reseller kamu sedang dibekukan. Hubungi Customer Service." });
        }

        const insertRow = {
            user_id: req.user.id,
            fullname,
            whatsapp,
            store_name: storeName || null,
            channel: channel || null,
            monthly_estimate: monthlyEstimate || null,
            note: note || null,
            ktp_url: ktpUrl || null,
            nik: nik || null,
            status: "pending"
        };

        const { data: inserted, error: insertErr } = await supabase
            .from("reseller_applications")
            .insert([insertRow])
            .select("id, created_at");

        if (insertErr) {
            if (isMissingTableError(insertErr)) return res.status(503).json({ message: BELUM_SETUP, code: "RESELLER_NOT_SETUP" });
            if (String(insertErr.code) === "23505") {
                return res.status(400).json({ message: "Pengajuan kamu sedang ditinjau. Tunggu kabar dari admin ya." });
            }
            throw insertErr;
        }

        await supabase.from("users").update({ reseller_status: "pending" }).eq("id", req.user.id);

        notify("reseller", `🤝 Pengajuan reseller baru (+KYC KTP) dari ${fullname} (${req.user.email}) — WhatsApp ${whatsapp}`);

        res.status(201).json({
            message: "Pengajuan & berkas KYC KTP berhasil terkirim! Admin akan meninjau maksimal 3x24 jam kerja.",
            pengajuan: (inserted && inserted[0]) || null
        });
    } catch (err) {
        console.error("applyReseller:", err.message);
        res.status(500).json({ message: "Gagal mengirim pengajuan reseller" });
    }
};

// ===========================================================
// ADMIN — daftar pengajuan (dengan data KYC KTP)
// ===========================================================
exports.listApplications = async (req, res) => {
    const status = String(req.query.status || "").trim();
    try {
        let query = supabase
            .from("reseller_applications")
            .select("id, user_id, fullname, whatsapp, store_name, channel, monthly_estimate, note, status, tier_code, admin_note, reviewed_by, reviewed_at, created_at, ktp_url, nik")
            .order("created_at", { ascending: false })
            .limit(300);

        if (["pending", "approved", "rejected"].includes(status)) query = query.eq("status", status);

        const { data, error } = await query;
        if (error) {
            if (isMissingTableError(error)) return res.status(503).json({ message: BELUM_SETUP, code: "RESELLER_NOT_SETUP" });
            throw error;
        }

        const userIds = [...new Set((data || []).map((a) => a.user_id))];
        const emailById = new Map();
        if (userIds.length) {
            const { data: users } = await supabase.from("users").select("id, email, reseller_status, reseller_tier").in("id", userIds);
            (users || []).forEach((u) => emailById.set(String(u.id), u));
        }

        res.json(
            (data || []).map((a) => {
                const u = emailById.get(String(a.user_id));
                return { ...a, email: u?.email || null, current_status: u?.reseller_status || null, current_tier: u?.reseller_tier || null };
            })
        );
    } catch (err) {
        console.error("listApplications:", err.message);
        res.status(500).json({ message: "Gagal memuat pengajuan reseller" });
    }
};

// ===========================================================
// ADMIN — approve / tolak pengajuan KYC
// ===========================================================
exports.decideApplication = async (req, res) => {
    const { id } = req.params;
    const action = String(req.body.action || "").trim();
    const tierCode = String(req.body.tier_code || "").trim();
    const adminNote = bersihkan(req.body.admin_note, 300);

    if (!["approve", "reject"].includes(action)) {
        return res.status(400).json({ message: "Aksi harus 'approve' atau 'reject'" });
    }

    try {
        const { data: app, error } = await supabase
            .from("reseller_applications")
            .select("id, user_id, fullname, whatsapp, status")
            .eq("id", id)
            .maybeSingle();

        if (error) {
            if (isMissingTableError(error)) return res.status(503).json({ message: BELUM_SETUP, code: "RESELLER_NOT_SETUP" });
            throw error;
        }
        if (!app) return res.status(404).json({ message: "Pengajuan tidak ditemukan" });
        if (app.status !== "pending") {
            return res.status(400).json({ message: `Pengajuan ini sudah ${app.status === "approved" ? "disetujui" : "ditolak"} sebelumnya` });
        }

        let tier = null;
        if (action === "approve") {
            tier = await getTier(tierCode);
            if (!tier) return res.status(400).json({ message: "Pilih tingkatan reseller yang valid" });
            if (!tier.is_active) return res.status(400).json({ message: `Tingkatan "${tier.name}" sedang nonaktif` });
        }

        const now = new Date().toISOString();
        const { error: updErr } = await supabase
            .from("reseller_applications")
            .update({
                status: action === "approve" ? "approved" : "rejected",
                tier_code: tier ? tier.code : null,
                admin_note: adminNote || null,
                reviewed_by: req.user.email,
                reviewed_at: now
            })
            .eq("id", id)
            .eq("status", "pending");
        if (updErr) throw updErr;

        const userPayload = action === "approve"
            ? { reseller_status: "approved", reseller_tier: tier.code, reseller_since: now }
            : { reseller_status: "rejected", reseller_tier: null };

        const { error: userErr } = await supabase.from("users").update(userPayload).eq("id", app.user_id);
        if (userErr) throw userErr;

        // Status akses portal disinkronkan dengan status reseller internal.
        // Password/identity portal tetap terpisah; yang berubah hanya status
        // approval yang dikelola admin.
        const { error: portalStatusErr } = await supabase
            .from("reseller_portal_accounts")
            .update({ status: action === "approve" ? "approved" : "rejected", updated_at: now })
            .eq("user_id", app.user_id);
        if (portalStatusErr && !isMissingTableError(portalStatusErr)) throw portalStatusErr;

        // Jika disetujui, pastikan pasangan API Key & Secret Key dibuat otomatis
        if (action === "approve") {
            try {
                const { data: existingKey } = await supabase
                    .from("reseller_api_keys")
                    .select("id")
                    .eq("user_id", app.user_id)
                    .maybeSingle();

                if (!existingKey) {
                    await supabase.from("reseller_api_keys").insert([{
                        user_id: app.user_id,
                        api_key: generateResellerApiKey(),
                        secret_key: generateResellerSecretKey(),
                        webhook_secret: generateResellerWebhookSecret(),
                        is_active: true
                    }]);
                }
            } catch (kErr) {
                console.log("[reseller] notice: skip provisioning api key:", kErr.message);
            }
        }

        notify(
            "reseller",
            action === "approve"
                ? `✅ ${req.user.email} menyetujui reseller ${app.fullname} (tier ${tier.name}, diskon ${tier.discount_percent}%)`
                : `❌ ${req.user.email} menolak pengajuan reseller ${app.fullname}`
        );

        res.json({
            message: action === "approve"
                ? `${app.fullname} sekarang reseller resmi ${tier.name} (diskon ${tier.discount_percent}%)`
                : `Pengajuan ${app.fullname} ditolak`
        });
    } catch (err) {
        console.error("decideApplication:", err.message);
        res.status(500).json({ message: "Gagal memproses pengajuan reseller" });
    }
};

// ===========================================================
// ADMIN — daftar reseller aktif + ubah tier / bekukan
// ===========================================================
exports.listResellers = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("users")
            .select("id, fullname, email, phone, reseller_status, reseller_tier, reseller_since")
            .in("reseller_status", ["approved", "suspended"])
            .order("reseller_since", { ascending: false })
            .limit(500);

        if (error) {
            if (isMissingTableError(error)) return res.status(503).json({ message: BELUM_SETUP, code: "RESELLER_NOT_SETUP" });
            throw error;
        }

        // Ambil info API Keys untuk daftar reseller
        const userIds = (data || []).map((u) => u.id);
        const apiKeyMap = new Map();
        if (userIds.length) {
            try {
                const { data: keys } = await supabase
                    .from("reseller_api_keys")
                    .select("user_id, api_key, ip_whitelist, is_active, total_requests, last_used_at")
                    .in("user_id", userIds);
                (keys || []).forEach((k) => apiKeyMap.set(String(k.user_id), k));
            } catch {
                /* table mungkin belum ada */
            }
        }

        res.json((data || []).map((u) => ({
            ...u,
            api_info: apiKeyMap.get(String(u.id)) || null
        })));
    } catch (err) {
        console.error("listResellers:", err.message);
        res.status(500).json({ message: "Gagal memuat daftar reseller" });
    }
};

exports.updateResellerUser = async (req, res) => {
    const { id } = req.params;
    const status = String(req.body.status || "").trim();
    const tierCode = String(req.body.tier_code || "").trim();

    if (status && !["approved", "suspended", "none"].includes(status)) {
        return res.status(400).json({ message: "Status reseller tidak valid" });
    }

    try {
        const payload = {};
        if (status === "none") {
            payload.reseller_status = "none";
            payload.reseller_tier = null;
            payload.reseller_since = null;
        } else if (status) {
            payload.reseller_status = status;
        }

        if (tierCode) {
            const tier = await getTier(tierCode);
            if (!tier) return res.status(400).json({ message: "Tingkatan reseller tidak dikenal" });
            payload.reseller_tier = tier.code;
        }

        if (Object.keys(payload).length === 0) {
            return res.status(400).json({ message: "Tidak ada perubahan yang dikirim" });
        }

        const { data, error } = await supabase.from("users").update(payload).eq("id", id).select("id, fullname, reseller_status, reseller_tier");
        if (error) {
            if (isMissingTableError(error)) return res.status(503).json({ message: BELUM_SETUP, code: "RESELLER_NOT_SETUP" });
            throw error;
        }
        if (!data || !data.length) return res.status(404).json({ message: "User tidak ditemukan" });

        const portalStatus = status === "suspended" ? "suspended" : status === "approved" ? "approved" : status === "none" ? "rejected" : null;
        if (portalStatus) {
            const { error: portalStatusErr } = await supabase
                .from("reseller_portal_accounts")
                .update({ status: portalStatus, updated_at: new Date().toISOString() })
                .eq("user_id", id);
            if (portalStatusErr && !isMissingTableError(portalStatusErr)) throw portalStatusErr;
        }

        notify("reseller", `🔧 ${req.user.email} mengubah reseller ${data[0].fullname}: status ${data[0].reseller_status}, tier ${data[0].reseller_tier || "-"}`);
        res.json({ message: "Data reseller diperbarui", data: data[0] });
    } catch (err) {
        console.error("updateResellerUser:", err.message);
        res.status(500).json({ message: "Gagal memperbarui data reseller" });
    }
};

// ===========================================================
// ADMIN — atur tingkatan & persen diskon
// ===========================================================
exports.listTiersAdmin = async (req, res) => {
    try {
        const tiers = await getTiers({ activeOnly: false });
        if (!tiers.length) return res.status(503).json({ message: BELUM_SETUP, code: "RESELLER_NOT_SETUP" });

        const { data: users } = await supabase
            .from("users")
            .select("reseller_tier")
            .eq("reseller_status", "approved");
        const jumlah = {};
        (users || []).forEach((u) => {
            if (u.reseller_tier) jumlah[u.reseller_tier] = (jumlah[u.reseller_tier] || 0) + 1;
        });

        res.json(tiers.map((t) => ({ ...t, jumlah_reseller: jumlah[t.code] || 0 })));
    } catch (err) {
        console.error("listTiersAdmin:", err.message);
        res.status(500).json({ message: "Gagal memuat tingkatan reseller" });
    }
};

exports.updateTier = async (req, res) => {
    const { code } = req.params;
    const payload = {};

    if (req.body.discount_percent !== undefined) {
        const persen = Number(req.body.discount_percent);
        if (!Number.isFinite(persen) || persen < 0 || persen > 30) {
            return res.status(400).json({ message: "Diskon harus angka 0-30 persen" });
        }
        payload.discount_percent = Number(persen.toFixed(2));
    }
    if (req.body.name !== undefined) payload.name = bersihkan(req.body.name, 60) || null;
    if (req.body.description !== undefined) payload.description = bersihkan(req.body.description, 200) || null;
    if (req.body.is_active !== undefined) payload.is_active = !!req.body.is_active;

    if (Object.keys(payload).length === 0) {
        return res.status(400).json({ message: "Tidak ada perubahan yang dikirim" });
    }
    payload.updated_at = new Date().toISOString();

    try {
        const { data, error } = await supabase.from("reseller_tiers").update(payload).eq("code", code).select();
        if (error) {
            if (isMissingTableError(error)) return res.status(503).json({ message: BELUM_SETUP, code: "RESELLER_NOT_SETUP" });
            throw error;
        }
        if (!data || !data.length) return res.status(404).json({ message: "Tingkatan tidak ditemukan" });

        invalidateTierCache();

        notify("reseller", `💸 ${req.user.email} mengubah tier ${data[0].name}: diskon ${data[0].discount_percent}%`);
        res.json({ message: `Tingkatan ${data[0].name} diperbarui`, data: data[0] });
    } catch (err) {
        console.error("updateTier:", err.message);
        res.status(500).json({ message: "Gagal memperbarui tingkatan reseller" });
    }
};

// ===========================================================
// PARTNER PORTAL — Endpoints Khusus Reseller Aktif
// ===========================================================

function getResellerMemberCode(user) {
    if (!user || !user.id) return "NX-MITRA-000";
    const yearCode = "26";
    const idHex = Number(user.id).toString(16).toUpperCase().padStart(4, "0");
    const checksum = (Number(user.id) * 31 % 89 + 10).toString();
    return `M${yearCode}${idHex}QCNW${checksum}PT`;
}

// CATATAN: dulu di sini ada array RESELLER_PORTAL_NEWS berisi tiga
// "pengumuman" yang ditulis manual lengkap dengan tanggal karangan
// ("17 Juni 2026", "10 April 2026", "22 Jan 2026"). Isinya tampil di
// portal seolah-olah pengumuman resmi, padahal tidak pernah ada di
// database dan tanggalnya tidak pernah berubah. Sekarang feed berita
// portal HANYA mengambil artikel yang benar-benar terbit di
// news_articles; kalau kosong, portal menampilkan empty state jujur.

async function getResellerDashboardMetrics(userId) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterdayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();

    let todayCount = 0, todayAmount = 0;
    let yesterdayCount = 0, yesterdayAmount = 0;
    let thisMonthCount = 0, thisMonthAmount = 0;
    let lastMonthCount = 0, lastMonthAmount = 0;

    // Inisialisasi array 7 hari terakhir
    const dailyChart = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        const dayLabel = d.toLocaleDateString("id-ID", { day: "numeric", month: "short" });
        dailyChart.push({
            date: dayLabel,
            full_date: d.toISOString().slice(0, 10),
            day_timestamp: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(),
            next_day_timestamp: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime(),
            count: 0,
            amount: 0
        });
    }

    try {
        // PERBAIKAN:
        // 1. Dulu query ini menarik SELURUH riwayat pesanan user tanpa batas
        //    waktu maupun limit, padahal angka yang dipakai cuma sampai bulan
        //    lalu. Sekarang dibatasi sejak awal bulan lalu saja.
        // 2. Dulu SEMUA pesanan ikut dihitung sebagai omzet -- termasuk yang
        //    gagal dan yang masih pending. Reseller jadi melihat "omzet" yang
        //    lebih besar daripada uang yang benar-benar terpakai. Sekarang
        //    hanya pesanan berstatus sukses yang masuk hitungan nominal.
        // 3. `total` bisa NULL untuk order jalur API (kolom yang terisi di
        //    sana `harga`), jadi keduanya dipakai sebagai sumber nominal.
        const sejak = new Date(lastMonthStart).toISOString();
        const { data: orders } = await supabase
            .from("topup_orders")
            .select("id, harga, created_at, status")
            .eq("user_id", userId)
            .gte("created_at", sejak)
            .order("created_at", { ascending: false })
            .limit(5000);

        const STATUS_SUKSES = new Set(["sukses", "success"]);

        if (orders && orders.length > 0) {
            orders.forEach(o => {
                // Pesanan gagal/pending tetap dihitung jumlahnya (count) supaya
                // reseller tahu volume percobaannya, tapi nominalnya nol supaya
                // angka rupiah di dashboard = uang yang benar-benar berputar.
                const sukses = STATUS_SUKSES.has(String(o.status || "").toLowerCase());
                const nominal = Number(o.harga) || 0;
                const total = sukses ? nominal : 0;
                const ot = new Date(o.created_at).getTime();

                if (ot >= todayStart) {
                    todayCount++;
                    todayAmount += total;
                } else if (ot >= yesterdayStart && ot < todayStart) {
                    yesterdayCount++;
                    yesterdayAmount += total;
                }

                if (ot >= thisMonthStart) {
                    thisMonthCount++;
                    thisMonthAmount += total;
                } else if (ot >= lastMonthStart && ot < thisMonthStart) {
                    lastMonthCount++;
                    lastMonthAmount += total;
                }

                // Masukkan ke daily chart
                dailyChart.forEach(day => {
                    if (ot >= day.day_timestamp && ot < day.next_day_timestamp) {
                        day.count++;
                        day.amount += total;
                    }
                });
            });
        }
    } catch (_) {}

    return {
        today: { count: todayCount, amount: todayAmount },
        yesterday: { count: yesterdayCount, amount: yesterdayAmount },
        this_month: { count: thisMonthCount, amount: thisMonthAmount },
        last_month: { count: lastMonthCount, amount: lastMonthAmount },
        daily_chart: dailyChart.map(d => ({
            date: d.date,
            full_date: d.full_date,
            count: d.count,
            amount: d.amount
        }))
    };
}

async function getResellerPortalNews() {
    try {
        const { data: articles } = await supabase
            .from("news_articles")
            .select("id, title, published_at, category, excerpt, slug")
            .eq("is_published", true)
            .order("published_at", { ascending: false })
            .limit(5);

        if (articles && articles.length > 0) {
            return articles.map(a => ({
                id: a.id,
                title: a.title,
                date: a.published_at ? new Date(a.published_at).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }) : "Baru",
                time_ago: getTimeAgoIndo(a.published_at),
                badge: a.category || "Berita",
                slug: a.slug
            }));
        }
    } catch (err) {
        console.error("getResellerPortalNews:", err.message);
    }

    // Tidak ada artikel terbit -> kembalikan kosong. Jangan pernah
    // mengarang pengumuman supaya panel "News & Updates" kelihatan isi.
    return [];
}

function getTimeAgoIndo(dateStr) {
    if (!dateStr) return "baru saja";
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 60) return `${diffMin} menit yang lalu`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours} jam yang lalu`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return `${diffDays} hari yang lalu`;
    const diffMonths = Math.floor(diffDays / 30);
    return `${diffMonths} bulan yang lalu`;
}

/**
 * Overview Kredensial, Status Tier & IP Whitelist Reseller
 */
exports.getPortalOverview = async (req, res) => {
    try {
        const { data: user, error: uErr } = await supabase
            .from("users")
            .select("id, email, fullname, phone, reseller_status, reseller_tier, reseller_since")
            .eq("id", req.user.id)
            .maybeSingle();

        if (uErr) {
            if (isMissingTableError(uErr)) {
                return res.status(503).json({ message: BELUM_SETUP, code: "RESELLER_NOT_SETUP" });
            }
            throw uErr;
        }
        if (!user) {
            return res.status(404).json({ message: "User tidak ditemukan" });
        }

        let status = user.reseller_status || "none";
        const { data: latestApp, error: latestAppErr } = await supabase
            .from("reseller_applications")
            .select("status, tier_code, reviewed_at")
            .eq("user_id", user.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
        if (latestAppErr) {
            if (isMissingTableError(latestAppErr)) {
                return res.status(503).json({ message: BELUM_SETUP, code: "RESELLER_NOT_SETUP" });
            }
            throw latestAppErr;
        }

        if (status === "none" && latestApp && latestApp.status) status = latestApp.status;

        // Rekonsiliasi data approval lama. Beberapa pengajuan sudah berstatus
        // approved, tetapi users.reseller_status masih pending akibat deploy
        // versi admin terdahulu. Jangan menimpa suspended/rejected secara diam-diam.
        if (["none", "pending"].includes(status) && latestApp?.status === "approved") {
            const repairedTier = latestApp.tier_code || user.reseller_tier || null;
            const repairedSince = latestApp.reviewed_at || user.reseller_since || new Date().toISOString();
            let repairQuery = supabase
                .from("users")
                .update({
                    reseller_status: "approved",
                    reseller_tier: repairedTier,
                    reseller_since: repairedSince
                })
                .eq("id", user.id);
            repairQuery = user.reseller_status == null
                ? repairQuery.is("reseller_status", null)
                : repairQuery.eq("reseller_status", user.reseller_status);
            const { error: repairErr } = await repairQuery;
            if (!repairErr) {
                status = "approved";
                user.reseller_status = "approved";
                user.reseller_tier = repairedTier;
                user.reseller_since = repairedSince;
            }
        }

        // User ini belum pernah mendaftar jadi reseller sama sekali (gak ada
        // di users.reseller_status maupun di reseller_applications). Bedain
        // dari "pending" -- jangan kasih akses portal, minta daftar dulu.
        if (status === "none") {
            return res.status(403).json({
                message: "Kamu belum terdaftar sebagai reseller NexShop. Silakan daftar terlebih dahulu.",
                code: "RESELLER_NOT_REGISTERED",
                reseller_status: "none"
            });
        }

        const { data: wallet, error: walletErr } = await supabase
            .from("wallets")
            .select("balance")
            .eq("user_id", user.id)
            .maybeSingle();
        if (walletErr) {
            if (isMissingTableError(walletErr)) {
                return res.status(503).json({ message: "Wallet Portal Reseller belum siap di server.", code: "WALLET_NOT_SETUP" });
            }
            throw walletErr;
        }

        const memberCode = getResellerMemberCode(user);
        const metrics = await getResellerDashboardMetrics(user.id);
        const balance = Number(wallet?.balance) || 0;
        const portalNews = await getResellerPortalNews();

        // Jika akun sudah pernah mendaftar tapi belum approved (pending / rejected
        // / suspended), tetap berikan akses portal untuk lihat dokumentasi & katalog
        if (status !== "approved") {
            return res.json({
                user: {
                    id: user.id,
                    email: user.email,
                    fullname: user.fullname,
                    phone: user.phone || "",
                    member_code: memberCode,
                    balance: balance,
                    reseller_status: status,
                    reseller_tier: { code: "pending", name: "Menunggu Verifikasi", discount_percent: 0 },
                    reseller_since: null
                },
                metrics,
                news: portalNews,
                security_indicator: {
                    two_factor: false,
                    two_factor_available: false,
                    ip_whitelist_active: false,
                    webhook_configured: false,
                    api_key_active: false
                },
                api_credentials: {
                    api_key: "Belum Aktif (Akun Menunggu Verifikasi)",
                    masked_secret: "••••••••••••••••",
                    ip_whitelist: "",
                    webhook_url: "",
                    webhook_secret: "",
                    is_active: false,
                    total_requests: 0,
                    last_used_at: null,
                    created_at: null
                }
            });
        }

        const tier = await getTier(user.reseller_tier);

        // Ambil atau buat record API Key otomatis jika belum ada
        let apiKeyRow = null;
        try {
            const { data: keyData, error: keyErr } = await supabase
                .from("reseller_api_keys")
                .select("id, api_key, secret_key, ip_whitelist, webhook_url, webhook_secret, is_active, total_requests, last_used_at, created_at")
                .eq("user_id", user.id)
                .maybeSingle();

            if (keyErr && isMissingTableError(keyErr)) {
                return res.status(503).json({ message: BELUM_SETUP, code: "RESELLER_NOT_SETUP" });
            }

            if (!keyData) {
                const newKey = generateResellerApiKey();
                const newSec = generateResellerSecretKey();
                const newWhSec = generateResellerWebhookSecret();
                const { data: createdKey } = await supabase
                    .from("reseller_api_keys")
                    .insert([{
                        user_id: user.id,
                        api_key: newKey,
                        secret_key: newSec,
                        webhook_secret: newWhSec,
                        is_active: true
                    }])
                    .select()
                    .single();
                apiKeyRow = createdKey;
            } else {
                apiKeyRow = keyData;
            }
        } catch (err) {
            console.error("getPortalOverview key:", err.message);
        }

        res.json({
            user: {
                id: user.id,
                email: user.email,
                fullname: user.fullname,
                phone: user.phone || "",
                member_code: memberCode,
                balance: balance,
                reseller_status: status,
                reseller_tier: tier ? { code: tier.code, name: tier.name, discount_percent: tier.discount_percent } : null,
                reseller_since: user.reseller_since
            },
            metrics,
            news: portalNews,
            // Indikator keamanan dilaporkan apa adanya. `two_factor` tetap
            // false karena NexShop memang BELUM punya 2FA untuk akun mitra --
            // portal wajib menampilkannya sebagai "belum aktif / belum
            // tersedia", bukan mencentangnya hijau seolah sudah menyala.
            security_indicator: {
                two_factor: false,
                two_factor_available: false,
                ip_whitelist_active: !!(apiKeyRow && apiKeyRow.ip_whitelist),
                webhook_configured: !!(apiKeyRow && apiKeyRow.webhook_url),
                api_key_active: !!(apiKeyRow && apiKeyRow.is_active)
            },
            api_credentials: apiKeyRow ? {
                api_key: apiKeyRow.api_key,
                masked_secret: maskSecret(apiKeyRow.secret_key),
                ip_whitelist: apiKeyRow.ip_whitelist || "",
                webhook_url: apiKeyRow.webhook_url || "",
                webhook_secret: apiKeyRow.webhook_secret || "",
                is_active: apiKeyRow.is_active,
                total_requests: apiKeyRow.total_requests || 0,
                last_used_at: apiKeyRow.last_used_at,
                created_at: apiKeyRow.created_at
            } : null
        });
    } catch (err) {
        console.error("getPortalOverview:", err.message);
        res.status(500).json({ message: "Gagal memuat data portal reseller" });
    }
};

/**
 * Buka Kunci / Reveal Secret Key (Unmasked)
 */
exports.revealSecretKey = async (req, res) => {
    try {
        const { data: user } = await supabase.from("users").select("reseller_status").eq("id", req.user.id).maybeSingle();
        if (!user || user.reseller_status !== "approved") {
            return res.status(403).json({ message: "Akun belum diverifikasi oleh admin. Tunggu verifikasi maksimal 3x24 jam kerja untuk mengakses Secret Key." });
        }

        const { data: keyRecord, error } = await supabase
            .from("reseller_api_keys")
            .select("secret_key, webhook_secret")
            .eq("user_id", req.user.id)
            .maybeSingle();

        if (error || !keyRecord) {
            return res.status(404).json({ message: "Kredensial API tidak ditemukan" });
        }

        res.json({
            secret_key: keyRecord.secret_key,
            webhook_secret: keyRecord.webhook_secret
        });
    } catch (err) {
        console.error("revealSecretKey:", err.message);
        res.status(500).json({ message: "Gagal menampilkan Secret Key" });
    }
};

/**
 * Generate / Rotate API Key & Secret Key baru
 */
exports.generateOrRotateApiKey = async (req, res) => {
    try {
        const { data: user } = await supabase.from("users").select("reseller_status").eq("id", req.user.id).maybeSingle();
        if (!user || user.reseller_status !== "approved") {
            return res.status(403).json({ message: "Akun belum diverifikasi oleh admin (Maksimal 3x24 Jam kerja). Pembuatan API Key akan aktif otomatis setelah akun disetujui." });
        }

        const newApiKey = generateResellerApiKey();
        const newSecretKey = generateResellerSecretKey();
        const newWebhookSecret = generateResellerWebhookSecret();

        const { data, error } = await supabase
            .from("reseller_api_keys")
            .upsert({
                user_id: req.user.id,
                api_key: newApiKey,
                secret_key: newSecretKey,
                webhook_secret: newWebhookSecret,
                is_active: true,
                updated_at: new Date().toISOString()
            }, { onConflict: "user_id" })
            .select()
            .single();

        if (error) throw error;

        notify("reseller", `🔑 Reseller ${req.user.email} me-rotate API Key baru`);

        res.json({
            message: "API Key dan Secret Key baru berhasil dibuat. Simpan Secret Key di tempat aman!",
            api_key: data.api_key,
            secret_key: data.secret_key,
            webhook_secret: data.webhook_secret
        });
    } catch (err) {
        console.error("generateOrRotateApiKey:", err.message);
        res.status(500).json({ message: "Gagal membuat API Key baru" });
    }
};

/**
 * Update Pengaturan IP Whitelist & Webhook URL
 */
exports.updatePortalSettings = async (req, res) => {
    const rawIp = String(req.body.ip_whitelist || "").trim();
    const rawWebhook = String(req.body.webhook_url || "").trim();

    try {
        const { data: user } = await supabase.from("users").select("reseller_status").eq("id", req.user.id).maybeSingle();
        if (!user || user.reseller_status !== "approved") {
            return res.status(403).json({ message: "Akun belum diverifikasi oleh admin (Maksimal 3x24 Jam kerja)." });
        }

        // VALIDASI IP WHITELIST — lihat validasiIpWhitelist().
        const ipCheck = validasiIpWhitelist(rawIp);
        if (!ipCheck.ok) {
            return res.status(400).json({ message: ipCheck.reason, field: "ip_whitelist" });
        }

        // VALIDASI WEBHOOK URL (ANTI-SSRF) — lihat utils/safeOutboundUrl.js.
        // Tanpa ini, reseller bisa menyimpan URL yang mengarah ke jaringan
        // internal NexShop (localhost, database, endpoint metadata cloud)
        // lalu memakai tombol "Tes Webhook" untuk memaksa server kita
        // mengambil isinya. Pengecekan DNS dilakukan sekalian di sini
        // supaya URL yang jelas-jelas tidak bisa dikirimi tidak pernah
        // tersimpan.
        let webhookTersimpan = null;
        if (rawWebhook) {
            const cek = await assertSafeOutboundUrl(rawWebhook);
            if (!cek.ok) {
                return res.status(400).json({ message: cek.reason, field: "webhook_url" });
            }
            webhookTersimpan = cek.url;
        }

        const payload = {
            ip_whitelist: ipCheck.value,
            webhook_url: webhookTersimpan,
            updated_at: new Date().toISOString()
        };

        const { data, error } = await supabase
            .from("reseller_api_keys")
            .update(payload)
            .eq("user_id", req.user.id)
            .select("api_key, ip_whitelist, webhook_url, is_active")
            .single();

        if (error) throw error;

        res.json({
            message: "Pengaturan IP Whitelist & Webhook berhasil disimpan.",
            settings: data
        });
    } catch (err) {
        console.error("updatePortalSettings:", err.message);
        res.status(500).json({ message: "Gagal menyimpan pengaturan" });
    }
};

/**
 * Daftar Produk & Harga Modal Khusus Reseller untuk Portal
 */
exports.getPortalProducts = async (req, res) => {
    try {
        const konteksReseller = await getResellerContext(req.user.id);
        const searchQuery = String(req.query.q || "").toLowerCase().trim();
        const categoryFilter = String(req.query.kategori || "").trim();

        let query = supabase
            .from("topup_products")
            .select("id, nama, kode_produk, kategori, source_operator_name, harga_beli, harga_jual, butuh_server_id, is_active, operator_logo, item_icon")
            .eq("is_active", true)
            .order("kategori")
            .order("harga_jual")
            .limit(1000);

        if (categoryFilter && categoryFilter !== "all") {
            query = query.ilike("kategori", `%${categoryFilter}%`);
        }

        const { data: products, error } = await query;
        if (error) throw error;

        const results = (products || []).map((p) => {
            let hargaNormal = p.harga_jual;
            if (!hargaNormal || hargaNormal === 0) {
                hargaNormal = hitungMarkupWajar(p.harga_beli || 0, p.kategori, p.source_operator_name);
            }

            const rCalc = hitungHargaReseller(hargaNormal, p.harga_beli || 0, konteksReseller.discountPercent || 0);

            return {
                id: p.id,
                kode_produk: p.kode_produk,
                nama: cleanProductName(p.nama),
                kategori: p.kategori,
                operator: p.source_operator_name || p.kategori,
                harga_normal: rCalc.harga_normal,
                harga_modal_reseller: rCalc.harga,
                diskon_persen: konteksReseller.discountPercent,
                butuh_server_id: !!p.butuh_server_id,
                status: "tersedia",
                operator_logo: p.operator_logo,
                item_icon: p.item_icon
            };
        });

        // Client search filter
        const filtered = searchQuery
            ? results.filter(
                  (p) =>
                      p.kode_produk.toLowerCase().includes(searchQuery) ||
                      p.nama.toLowerCase().includes(searchQuery) ||
                      p.operator.toLowerCase().includes(searchQuery)
              )
            : results;

        // BUG FIX: dulu baris ini membaca `konteksReseller.tierName` --
        // properti yang TIDAK PERNAH ada di objek hasil getResellerContext
        // (bentuknya {isReseller, tier, discountPercent}). Nilainya selalu
        // undefined, jadi portal selamanya menampilkan label generik
        // "Reseller" alih-alih nama tier asli milik akun.
        res.json({
            is_reseller: konteksReseller.isReseller,
            tier: konteksReseller.tier ? konteksReseller.tier.name : null,
            tier_code: konteksReseller.tier ? konteksReseller.tier.code : null,
            discount_percent: Number(konteksReseller.discountPercent) || 0,
            total_products: filtered.length,
            products: filtered
        });
    } catch (err) {
        console.error("getPortalProducts:", err.message);
        res.status(500).json({ message: "Gagal memuat katalog produk portal reseller" });
    }
};

/**
 * Riwayat Transaksi Reseller
 */
exports.getPortalOrders = async (req, res) => {
    try {
        const { data: orders, error } = await supabase
            .from("topup_orders")
            .select("id, nama_produk, kode_produk, tujuan, server_id, harga, status, tv_sn, tv_message, payment_method, created_at, updated_at")
            .eq("user_id", req.user.id)
            .order("created_at", { ascending: false })
            .limit(100);

        if (error) throw error;

        res.json((orders || []).map((order) => ({
            id: order.id,
            ref_id: order.id,
            produk: order.nama_produk || order.kode_produk || "Produk NexShop",
            kode_produk: order.kode_produk,
            tujuan: order.tujuan,
            server_id: order.server_id,
            total: Number(order.harga) || 0,
            status: order.status,
            sn: order.tv_sn,
            message: order.tv_message,
            payment_method: order.payment_method,
            created_at: order.created_at,
            updated_at: order.updated_at
        })));
    } catch (err) {
        console.error("getPortalOrders:", err.message);
        res.status(500).json({ message: "Gagal memuat riwayat transaksi" });
    }
};

/**
 * Tes Kirim Webhook ke URL Reseller
 */
exports.testPortalWebhook = async (req, res) => {
    try {
        const { data: keyRecord, error } = await supabase
            .from("reseller_api_keys")
            .select("webhook_url, webhook_secret")
            .eq("user_id", req.user.id)
            .maybeSingle();

        if (error || !keyRecord || !keyRecord.webhook_url) {
            return res.status(400).json({ message: "URL Webhook belum diatur. Masukkan URL endpoint callback Anda terlebih dahulu." });
        }

        // Re-validasi TEPAT SEBELUM request dikirim, bukan cuma saat
        // disimpan. URL bisa lolos waktu disimpan lalu domainnya diarahkan
        // ke IP internal belakangan (DNS rebinding) -- pengecekan di sini
        // yang menutup celah itu.
        const cek = await assertSafeOutboundUrl(keyRecord.webhook_url);
        if (!cek.ok) {
            return res.status(400).json({
                success: false,
                message: "URL webhook ditolak: " + cek.reason,
                code: "WEBHOOK_URL_REJECTED"
            });
        }

        const targetUrl = cek.url;
        const secret = keyRecord.webhook_secret;
        if (!secret) {
            return res.status(503).json({ message: "Webhook Secret belum tersedia. Buat ulang kredensial API lalu coba lagi." });
        }

        const testPayload = {
            event: "nexshop.test",
            reference_id: "TEST-TRX-" + Date.now(),
            order_id: "NX-TEST-998811",
            status: "SUCCESS",
            product_code: "ML86",
            product_name: "Mobile Legends 86 Diamond",
            target: "12345678",
            server_id: "2123",
            amount: 18500,
            serial_number: "TEST_SN_NEXSHOP_2026",
            message: "Tes Callback Webhook Reseller Berhasil",
            timestamp: new Date().toISOString()
        };

        const rawBody = JSON.stringify(testPayload);
        const signature = generateWebhookSignature(rawBody, secret);

        const startTime = Date.now();
        let responseStatus = 0;
        let responseSnippet = "";

        try {
            const resp = await axios.post(targetUrl, rawBody, {
                headers: {
                    "Content-Type": "application/json",
                    "User-Agent": "NexShop-Webhook-Relay/1.0",
                    "X-NexShop-Event": "nexshop.test",
                    "X-NexShop-Signature": signature
                },
                timeout: 8000,
                // Redirect TIDAK diikuti: endpoint publik yang sudah lolos
                // validasi bisa membalas 302 ke http://169.254.169.254 dan
                // axios akan menurutinya tanpa validasi ulang. Reseller yang
                // endpoint-nya memang redirect harus memberi URL final.
                maxRedirects: 0,
                maxContentLength: 64 * 1024,
                maxBodyLength: 64 * 1024,
                // Semua status HTTP dianggap "respons", bukan exception,
                // supaya 4xx/5xx dari server mitra dilaporkan apa adanya.
                validateStatus: () => true
            });
            responseStatus = resp.status;
            responseSnippet = typeof resp.data === "object" ? JSON.stringify(resp.data) : String(resp.data == null ? "" : resp.data);
        } catch (postErr) {
            responseStatus = postErr.response ? postErr.response.status : 0;
            // Hanya pesan error jaringan yang ditampilkan, BUKAN body
            // respons -- body dari host yang tak terduga tidak pernah
            // dipantulkan balik ke pemanggil.
            responseSnippet = postErr.code || postErr.message || "Gagal terhubung";
        }

        const durationMs = Date.now() - startTime;
        const isSuccess = responseStatus >= 200 && responseStatus < 300;

        res.json({
            success: isSuccess,
            status_code: responseStatus,
            duration_ms: durationMs,
            target_url: targetUrl,
            response_body: String(responseSnippet || "(kosong)").slice(0, 300),
            message: isSuccess
                ? "Tes webhook BERHASIL! Server Anda merespons HTTP " + responseStatus
                : "Tes webhook GAGAL. Server Anda merespons HTTP " + (responseStatus || "Timeout/Connection Error")
        });
    } catch (err) {
        console.error("testPortalWebhook:", err.message);
        res.status(500).json({ message: "Gagal mengirim tes webhook: " + err.message });
    }
};

/**
 * GET /api/reseller/portal/price-list
 *
 * Rincian harga produk untuk SEMUA level (tier) reseller sekaligus.
 *
 * Kenapa dihitung di server, bukan di browser:
 * angka margin adalah aturan bisnis. Kalau persentase tier dikirim ke
 * frontend lalu frontend yang mengalikan sendiri, hasil di file unduhan
 * bisa berbeda dari harga yang benar-benar ditagih saat checkout (mis.
 * karena pembulatan, atau karena lantai margin minimum NexShop tidak ikut
 * diterapkan). Semua harga di sini keluar dari hitungHargaReseller() yang
 * PERSIS SAMA dengan yang dipakai checkout dan Open API.
 *
 * Format: ?format=csv (default) atau ?format=json
 */
exports.getResellerPriceList = async (req, res) => {
    try {
        const { data: user, error: userErr } = await supabase
            .from("users")
            .select("id, email, fullname, reseller_status, reseller_tier")
            .eq("id", req.user.id)
            .maybeSingle();

        if (userErr) {
            if (isMissingTableError(userErr)) return res.status(503).json({ message: BELUM_SETUP, code: "RESELLER_NOT_SETUP" });
            throw userErr;
        }
        if (!user) return res.status(404).json({ message: "User tidak ditemukan" });

        // Daftar harga modal adalah informasi komersial internal mitra --
        // hanya untuk akun yang benar-benar sudah disetujui admin.
        if (user.reseller_status !== "approved") {
            return res.status(403).json({
                message: "Daftar harga reseller hanya tersedia untuk akun mitra yang sudah diverifikasi admin.",
                code: "RESELLER_NOT_APPROVED",
                reseller_status: user.reseller_status || "none"
            });
        }

        const tiers = await getTiers({ activeOnly: true });
        if (!tiers.length) {
            return res.status(503).json({
                message: "Tingkatan reseller belum dikonfigurasi admin.",
                code: "RESELLER_TIERS_EMPTY"
            });
        }

        const kategoriFilter = String(req.query.kategori || "").trim();
        const format = String(req.query.format || "csv").toLowerCase();

        let query = supabase
            .from("topup_products")
            .select("id, nama, kode_produk, kategori, source_operator_name, harga_beli, harga_jual, butuh_server_id, is_active")
            .eq("is_active", true)
            .order("kategori", { ascending: true })
            .order("harga_jual", { ascending: true })
            .limit(5000);

        if (kategoriFilter && kategoriFilter !== "all") {
            query = query.ilike("kategori", "%" + kategoriFilter + "%");
        }

        const { data: products, error } = await query;
        if (error) throw error;

        const tierAktifKode = user.reseller_tier || null;

        const baris = (products || []).map((p) => {
            let hargaNormal = Number(p.harga_jual) || 0;
            if (hargaNormal <= 0) {
                hargaNormal = hitungMarkupWajar(p.harga_beli || 0, p.kategori, p.source_operator_name);
            }

            const perTier = {};
            for (const t of tiers) {
                const hasil = hitungHargaReseller(hargaNormal, p.harga_beli || 0, t.discount_percent);
                perTier[t.code] = {
                    tier_name: t.name,
                    diskon_persen: t.discount_percent,
                    harga: hasil.harga,
                    hemat: hasil.hemat,
                    // persen_efektif bisa lebih kecil daripada diskon_persen
                    // kalau harga menyentuh lantai margin minimum NexShop.
                    persen_efektif: hasil.persen_efektif,
                    kena_lantai_margin: hasil.kena_lantai
                };
            }

            return {
                kode_produk: p.kode_produk,
                nama: cleanProductName(p.nama),
                kategori: p.kategori || "",
                operator: p.source_operator_name || p.kategori || "",
                harga_normal: hargaNormal,
                butuh_server_id: !!p.butuh_server_id,
                harga_per_tier: perTier
            };
        });

        const meta = {
            toko: "NexShop",
            digenerate_pada: new Date().toISOString(),
            untuk_mitra: user.fullname || user.email,
            tier_aktif: tierAktifKode,
            total_produk: baris.length,
            catatan: "Harga sudah termasuk margin NexShop dan tidak pernah turun di bawah modal + margin minimum."
        };

        if (format === "json") {
            return res.json({
                meta,
                tiers: tiers.map((t) => ({ code: t.code, name: t.name, discount_percent: t.discount_percent })),
                products: baris
            });
        }

        // ---- CSV ----
        // Setiap nilai dilewatkan csvCell() yang menetralkan formula Excel.
        // Tanpa itu, nama produk yang kebetulan diawali "=" atau "+" akan
        // dieksekusi sebagai rumus begitu file dibuka (CSV injection).
        const header = [
            "Kode SKU",
            "Nama Produk",
            "Kategori",
            "Operator",
            "Butuh Server ID",
            "Harga Normal"
        ];
        for (const t of tiers) {
            header.push(t.name + " (" + t.discount_percent + "%)");
            header.push("Hemat " + t.name);
        }

        const lines = [header.map(csvCell).join(",")];
        for (const row of baris) {
            const cells = [
                row.kode_produk,
                row.nama,
                row.kategori,
                row.operator,
                row.butuh_server_id ? "Ya" : "Tidak",
                row.harga_normal
            ];
            for (const t of tiers) {
                const info = row.harga_per_tier[t.code];
                cells.push(info ? info.harga : "");
                cells.push(info ? info.hemat : "");
            }
            lines.push(cells.map(csvCell).join(","));
        }

        // Baris keterangan di bawah tabel supaya isi file tetap bisa
        // dipertanggungjawabkan kalau dibuka terpisah dari portal.
        lines.push("");
        lines.push([csvCell("Digenerate"), csvCell(new Date().toLocaleString("id-ID"))].join(","));
        lines.push([csvCell("Untuk mitra"), csvCell(meta.untuk_mitra)].join(","));
        lines.push([csvCell("Tier aktif"), csvCell(tierAktifKode || "-")].join(","));
        lines.push([csvCell("Catatan"), csvCell(meta.catatan)].join(","));

        // BOM UTF-8 supaya Excel di Windows membaca huruf beraksen dengan benar.
        const csv = "﻿" + lines.join("\r\n");
        const namaFile = "Daftar-Harga-Reseller-NexShop-" + new Date().toISOString().slice(0, 10) + ".csv";

        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", 'attachment; filename="' + namaFile + '"');
        res.setHeader("Cache-Control", "no-store");
        return res.send(csv);
    } catch (err) {
        console.error("getResellerPriceList:", err.message);
        return res.status(500).json({ message: "Gagal menyusun daftar harga reseller" });
    }
};

/**
 * GET /api/reseller/admin/kyc-document?ref=kyc:<path>
 *
 * Satu-satunya jalan untuk melihat foto KTP pendaftar.
 *
 * Sebelumnya foto KTP disimpan di bucket publik dan URL-nya ditempel
 * langsung ke <img src> di dashboard admin -- artinya berkasnya bisa dibuka
 * siapa pun yang pernah melihat URL itu, selamanya, tanpa login. Sekarang:
 *   * berkasnya tersimpan terenkripsi di bucket privat,
 *   * hanya admin/staff terautentikasi yang bisa memintanya,
 *   * dekripsi terjadi di memori dan hasilnya dikirim dengan header
 *     no-store supaya tidak mengendap di cache browser/proxy,
 *   * setiap akses dicatat ke log sebagai jejak audit.
 */
exports.getKycDocument = async (req, res) => {
    const ref = String(req.query.ref || "").trim();

    if (!isDocumentRef(ref)) {
        return res.status(400).json({
            message: "Referensi dokumen tidak valid.",
            code: "INVALID_DOC_REF"
        });
    }

    const objectPath = parseDocumentRef(ref);
    if (!objectPath) {
        // parseDocumentRef sudah menolak path traversal & karakter aneh.
        return res.status(400).json({ message: "Referensi dokumen ditolak.", code: "INVALID_DOC_REF" });
    }

    try {
        // Jejak audit: siapa membuka dokumen identitas siapa, kapan.
        console.log(`[KYC-AUDIT] ${new Date().toISOString()} admin=${req.user.email} membuka dokumen ${objectPath}`);

        const bucket = process.env.SUPABASE_KYC_BUCKET || "kyc-documents";
        const { data, error } = await supabase.storage.from(bucket).download(objectPath);

        if (error || !data) {
            return res.status(404).json({ message: "Dokumen tidak ditemukan di penyimpanan." });
        }

        const terenkripsi = Buffer.from(await data.arrayBuffer());

        let gambar;
        try {
            gambar = decryptDocument(terenkripsi);
        } catch (dekripErr) {
            console.error("getKycDocument dekripsi gagal:", dekripErr.message);
            return res.status(500).json({
                message: "Dokumen gagal didekripsi. Berkas mungkin rusak atau kunci enkripsi berubah.",
                code: "DECRYPT_FAILED"
            });
        }

        // no-store + noindex: dokumen identitas tidak boleh mengendap di
        // cache mana pun maupun terindeks.
        res.setHeader("Content-Type", "image/webp");
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("X-Robots-Tag", "noindex, nofollow");
        res.setHeader("Content-Disposition", "inline");
        return res.send(gambar);
    } catch (err) {
        console.error("getKycDocument:", err.message);
        return res.status(500).json({ message: "Gagal memuat dokumen identitas" });
    }
};

exports._internal = { normalisasiWhatsApp, csvCell };

