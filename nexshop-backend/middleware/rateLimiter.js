const rateLimit = require("express-rate-limit");
const { ipKeyGenerator } = require("express-rate-limit");
const { notify } = require("../config/notify");

// Kenapa ini penting: sebelumnya endpoint login/register/OTP gak ada
// batasan sama sekali, jadi bisa di-brute-force (nebak password/kode OTP
// berkali-kali tanpa dikunci) atau di-spam (kirim OTP ke email orang lain
// berkali-kali, boros kuota Brevo). Semua limiter di bawah dihitung per
// alamat IP.

// Login (customer & admin pakai endpoint yang sama) — cegah brute-force
// password. 10 percobaan / 15 menit per IP cukup longgar buat orang lupa
// password beberapa kali, tapi berat buat script brute-force.
//
// Kalau ada user beneran (bukan attacker) yang kena limit ini gara-gara lupa
// password berkali-kali, dia harus nunggu sampai windowMs abis. Supaya admin
// bisa buka blokirnya lebih cepat tanpa nunggu, `handler` di bawah nyatet IP
// yang kena blokir ke tabel notifikasi (lihat "Keamanan" di dashboard admin),
// dan resetLoginLimiter() di bawah dipakai controller admin buat buka
// blokirnya untuk 1 IP.
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Terlalu banyak percobaan login. Coba lagi dalam beberapa menit, atau hubungi admin untuk membuka blokir." },
    handler: (req, res, next, options) => {
        notify("security", `🔒 Login diblokir sementara untuk IP ${req.ip} (10x percobaan gagal dalam 15 menit). Admin bisa buka blokir dari Dashboard > Settings > Keamanan.`);
        res.status(options.statusCode).json(options.message);
    }
});

// Dipakai admin (lewat Dashboard > Settings > Keamanan) buat langsung buka
// blokir loginLimiter di atas untuk 1 alamat IP tertentu, tanpa perlu nunggu
// windowMs (15 menit) abis sendiri.
async function resetLoginLimiter(ip) {
    await loginLimiter.resetKey(ipKeyGenerator(ip));
}

// Register — cegah spam bikin akun / spam kirim OTP ke email orang lain.
const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 6,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Terlalu banyak percobaan registrasi dari perangkat ini. Coba lagi nanti." }
});

// Verifikasi OTP — kode cuma 6 digit (1 juta kemungkinan), jadi HARUS
// dibatasi lebih ketat supaya gak bisa ditebak dengan cara di-brute-force.
const otpVerifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 15,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Terlalu banyak percobaan verifikasi OTP. Tunggu beberapa menit lalu coba lagi." }
});

// Kirim ulang OTP — cegah orang spam klik "kirim ulang" (boros kuota Brevo).
const otpResendLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Terlalu sering minta kirim ulang OTP. Coba lagi dalam beberapa menit." }
});

// Lupa password — cegah spam kirim email reset ke inbox orang lain.
const forgotPasswordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Terlalu banyak permintaan reset password. Coba lagi dalam beberapa menit." }
});

module.exports = { loginLimiter, registerLimiter, otpVerifyLimiter, otpResendLimiter, forgotPasswordLimiter, resetLoginLimiter };
