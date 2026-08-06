const supabase = require("../config/db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { sendOtpEmail, sendPasswordResetEmail } = require("../config/mailer");
const { notify } = require("../config/notify");
const { resetLoginLimiter, getBlockedLoginIps } = require("../middleware/rateLimiter");

const OTP_EXPIRY_MINUTES = 10;
const RESET_TOKEN_EXPIRY_MINUTES = 30;
// dipakai buat bikin link reset password (lihat .env.example) -- sama kayak
// FRONTEND_URL di orderController.js/topupController.js
const FRONTEND_URL = (process.env.FRONTEND_URL || "").replace(/\/$/, "");

function isValidEmail(value) {
    return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) && value.length <= 254;
}

function hashResetToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
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

    if (!fullname || !email || !password) {
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

        const hashedPassword = await bcrypt.hash(password, 10);
        const otp = generateOtp();
        const otpExpiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString();

        const { error: insertErr } = await supabase
            .from("users")
            .insert([{
                fullname,
                email,
                password: hashedPassword,
                email_verified: false,
                otp_code: otp,
                otp_expires_at: otpExpiresAt
            }]);

        if (insertErr) {
            console.log(insertErr);
            return res.status(500).json({ message: "Gagal register" });
        }

        try {
            await sendOtpEmail(email, otp);
        } catch (mailErr) {
            console.log("Gagal kirim email OTP:", mailErr.message);
            // akun tetap dibuat, kode OTP tersimpan di DB (admin bisa lihat
            // lewat menu Users > OTP Aktif kalau emailnya gak sampai), dan
            // user bisa minta kirim ulang lewat /resend-otp
            return res.status(201).json({
                message: "Register berhasil, tapi gagal mengirim email OTP. Silakan minta kirim ulang atau hubungi admin.",
                email,
                emailSent: false
            });
        }

        res.status(201).json({
            message: "Register berhasil. Cek email kamu untuk kode verifikasi.",
            email,
            emailSent: true
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

        if (!user.otp_code || user.otp_code !== otp) {
            return res.status(400).json({ message: "Kode OTP salah" });
        }

        if (!user.otp_expires_at || new Date(user.otp_expires_at) < new Date()) {
            return res.status(400).json({ message: "Kode OTP sudah kedaluwarsa, minta kirim ulang" });
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
            .select("id, email_verified")
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
        const otpExpiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString();

        const { error: updateErr } = await supabase
            .from("users")
            .update({ otp_code: otp, otp_expires_at: otpExpiresAt })
            .eq("id", user.id);

        if (updateErr) {
            console.log(updateErr);
            return res.status(500).json({ message: "Gagal membuat kode baru" });
        }

        try {
            await sendOtpEmail(email, otp);
        } catch (mailErr) {
            console.log("Gagal kirim ulang email OTP:", mailErr.message);
            // kode OTP tetap dibuat & tersimpan di DB (bisa dilihat admin lewat
            // menu Users > OTP Aktif kalau emailnya gak sampai)
            return res.json({
                message: "Kode OTP baru sudah dibuat, tapi email gagal terkirim. Hubungi admin/CS untuk minta kode OTP kamu.",
                emailSent: false
            });
        }

        res.json({ message: "Kode OTP baru sudah dikirim ke email kamu.", emailSent: true });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Server Error" });
    }
};

// LOGIN
exports.login = async (req, res) => {
    const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body.password === "string" ? req.body.password : "";

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

        res.json({
            message: "Login berhasil",
            token,
            ...(user.role === "admin" ? { securityPinSetupRequired: !user.security_pin_hash } : {}),
            user: {
                id: user.id,
                fullname: user.fullname,
                email: user.email,
                role: user.role
            }
        });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Server Error" });
    }
};

// ADMIN — daftar IP yang lagi diblokir loginLimiter sekarang, biar admin
// tinggal klik "Buka Blokir" tanpa perlu cari-cari IP-nya sendiri.
exports.listBlockedIps = async (req, res) => {
    if (req.user.role !== "admin") {
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
    if (req.user.role !== "admin") {
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
