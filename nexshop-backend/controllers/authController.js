const supabase = require("../config/db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { sendOtpEmail } = require("../config/mailer");
const { notify } = require("../config/notify");

const OTP_EXPIRY_MINUTES = 10;

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
    // kode 6 digit, contoh "042817"
    return String(Math.floor(100000 + Math.random() * 900000));
}

// REGISTER
exports.register = async (req, res) => {
    const { fullname, email, password } = req.body;

    if (!fullname || !email || !password) {
        return res.status(400).json({ message: "Semua field wajib diisi" });
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
            console.log("Gagal kirim email OTP:", mailErr);
            // akun tetap dibuat, user bisa minta kirim ulang lewat /resend-otp
            return res.status(201).json({
                message: "Register berhasil, tapi gagal mengirim email OTP. Silakan minta kirim ulang.",
                email
            });
        }

        res.status(201).json({
            message: "Register berhasil. Cek email kamu untuk kode verifikasi.",
            email
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

        await sendOtpEmail(email, otp);

        res.json({ message: "Kode OTP baru sudah dikirim ke email kamu." });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Server Error" });
    }
};

// LOGIN
exports.login = async (req, res) => {
    const { email, password } = req.body;

    try {
        const { data: user, error } = await supabase
            .from("users")
            .select("*")
            .eq("email", email)
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

        if (!user.email_verified) {
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
            { id: user.id, email: user.email, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: "7d" }
        );

        clearFailedLogin(email);

        res.json({
            message: "Login berhasil",
            token,
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
