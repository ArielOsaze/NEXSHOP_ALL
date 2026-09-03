const supabase = require("../config/db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");
const { sendOtpEmail, sendPasswordResetEmail } = require("../config/mailer");
const { sendUserWhatsApp, sendUserSecurityWhatsApp } = require("../services/userWhatsAppService");
const { normalizePhoneNumber } = require("../utils/phoneNumber");
const { validateEmail } = require("../utils/emailValidation");
const { startPhoneOtp, verifyPhoneOtp, generateOtp, OTP_EXPIRY_MINUTES, assertPhoneAvailable } = require("../services/phoneOtpService");
const { toPublicProfile, backfillLegacyPhone } = require("../services/userProfileService");
const { notify } = require("../config/notify");
const { resetLoginLimiter, getBlockedLoginIps } = require("../middleware/rateLimiter");
const { rolesFor } = require("../middleware/adminRoles");
const { resetAdminSession } = require("../middleware/adminSession");
const { getTurnstileConfig, isTurnstileRequired, verifyTurnstile } = require("../services/turnstileService");
const { getRuntimeConfig } = require("../services/runtimeConfigService");
const { sendLoginSecurityNotification } = require("../services/loginSecurityNotificationService");
const {
    hashResetToken,
    createPasswordResetToken,
    buildPasswordResetLink,
    buildPasswordResetWhatsAppMessage
} = require("../services/passwordResetService");

// dipakai buat bikin link reset password (lihat .env.example) -- sama kayak
// FRONTEND_URL di orderController.js/topupController.js
const FRONTEND_URL = (process.env.FRONTEND_URL || "").replace(/\/$/, "");
const BACKEND_URL = (process.env.BACKEND_URL || "").replace(/\/$/, "");
const GOOGLE_STATE_TTL = "10m";
const GOOGLE_EXCHANGE_TTL_MS = 2 * 60 * 1000;
const googleExchangeCodes = new Map();

function isValidEmail(value) {
    return validateEmail(value).valid;
}

function authUserPayload(user) {
    return toPublicProfile(user);
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

async function requireHumanVerification(req, res, { allowAdminBootstrap = false } = {}) {
    const { siteKey, secretKey } = await getTurnstileConfig();
    // Admin/staff yang kredensialnya sudah benar tetap perlu jalan masuk untuk
    // memasang Turnstile pertama kali. Bypass ini hanya aktif selama salah satu
    // key belum ada; setelah keduanya tersimpan, admin juga wajib menyelesaikan
    // challenge seperti login lainnya.
    if (allowAdminBootstrap && (!siteKey || !secretKey)) return true;
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

const ACCOUNT_LOGIN_WINDOW_MS = 15 * 60 * 1000;
const ACCOUNT_LOGIN_MAX_FAILURES = 5;

async function recordPersistentFailedLogin(user) {
    const now = Date.now();
    const windowStarted = user.failed_login_window_started_at ? new Date(user.failed_login_window_started_at).getTime() : 0;
    const inWindow = windowStarted && now - windowStarted < ACCOUNT_LOGIN_WINDOW_MS;
    const failures = (inWindow ? Number(user.failed_login_count || 0) : 0) + 1;
    const locked = failures >= ACCOUNT_LOGIN_MAX_FAILURES;
    await supabase.from("users").update({
        failed_login_count: failures,
        failed_login_window_started_at: inWindow ? user.failed_login_window_started_at : new Date(now).toISOString(),
        login_locked_until: locked ? new Date(now + ACCOUNT_LOGIN_WINDOW_MS).toISOString() : null
    }).eq("id", user.id);
    if (locked) notify("security", `🔒 Akun ${user.email} dikunci sementara setelah ${failures} percobaan login gagal.`);
}

async function clearPersistentFailedLogin(userId) {
    await supabase.from("users").update({
        failed_login_count: 0,
        failed_login_window_started_at: null,
        login_locked_until: null
    }).eq("id", userId);
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
    // `whatsapp` diterima sementara demi kompatibilitas frontend lama, tetapi
    // semua registrasi baru wajib diverifikasi melalui nomor WhatsApp.
    const phone = normalizePhoneNumber(typeof req.body.phone === "string" ? req.body.phone : req.body.whatsapp);

    if (!await requireHumanVerification(req, res)) return;

    if (!fullname || !email || !password || !phone) {
        return res.status(400).json({ message: "Semua field wajib diisi" });
    }
    if (fullname.length > 100 || !isValidEmail(email) || password.length < 8 || password.length > 128) {
        return res.status(400).json({ message: "Data registrasi tidak valid. Password minimal 8 karakter." });
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

        try {
            await assertPhoneAvailable(supabase, phone);
        } catch (phoneErr) {
            if (phoneErr.code === "PHONE_ALREADY_IN_USE") return res.status(400).json({ message: "Nomor WhatsApp tersebut sudah digunakan pada akun lain." });
            return res.status(500).json({ message: "Database Error" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const { data: createdUser, error: insertErr } = await supabase
            .from("users")
            .insert([{
                fullname,
                email,
                password: hashedPassword,
                email_verified: false,
                onboarding_completed: false
            }])
            .select("id")
            .maybeSingle();

        if (insertErr) {
            console.log(insertErr);
            return res.status(500).json({ message: "Gagal register" });
        }

        try {
            await startPhoneOtp(supabase, { userId: createdUser.id, phone, purpose: "phone_onboarding" });
        } catch (otpErr) {
            console.log("Gagal kirim OTP WhatsApp saat register:", otpErr.message);
            return res.status(201).json({
                message: "Register berhasil, tapi kode OTP WhatsApp belum dapat dikirim. Silakan minta kirim ulang.",
                email,
                otp_method: "whatsapp",
                deliverySent: false
            });
        }
        return res.status(201).json({
            message: "Register berhasil. Cek WhatsApp kamu untuk kode verifikasi.",
            email,
            otp_method: "whatsapp",
            deliverySent: true
        });

        /*
         * Jalur email/WA campuran lama sengaja dinonaktifkan. OTP nomor baru
         * dibuat oleh phoneOtpService di atas agar tidak ada implementasi OTP
         * kedua yang dapat mengaktifkan akun tanpa verifikasi nomor.
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
        */
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
            .select("id, otp_code, otp_expires_at, email_verified, otp_purpose")
            .eq("email", email)
            .maybeSingle();

        if (error) {
            console.log(error);
            return res.status(500).json({ message: "Database Error" });
        }

        if (!user) {
            return res.status(404).json({ message: "Akun tidak ditemukan" });
        }

        if (user.otp_purpose === "phone_onboarding") {
            try {
                await verifyPhoneOtp(supabase, { userId: user.id, otp });
                // `email_verified` adalah flag aktivasi historis yang dipakai
                // guard login. Untuk registrasi password, aktivasi sekarang
                // terjadi setelah pemilik membuktikan nomor WhatsApp-nya.
                await supabase.from("users").update({ email_verified: true }).eq("id", user.id);
                return res.json({ message: "Nomor WhatsApp berhasil diverifikasi. Kamu sekarang bisa login." });
            } catch (otpErr) {
                return res.status(400).json({ message: otpErr.message || "Verifikasi nomor gagal." });
            }
        }

        if (user.email_verified) {
            return res.status(400).json({ message: "Akun sudah terverifikasi" });
        }

        if (!user.otp_code) {
            return res.status(400).json({ message: "Tidak ada kode OTP aktif. Silakan minta kirim ulang." });
        }

        if (!user.otp_expires_at || new Date(user.otp_expires_at) <= new Date()) {
            return res.status(400).json({ message: "Kode OTP sudah kedaluwarsa. Silakan minta kirim ulang." });
        }

        const hashedInput = crypto.createHash("sha256").update(otp).digest("hex");

        if (user.otp_code.length !== 64) {
            return res.status(400).json({ message: "Kode OTP versi lama tidak berlaku lagi demi keamanan. Silakan klik 'Kirim Ulang OTP' untuk mendapatkan kode baru." });
        }

        if (user.otp_code !== hashedInput) {
            return res.status(400).json({ message: "Kode OTP salah. Periksa kembali atau minta kirim ulang." });
        }

        const { data: consumed, error: updateErr } = await supabase
            .from("users")
            .update({ email_verified: true, otp_code: null, otp_expires_at: null })
            .eq("id", user.id)
            .eq("otp_code", user.otp_code)
            .eq("otp_expires_at", user.otp_expires_at)
            .select("id")
            .maybeSingle();

        if (updateErr) {
            console.log(updateErr);
            return res.status(500).json({ message: "Gagal verifikasi akun" });
        }
        if (!consumed) {
            return res.status(400).json({ message: "Kode OTP sudah dipakai atau tidak lagi aktif. Silakan minta kode baru." });
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
            .select("id, email, fullname, email_verified, phone, pending_phone_normalized, otp_purpose")
            .eq("email", email)
            .maybeSingle();

        if (error) {
            console.log(error);
            return res.status(500).json({ message: "Database Error" });
        }

        if (!user) {
            return res.status(404).json({ message: "Akun tidak ditemukan" });
        }

        if (user.otp_purpose === "phone_onboarding" && user.pending_phone_normalized) {
            try {
                await startPhoneOtp(supabase, {
                    userId: user.id,
                    phone: user.pending_phone_normalized,
                    purpose: "phone_onboarding"
                });
                return res.json({ message: "Kode OTP baru sudah dikirim ke WhatsApp kamu.", deliverySent: true, deliveryChannel: "whatsapp" });
            } catch (otpErr) {
                const status = otpErr.code === "OTP_COOLDOWN" ? 429 : 503;
                return res.status(status).json({ message: otpErr.message || "Gagal mengirim ulang kode OTP." });
            }
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
                const resWA = await sendUserWhatsApp(user.phone, "otp", { otp, name: user.fullname, email: user.email });
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
    const requestedLoginContext = typeof req.body.login_context === "string" ? req.body.login_context.trim().toLowerCase() : "";
    const referer = String(req.get("referer") || "");
    // Kompatibilitas terhadap JS lama yang masih tersimpan di cache browser:
    // request dari halaman /admin/login tetap diperlakukan sebagai admin login.
    const loginContext = requestedLoginContext || (/\/admin(?:\/|$)/i.test(referer) ? "admin" : "user");

    if (!isValidEmail(email) || !password || password.length > 128) {
        return res.status(401).json({ message: "Email atau password salah" });
    }

    if (!["user", "admin"].includes(loginContext)) {
        return res.status(400).json({ message: "Konteks login tidak valid" });
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

        // Identity Portal Reseller sengaja tidak memiliki sesi storefront.
        // Walaupun seseorang mengetahui email portal, kredensialnya tidak boleh
        // membuka akun belanja utama atau mendapatkan JWT customer biasa.
        if (user.account_scope === "portal_only") {
            return res.status(403).json({
                message: "Akun ini khusus Portal Reseller. Gunakan halaman Masuk Portal Reseller.",
                code: "PORTAL_ACCOUNT_ONLY"
            });
        }

        if (user.login_locked_until && new Date(user.login_locked_until) > new Date()) {
            return res.status(429).json({ message: "Terlalu banyak percobaan login. Coba lagi beberapa menit lagi atau gunakan lupa password." });
        }

        const validPassword = await bcrypt.compare(password, user.password);

        if (!validPassword) {
            recordFailedLogin(email);
            await recordPersistentFailedLogin(user);
            return res.status(401).json({ message: "Email atau password salah" });
        }

        if (loginContext === "admin" && !rolesFor("dashboard").includes(user.role)) {
            return res.status(403).json({ message: "Akun ini tidak memiliki akses administrator atau staff." });
        }
        // Admin/staff tetap boleh masuk ke web utama sebagai sesi storefront.
        // Perlindungan dashboard dan endpoint sensitif tetap ditegakkan oleh
        // middleware role di server, bukan oleh login context ini.

        // Turnstile diperiksa setelah password valid agar super admin bisa
        // bootstrap konfigurasi pertama dari dashboard. Endpoint tetap dibatasi
        // loginLimiter, dan customer tidak mendapat bypass ini.
        const isAdminDashboardUser = rolesFor("dashboard").includes(user.role);
        if (!await requireHumanVerification(req, res, { allowAdminBootstrap: isAdminDashboardUser })) return;

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

        await backfillLegacyPhone(user);
        await clearPersistentFailedLogin(user.id);
        const session = issueUserSession(user);
        res.json({ message: "Login berhasil", ...session });
        sendLoginSecurityNotification(user, req, { loginContext }).catch((notificationError) => {
            console.log("Login security notification gagal:", notificationError.message);
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

function normalizeGooglePicture(picture) {
    return typeof picture === "string" && /^https:\/\//i.test(picture)
        ? picture.slice(0, 2048)
        : null;
}

async function findOrCreateGoogleUser(googleProfile) {
    const { sub, email, email_verified: emailVerified, name, picture } = googleProfile;
    const googlePicture = normalizeGooglePicture(picture);
    if (!sub || !email || !emailVerified) {
        return { error: "google_email_unverified" };
    }
    const normalizedEmail = String(email).trim().toLowerCase();
    const { data: linkedUser, error: linkedErr } = await supabase
        .from("users")
        .select("*")
        .eq("google_subject", sub)
        .maybeSingle();
    if (linkedErr) {
        if (isProviderSchemaError(linkedErr)) return { error: "provider_schema_missing" };
        throw linkedErr;
    }
    if (linkedUser) {
        // Google hanya menjadi fallback avatar. Foto upload NexShop tidak pernah
        // ditimpa oleh login OAuth berikutnya.
        if (!linkedUser.avatar_url && googlePicture) {
            const { data: hydratedUser, error: avatarErr } = await supabase
                .from("users")
                .update({ avatar_url: googlePicture })
                .eq("id", linkedUser.id)
                .select("*")
                .maybeSingle();
            if (avatarErr) throw avatarErr;
            return { user: hydratedUser || linkedUser };
        }
        return { user: linkedUser };
    }

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
            auth_provider: "google",
            onboarding_completed: false,
            // Hanya nilai awal saat akun dibuat. Login berikutnya tidak pernah
            // menimpa avatar NexShop yang dipilih pengguna.
            avatar_url: googlePicture
        }])
        .select("*")
        .maybeSingle();
    if (createErr) {
        if (isProviderSchemaError(createErr)) return { error: "provider_schema_missing" };
        if (createErr.code === "23505") return { error: "account_link_required" };
        throw createErr;
    }
    return { user: createdUser };
}

async function linkGoogleUser(userId, googleProfile) {
    const { sub, email, email_verified: emailVerified, picture } = googleProfile;
    const googlePicture = normalizeGooglePicture(picture);
    if (!sub || !email || !emailVerified) return { error: "google_email_unverified" };

    const [{ data: localUser, error: localErr }, { data: linkedUser, error: linkedErr }] = await Promise.all([
        supabase.from("users").select("id, email, auth_provider, avatar_url").eq("id", userId).maybeSingle(),
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
    const profileUpdate = { google_subject: sub, auth_provider: provider };
    if (!localUser.avatar_url && googlePicture) profileUpdate.avatar_url = googlePicture;
    const { error: updateErr } = await supabase
        .from("users")
        .update(profileUpdate)
        .eq("id", userId);
    if (updateErr) {
        if (isProviderSchemaError(updateErr)) return { error: "provider_schema_missing" };
        throw updateErr;
    }
    const { data: user, error: userErr } = await supabase
        .from("users")
        .select("*")
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

        await backfillLegacyPhone(outcome.user);
        const session = issueUserSession(outcome.user);
        const googleLoginContext = /^\/admin(?:\/|$)/i.test(returnPath) ? "admin" : "user";
        if (state.action === "login") {
            sendLoginSecurityNotification(outcome.user, req, { loginContext: googleLoginContext }).catch((notificationError) => {
                console.log("Login security notification Google gagal:", notificationError.message);
            });
        }
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
            .select("id, email, fullname, phone, phone_normalized")
            .eq("email", email)
            .maybeSingle();

        if (error) {
            console.log(error);
            return res.status(500).json({ message: "Database Error" });
        }

        if (!user) {
            return res.json(genericResponse);
        }

        // Satu token acak dipakai bersama oleh email dan WhatsApp. Database
        // hanya menyimpan hash; token mentah tidak pernah ditulis ke log.
        const resetToken = createPasswordResetToken();
        const frontendUrl = FRONTEND_URL || "http://localhost:5500";
        const resetLink = buildPasswordResetLink(frontendUrl, resetToken.token);
        const resetWhatsAppMessage = buildPasswordResetWhatsAppMessage({
            fullname: user.fullname,
            email: user.email,
            resetLink
        });

        const { error: updateErr } = await supabase
            .from("users")
            .update({
                reset_password_token: resetToken.tokenHash,
                reset_password_expires_at: resetToken.expiresAt
            })
            .eq("id", user.id);

        if (updateErr) {
            console.log(updateErr);
            return res.status(500).json({ message: "Gagal membuat token reset" });
        }

        // Kedua delivery dicoba tanpa membocorkan apakah salah satunya gagal.
        // Token tetap single-use dan akan hangus otomatis setelah 5 menit.
        const deliveries = await Promise.allSettled([
            sendPasswordResetEmail(user.email, resetLink, user.fullname),
            user.phone || user.phone_normalized
                ? sendUserSecurityWhatsApp(user.phone || user.phone_normalized, resetWhatsAppMessage)
                : Promise.resolve({ success: false, reason: "missing_user_phone" })
        ]);
        if (deliveries.some((result) => result.status === "rejected")) {
            console.log("Gagal mengirim salah satu channel reset password.");
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

        if (!user || !user.reset_password_expires_at || new Date(user.reset_password_expires_at) <= new Date()) {
            return res.status(400).json({
                message: "Link reset password tidak valid atau sudah kedaluwarsa. Silakan minta link baru."
            });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        const { data: consumed, error: updateErr } = await supabase
            .from("users")
            .update({
                password: hashedPassword,
                reset_password_token: null,
                reset_password_expires_at: null
            })
            .eq("id", user.id)
            .eq("reset_password_token", tokenHash)
            .eq("reset_password_expires_at", user.reset_password_expires_at)
            .select("id")
            .maybeSingle();

        if (updateErr) {
            console.log(updateErr);
            return res.status(500).json({ message: "Gagal update password" });
        }
        if (!consumed) {
            return res.status(400).json({
                message: "Link reset password tidak valid atau sudah dipakai. Silakan minta link baru."
            });
        }

        notify("users", `🔑 Password akun (id ${user.id}) berhasil direset lewat link aman`);
        res.json({ message: "Password berhasil diganti. Silakan login dengan password baru kamu." });
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server Error" });
    }
};
