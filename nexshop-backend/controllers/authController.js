const supabase = require("../config/db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");
const { sendOtpEmail, sendPasswordResetEmail } = require("../config/mailer");
const { sendUserWhatsApp } = require("../services/userWhatsAppService");
const { normalizePhoneNumber } = require("../utils/phoneNumber");
const { notify } = require("../config/notify");
const { resetLoginLimiter, getBlockedLoginIps } = require("../middleware/rateLimiter");
const { resetAdminSession } = require("../middleware/adminSession");
const { getTurnstileConfig, isTurnstileRequired, verifyTurnstile } = require("../services/turnstileService");
const { getRuntimeConfig } = require("../services/runtimeConfigService");

const OTP_EXPIRY_MINUTES = 10;
const RESET_TOKEN_EXPIRY_MINUTES = 30;
// dipakai buat bikin link reset password (lihat .env.example) -- sama kayak
// FRONTEND_URL di orderController.js/topupController.js
const FRONTEND_URL = (process.env.FRONTEND_URL || "").replace(/\/$/, "");
const BACKEND_URL = (process.env.BACKEND_URL || "").replace(/\/$/, "");
const GOOGLE_STATE_TTL = "10m";
const GOOGLE_EXCHANGE_TTL_MS = 2 * 60 * 1000;
const googleExchangeCodes = new Map();

function isValidEmail(value) {
    return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) && value.length <= 254;
}

function hashResetToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
}

function authUserPayload(user) {
    return {
        id: user.id,
        fullname: user.fullname,
        email: user.email,
        role: user.role,
        avatar_url: user.avatar_url,
        phone: user.phone
    };
}

function issueUserSession(user) {
    const token = jwt.sign(
        { id: user.id, email: user.email, fullname: user.fullname, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
    );
    clearFailedLogin(user.email);
    resetAdminSession(user.id);
    return {
        token,
        user: authUserPayload(user),
        ...(["admin", "staff"].includes(user.role) ? { securityPinSetupRequired: !user.security_pin_hash } : {})
    };
}

function isProviderSchemaError(error) {
    const code = String(error?.code || "");
    const message = String(error?.message || "").toLowerCase();
    return code === "42703" || message.includes("schema cache") || message.includes("google_subject") || message.includes("auth_provider");
}

async function requireHumanVerification(req, res) {
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

async function googleConfig() {
    const config = await getRuntimeConfig();
    const clientId = String(config.GOOGLE_OAUTH_CLIENT_ID || "").trim();
    const clientSecret = String(config.GOOGLE_OAUTH_CLIENT_SECRET || "").trim();
    const redirectUri = String(config.GOOGLE_OAUTH_REDIRECT_URI || `${BACKEND_URL}/api/auth/google/callback`).trim();
    return { clientId, clientSecret, redirectUri };
}

async function getGoogleClient() {
    const { clientId, clientSecret, redirectUri } = await googleConfig();
    if (!clientId || !clientSecret || !redirectUri) return null;
    return new OAuth2Client(clientId, clientSecret, redirectUri);
}

function safeReturnPath(value) {
    const path = typeof value === "string" ? value : "/";
    return /^\/(?!\/)[^\s]*$/.test(path) ? path : "/";
}

function frontendRedirect(returnPath, params) {
    const base = FRONTEND_URL || "http://localhost:5500";
    const target = new URL(base + safeReturnPath(returnPath));
    Object.entries(params).forEach(([key, value]) => target.searchParams.set(key, value));
    return target.toString();
}

function purgeGoogleExchangeCodes() {
    const now = Date.now();
    for (const [code, record] of googleExchangeCodes) {
        if (record.expiresAt <= now) googleExchangeCodes.delete(code);
    }
}

function createGoogleExchangeCode(session) {
    purgeGoogleExchangeCodes();
    const code = crypto.randomBytes(32).toString("base64url");
    googleExchangeCodes.set(code, { ...session, expiresAt: Date.now() + GOOGLE_EXCHANGE_TTL_MS });
    return code;
}

// Deteksi spam login sederhana (in-memory, per instance server) — bukan
// pengganti rate limiter beneran, tapi cukup buat kasih tau admin kalau ada
// yang lagi nyoba brute-force satu akun.
const FAILED_LOGIN_WINDOW_MS = 10 * 60 * 1000; // 10 menit
const FAILED_LOGIN_THRESHOLD = 5;
const failedLoginMap = new Map(); // email -> [timestamps]

function recordFailedLogin(email) {
    const now = Date.now();
    const timestamps = (failedLoginMap.get(email) || []).filter(t => now - t < FAILED_LOGIN_WINDOW_MS);
    timestamps.push(now);
    failedLoginMap.set(email, timestamps);

    if (timestamps.length === FAILED_LOGIN_THRESHOLD) {
        notify("security", `🚨 Terdeteksi ${FAILED_LOGIN_THRESHOLD}x percobaan login gagal untuk ${email} dalam 10 menit terakhir — kemungkinan brute-force.`);
    }
}

function clearFailedLogin(email) {
    failedLoginMap.delete(email);
}

function generateOtp() {
    // kode 6 digit cryptographically secure, contoh "042817"
    return String(crypto.randomInt(100000, 1000000));
}

// di-export biar bisa dipakai userController buat fitur admin "Kirim Ulang OTP"
// (kirim OTP baru ke user tertentu langsung dari admin dashboard, tanpa perlu
// user login/minta sendiri)
exports.generateOtp = generateOtp;
exports.OTP_EXPIRY_MINUTES = OTP_EXPIRY_MINUTES;

// REGISTER
exports.register = async (req, res) => {
    const fullname = typeof req.body.fullname === "string" ? req.body.fullname.trim() : "";
    const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body.password === "string" ? req.body.password : "";
    const otpMethod = typeof req.body.otp_method === "string" ? req.body.otp_method : "email";
    let whatsapp = typeof req.body.whatsapp === "string" ? req.body.whatsapp.trim() : "";

    if (!await requireHumanVerification(req, res)) return;

    if (!fullname || !email || !password) {
        return res.status(400).json({ message: "Semua field wajib diisi" });
    }
    if (otpMethod === "whatsapp" && !whatsapp) {
        return res.status(400).json({ message: "Nomor WhatsApp wajib diisi jika memilih verifikasi via WhatsApp" });
    }
    if (fullname.length > 100 || !isValidEmail(email) || password.length < 8 || password.length > 128) {
        return res.status(400).json({ message: "Data registrasi tidak valid. Password minimal 8 karakter." });
    }

    if (otpMethod === "whatsapp") {
        whatsapp = normalizePhoneNumber(whatsapp);
        if (!whatsapp || whatsapp.length < 9) {
            return res.status(400).json({ message: "Nomor WhatsApp tidak valid" });
        }
    }

    try {
        const { data: existing, error: findErr } = await supabase
            .from("users")
            .select("id")
            .eq("email", email)
            .maybeSingle();

        if (findErr) {
            console.log(findErr);
            return res.status(500).json({ message: "Database Error" });
        }

        if (existing) {
            return res.status(400).json({ message: "Email sudah terdaftar" });
        }

        if (otpMethod === "whatsapp") {
            const { data: existingPhone, error: findPhoneErr } = await supabase
                .from("users")
                .select("id")
                .eq("phone", whatsapp)
                .maybeSingle();

            if (findPhoneErr) {
                console.log(findPhoneErr);
                return res.status(500).json({ message: "Database Error" });
            }

            if (existingPhone) {
                return res.status(400).json({ message: "Nomor WhatsApp tersebut sudah terdaftar pada akun lain." });
            }
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const otp = generateOtp();
        const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");
        const otpExpiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString();

        const { error: insertErr } = await supabase
            .from("users")
            .insert([{
                fullname,
                email,
                password: hashedPassword,
                email_verified: false,
                otp_code: hashedOtp,
                otp_expires_at: otpExpiresAt,
                phone: otpMethod === "whatsapp" ? whatsapp : null
            }]);

        if (insertErr) {
            console.log(insertErr);
            if (insertErr.code === '23505' && insertErr.message && insertErr.message.includes('users_phone_key')) {
                return res.status(400).json({ message: "Nomor WhatsApp tersebut sudah terdaftar pada akun lain." });
            }
            return res.status(500).json({ message: "Gagal register" });
        }

        let deliverySent = false;
        let deliveryChannel = otpMethod === "whatsapp" ? "whatsapp" : "email";

        try {
            if (otpMethod === "whatsapp") {
                const resWA = await sendUserWhatsApp(whatsapp, "otp", { otp });
                if (resWA.success) {
                    deliverySent = true;
                } else if (resWA.reason === "disabled_type" || resWA.reason === "disabled_globally") {
                    // WA dinonaktifkan admin — fallback ke email
                    try {
                        await sendOtpEmail(email, otp);
                        deliverySent = true;
                        deliveryChannel = "email";
                    } catch (_) {
                        deliverySent = false;
                    }
                } else {
                    throw new Error("Gagal API Fonnte");
                }
            } else {
                await sendOtpEmail(email, otp);
                deliverySent = true;
            }
        } catch (mailErr) {
            console.log("Gagal kirim OTP:", mailErr.message);
            deliverySent = false;
        }

        if (!deliverySent) {
            return res.status(201).json({
                message: "Register berhasil, tapi gagal mengirim OTP. Silakan minta kirim ulang atau hubungi admin.",
                email,
                otp_method: otpMethod,
                deliverySent: false,
                deliveryChannel
            });
        }

        res.status(201).json({
            message: "Register berhasil. Cek " + (deliveryChannel === "whatsapp" ? "WhatsApp" : "email") + " kamu untuk kode verifikasi.",
            email,
            otp_method: otpMethod,
            deliverySent: true,
            deliveryChannel
        });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Server Error" });
    }
};

// VERIFY OTP
exports.verifyOtp = async (req, res) => {
    const { email, otp } = req.body;

    if (!email || !otp) {
        return res.status(400).json({ message: "Email dan kode OTP wajib diisi" });
    }

    // Hanya terima format 6 digit — cegah hash bypass (string hash 64 char
    // yang tersimpan di DB tidak boleh bisa dipakai sebagai kode OTP)
    if (typeof otp !== "string" || !/^\d{6}$/.test(otp)) {
        return res.status(400).json({ message: "Kode OTP harus 6 digit angka" });
    }

    try {
        const { data: user, error } = await supabase
            .from("users")
            .select("id, otp_code, otp_expires_at, email_verified")
            .eq("email", email)
            .maybeSingle();

        if (error) {
            console.log(error);
            return res.status(500).json({ message: "Database Error" });
        }

        if (!user) {
            return res.status(404).json({ message: "Akun tidak ditemukan" });
        }

        if (user.email_verified) {
            return res.status(400).json({ message: "Akun sudah terverifikasi" });
        }

        if (!user.otp_code) {
            return res.status(400).json({ message: "Tidak ada kode OTP aktif. Silakan minta kirim ulang." });
        }

        if (!user.otp_expires_at || new Date(user.otp_expires_at) < new Date()) {
            return res.status(400).json({ message: "Kode OTP sudah kedaluwarsa. Silakan minta kirim ulang." });
        }

        const hashedInput = crypto.createHash("sha256").update(otp).digest("hex");

        if (user.otp_code.length !== 64) {
            return res.status(400).json({ message: "Kode OTP versi lama tidak berlaku lagi demi keamanan. Silakan klik 'Kirim Ulang OTP' untuk mendapatkan kode baru." });
        }

        if (user.otp_code !== hashedInput) {
            return res.status(400).json({ message: "Kode OTP salah. Periksa kembali atau minta kirim ulang." });
        }

        const { error: updateErr } = await supabase
            .from("users")
            .update({ email_verified: true, otp_code: null, otp_expires_at: null })
            .eq("id", user.id);

        if (updateErr) {
            console.log(updateErr);
            return res.status(500).json({ message: "Gagal verifikasi akun" });
        }

        res.json({ message: "Verifikasi berhasil. Kamu sekarang bisa login." });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Server Error" });
    }
};

// RESEND OTP
exports.resendOtp = async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ message: "Email wajib diisi" });
    }

    try {
        const { data: user, error } = await supabase
            .from("users")
            .select("id, email_verified, phone")
            .eq("email", email)
            .maybeSingle();

        if (error) {
            console.log(error);
            return res.status(500).json({ message: "Database Error" });
        }

        if (!user) {
            return res.status(404).json({ message: "Akun tidak ditemukan" });
        }

        if (user.email_verified) {
            return res.status(400).json({ message: "Akun sudah terverifikasi" });
        }

        const otp = generateOtp();
        const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");
        const otpExpiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString();

        const { error: updateErr } = await supabase
            .from("users")
            .update({ otp_code: hashedOtp, otp_expires_at: otpExpiresAt })
            .eq("id", user.id);

        if (updateErr) {
            console.log(updateErr);
            return res.status(500).json({ message: "Gagal membuat kode baru" });
        }

        let deliverySent = false;
        let deliveryChannel = (req.body.otp_method === "whatsapp" && user.phone) ? "whatsapp" : "email";

        try {
            if (req.body.otp_method === "whatsapp" && user.phone) {
                const resWA = await sendUserWhatsApp(user.phone, "otp", { otp });
                if (resWA.success) {
                    deliverySent = true;
                } else if (resWA.reason === "disabled_type" || resWA.reason === "disabled_globally") {
                    // WA dinonaktifkan — fallback ke email
                    try {
                        await sendOtpEmail(email, otp);
                        deliverySent = true;
                        deliveryChannel = "email";
                    } catch (_) {
                        deliverySent = false;
                    }
                } else {
                    throw new Error("Gagal API Fonnte");
                }
            } else {
                await sendOtpEmail(email, otp);
                deliverySent = true;
            }
        } catch (mailErr) {
            console.log("Gagal kirim ulang OTP:", mailErr.message);
            deliverySent = false;
        }

        if (!deliverySent) {
            return res.json({
                message: "Kode OTP baru sudah dibuat, tapi gagal terkirim. Hubungi admin/CS untuk minta kode OTP kamu.",
                deliverySent: false,
                deliveryChannel
            });
        }

        res.json({
            message: `Kode OTP baru sudah dikirim ke ${deliveryChannel === "whatsapp" ? "WhatsApp" : "email"} kamu.`,
            deliverySent: true,
            deliveryChannel
        });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Server Error" });
    }
};

// LOGIN
exports.login = async (req, res) => {
    const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body.password === "string" ? req.body.password : "";

    if (!await requireHumanVerification(req, res)) return;

    if (!isValidEmail(email) || !password || password.length > 128) {
        return res.status(401).json({ message: "Email atau password salah" });
    }

    try {
        const { data: user, error } = await supabase
            .from("users")
            .select("*")
            .ilike("email", email)
            .maybeSingle();

        if (error) {
            console.log(error);
            return res.status(500).json({ message: "Database Error" });
        }

        if (!user) {
            recordFailedLogin(email);
            return res.status(401).json({ message: "Email atau password salah" });
        }

        const validPassword = await bcrypt.compare(password, user.password);

        if (!validPassword) {
            recordFailedLogin(email);
            return res.status(401).json({ message: "Email atau password salah" });
        }

        if (!user.email_verified && user.role !== "admin") {
            return res.status(403).json({
                message: "Email belum diverifikasi. Cek kode OTP yang dikirim ke emailmu.",
                needsVerification: true,
                email: user.email
            });
        }

        if (user.is_blacklisted) {
            return res.status(403).json({
                message: "Akun kamu telah diblokir. Hubungi admin NexShop kalau ini keliru."
            });
        }

        const token = jwt.sign(
            { id: user.id, email: user.email, fullname: user.fullname, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: "7d" }
        );

        clearFailedLogin(email);

        // Sesi admin yang lama (termasuk catatan idle-nya) dibuang begitu
        // login baru sukses -- kalau nggak, admin yang barusan ke-logout
        // otomatis karena idle bisa langsung ketolak lagi sama guard-nya.
        resetAdminSession(user.id);

        res.json({
            message: "Login berhasil",
            token,
            ...(["admin", "staff"].includes(user.role) ? { securityPinSetupRequired: !user.security_pin_hash } : {}),
            user: {
                id: user.id,
                fullname: user.fullname,
                email: user.email,
                role: user.role,
                avatar_url: user.avatar_url,
                phone: user.phone
            }
        });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Server Error" });
    }
};

// Konfigurasi publik sengaja hanya mengirim site key Turnstile dan status
// provider. Secret Turnstile/Google tidak pernah melewati endpoint ini.
exports.publicAuthConfig = async (req, res) => {
    const { siteKey, secretKey } = await getTurnstileConfig();
    const { clientId, clientSecret, redirectUri } = await googleConfig();
    res.json({
        turnstile_site_key: siteKey && secretKey ? siteKey : "",
        turnstile_required: await isTurnstileRequired(),
        google_enabled: Boolean(clientId && clientSecret && redirectUri)
    });
};

async function sendGoogleStart(req, res, action) {
    const client = await getGoogleClient();
    if (!client) {
        return res.status(503).json({ message: "Login Google belum dikonfigurasi. Coba metode login lain.", code: "GOOGLE_NOT_CONFIGURED" });
    }

    const returnPath = safeReturnPath(req.query.return_to);
    const payload = {
        type: "google-oauth-state",
        action,
        returnPath,
        nonce: crypto.randomBytes(18).toString("base64url")
    };
    if (action === "link") payload.userId = req.user.id;

    const state = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: GOOGLE_STATE_TTL, audience: "nexshop-google-oauth" });
    const url = client.generateAuthUrl({
        access_type: "offline",
        prompt: "select_account",
        scope: ["openid", "email", "profile"],
        state
    });
    return res.json({ url });
}

exports.googleStart = (req, res) => sendGoogleStart(req, res, "login");
exports.googleLinkStart = (req, res) => sendGoogleStart(req, res, "link");

function redirectGoogleFailure(res, returnPath, error) {
    return res.redirect(302, frontendRedirect(returnPath, { oauth_error: error }));
}

async function findOrCreateGoogleUser(googleProfile) {
    const { sub, email, email_verified: emailVerified, name } = googleProfile;
    if (!sub || !email || !emailVerified) {
        return { error: "google_email_unverified" };
    }
    const normalizedEmail = String(email).trim().toLowerCase();
    const { data: linkedUser, error: linkedErr } = await supabase
        .from("users")
        .select("id, fullname, email, role, avatar_url, phone, is_blacklisted, security_pin_hash, google_subject, auth_provider")
        .eq("google_subject", sub)
        .maybeSingle();
    if (linkedErr) {
        if (isProviderSchemaError(linkedErr)) return { error: "provider_schema_missing" };
        throw linkedErr;
    }
    if (linkedUser) return { user: linkedUser };

    const { data: sameEmailUser, error: emailErr } = await supabase
        .from("users")
        .select("id")
        .eq("email", normalizedEmail)
        .maybeSingle();
    if (emailErr) throw emailErr;
    // Tidak boleh mengaitkan akun lama hanya karena alamat email sama. Pemilik
    // harus masuk dengan passwordnya sendiri lalu menjalankan Link Google.
    if (sameEmailUser) return { error: "account_link_required" };

    const generatedPassword = await bcrypt.hash(crypto.randomBytes(32).toString("base64url"), 10);
    const fullname = String(name || normalizedEmail.split("@")[0]).trim().slice(0, 100) || "Pengguna NexShop";
    const { data: createdUser, error: createErr } = await supabase
        .from("users")
        .insert([{
            fullname,
            email: normalizedEmail,
            password: generatedPassword,
            email_verified: true,
            google_subject: sub,
            auth_provider: "google"
        }])
        .select("id, fullname, email, role, avatar_url, phone, is_blacklisted, security_pin_hash, google_subject, auth_provider")
        .maybeSingle();
    if (createErr) {
        if (isProviderSchemaError(createErr)) return { error: "provider_schema_missing" };
        if (createErr.code === "23505") return { error: "account_link_required" };
        throw createErr;
    }
    return { user: createdUser };
}

async function linkGoogleUser(userId, googleProfile) {
    const { sub, email, email_verified: emailVerified } = googleProfile;
    if (!sub || !email || !emailVerified) return { error: "google_email_unverified" };

    const [{ data: localUser, error: localErr }, { data: linkedUser, error: linkedErr }] = await Promise.all([
        supabase.from("users").select("id, email, auth_provider").eq("id", userId).maybeSingle(),
        supabase.from("users").select("id").eq("google_subject", sub).maybeSingle()
    ]);
    if (localErr || linkedErr) {
        const error = localErr || linkedErr;
        if (isProviderSchemaError(error)) return { error: "provider_schema_missing" };
        throw error;
    }
    if (!localUser) return { error: "link_account_missing" };
    if (linkedUser && String(linkedUser.id) !== String(userId)) return { error: "google_already_linked" };
    if (String(localUser.email || "").toLowerCase() !== String(email).trim().toLowerCase()) {
        return { error: "link_email_mismatch" };
    }

    const provider = localUser.auth_provider === "google" ? "google" : "password_google";
    const { error: updateErr } = await supabase
        .from("users")
        .update({ google_subject: sub, auth_provider: provider })
        .eq("id", userId);
    if (updateErr) {
        if (isProviderSchemaError(updateErr)) return { error: "provider_schema_missing" };
        throw updateErr;
    }
    const { data: user, error: userErr } = await supabase
        .from("users")
        .select("id, fullname, email, role, avatar_url, phone, is_blacklisted, security_pin_hash")
        .eq("id", userId)
        .maybeSingle();
    if (userErr || !user) throw userErr || new Error("User link tidak ditemukan");
    return { user };
}

exports.googleCallback = async (req, res) => {
    let state;
    try {
        state = jwt.verify(String(req.query.state || ""), process.env.JWT_SECRET, { audience: "nexshop-google-oauth" });
    } catch (_) {
        return redirectGoogleFailure(res, "/", "invalid_state");
    }
    const returnPath = safeReturnPath(state.returnPath);
    if (req.query.error || !req.query.code || state.type !== "google-oauth-state") {
        return redirectGoogleFailure(res, returnPath, "cancelled");
    }

    const client = await getGoogleClient();
    if (!client) return redirectGoogleFailure(res, returnPath, "not_configured");

    try {
        const tokenResponse = await client.getToken(String(req.query.code));
        const idToken = tokenResponse.tokens?.id_token;
        if (!idToken) return redirectGoogleFailure(res, returnPath, "verification_failed");
        const ticket = await client.verifyIdToken({ idToken, audience: (await googleConfig()).clientId });
        const profile = ticket.getPayload() || {};
        const outcome = state.action === "link"
            ? await linkGoogleUser(state.userId, profile)
            : await findOrCreateGoogleUser(profile);
        if (outcome.error) return redirectGoogleFailure(res, returnPath, outcome.error);
        if (!outcome.user || outcome.user.is_blacklisted) return redirectGoogleFailure(res, returnPath, "access_denied");

        const session = issueUserSession(outcome.user);
        const exchangeCode = createGoogleExchangeCode(session);
        return res.redirect(302, frontendRedirect(returnPath, { oauth: state.action, code: exchangeCode }));
    } catch (error) {
        console.error("Google OAuth callback failed:", error.message);
        return redirectGoogleFailure(res, returnPath, "verification_failed");
    }
};

exports.googleExchange = (req, res) => {
    const code = typeof req.body?.code === "string" ? req.body.code : "";
    const record = googleExchangeCodes.get(code);
    googleExchangeCodes.delete(code);
    if (!record || record.expiresAt <= Date.now()) {
        return res.status(400).json({ message: "Sesi login Google sudah kedaluwarsa. Silakan coba lagi.", code: "GOOGLE_EXCHANGE_EXPIRED" });
    }
    return res.json({ message: "Login Google berhasil", token: record.token, user: record.user, securityPinSetupRequired: record.securityPinSetupRequired });
};

// ADMIN — daftar IP yang lagi diblokir loginLimiter sekarang, biar admin
// tinggal klik "Buka Blokir" tanpa perlu cari-cari IP-nya sendiri.
exports.listBlockedIps = async (req, res) => {
    if (!["admin", "staff"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    res.json(getBlockedLoginIps());
};

// ADMIN — buka blokir loginLimiter untuk 1 IP. Dipakai kalau ada user yang
// kena "Terlalu banyak percobaan login" (10x gagal / 15 menit) dan gak mau
// nunggu — user kasih tau IP-nya ke admin (lewat WA/chat, IP-nya juga otomatis
// kecatat di Notifikasi tiap kali blokir ini kena), admin tempel di Dashboard
// > Settings > Keamanan, klik "Buka Blokir".
exports.unlockLoginIp = async (req, res) => {
    if (!["admin", "staff"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }

    const ip = (req.body.ip || "").trim();
    if (!ip) {
        return res.status(400).json({ message: "IP wajib diisi" });
    }

    try {
        await resetLoginLimiter(ip);
        notify("security", `🔓 ${req.user.email} membuka blokir login untuk IP ${ip}`);
        res.json({ message: `Blokir login untuk IP ${ip} berhasil dibuka. User bisa langsung coba login lagi.` });
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Gagal membuka blokir" });
    }
};

// LUPA PASSWORD — minta link reset dikirim ke email
exports.forgotPassword = async (req, res) => {
    const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (!isValidEmail(email)) {
        return res.status(400).json({ message: "Email wajib diisi" });
    }

    // Responsnya SENGAJA sama persis baik email-nya terdaftar atau enggak --
    // kalau beda (mis. "email gak ditemukan" vs "link sudah dikirim"), itu
    // jadi celah buat orang nebak-nebak email mana yang punya akun NexShop.
    const genericResponse = {
        message: "Kalau email ini terdaftar, link reset password sudah dikirim. Cek inbox/folder spam kamu."
    };

    try {
        const { data: user, error } = await supabase
            .from("users")
            .select("id, email")
            .eq("email", email)
            .maybeSingle();

        if (error) {
            console.log(error);
            return res.status(500).json({ message: "Database Error" });
        }

        if (!user) {
            return res.json(genericResponse);
        }

        // token acak PANJANG (bukan 6 digit kayak OTP) -- reset password itu
        // sensitif, jadi HARUS gak bisa ditebak/di-brute-force dalam waktu wajar
        const token = crypto.randomBytes(32).toString("hex");
        const tokenHash = hashResetToken(token);
        const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_MINUTES * 60 * 1000).toISOString();

        const { error: updateErr } = await supabase
            .from("users")
            .update({ reset_password_token: tokenHash, reset_password_expires_at: expiresAt })
            .eq("id", user.id);

        if (updateErr) {
            console.log(updateErr);
            return res.status(500).json({ message: "Gagal membuat token reset" });
        }

        // FRONTEND_URL diwajibkan ketika production (divalidasi saat startup).
        // Fallback development memudahkan menjalankan store lokal tanpa
        // membentuk URL dari Host header yang bisa dimanipulasi client.
        const frontendUrl = FRONTEND_URL || "http://localhost:5500";
        const resetLink = `${frontendUrl}/#/reset-password?token=${token}`;

        try {
            await sendPasswordResetEmail(user.email, resetLink);
        } catch (mailErr) {
            // gagal kirim tetap dicatat ke admin_notifications (dari dalam
            // mailer.js) -- tapi ke USER tetap kasih respons generic yang
            // sama, jangan bocorin detail error internal
            console.log("Gagal kirim email reset password:", mailErr.message);
        }

        res.json(genericResponse);
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server Error" });
    }
};

// RESET PASSWORD — submit password baru pakai token dari email
exports.resetPassword = async (req, res) => {
    const token = typeof req.body.token === "string" ? req.body.token : "";
    const newPassword = typeof req.body.newPassword === "string" ? req.body.newPassword : "";

    if (!token || !newPassword) {
        return res.status(400).json({ message: "Token dan password baru wajib diisi" });
    }
    if (!/^[a-f0-9]{64}$/i.test(token) || newPassword.length < 8 || newPassword.length > 128) {
        return res.status(400).json({ message: "Token atau password baru tidak valid. Password minimal 8 karakter." });
    }

    try {
        const tokenHash = hashResetToken(token);
        const { data: user, error } = await supabase
            .from("users")
            .select("id, reset_password_token, reset_password_expires_at")
            .eq("reset_password_token", tokenHash)
            .maybeSingle();

        if (error) {
            console.log(error);
            return res.status(500).json({ message: "Database Error" });
        }

        if (!user || !user.reset_password_expires_at || new Date(user.reset_password_expires_at) < new Date()) {
            return res.status(400).json({
                message: "Link reset password tidak valid atau sudah kedaluwarsa. Silakan minta link baru."
            });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        const { error: updateErr } = await supabase
            .from("users")
            .update({
                password: hashedPassword,
                reset_password_token: null,
                reset_password_expires_at: null
            })
            .eq("id", user.id);

        if (updateErr) {
            console.log(updateErr);
            return res.status(500).json({ message: "Gagal update password" });
        }

        notify("users", `🔑 Password akun (id ${user.id}) berhasil direset lewat email`);
        res.json({ message: "Password berhasil diganti. Silakan login dengan password baru kamu." });
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server Error" });
    }
};
