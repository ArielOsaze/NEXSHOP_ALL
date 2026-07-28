const rateLimit = require("express-rate-limit");

// Kenapa ini penting: sebelumnya endpoint login/register/OTP gak ada
// batasan sama sekali, jadi bisa di-brute-force (nebak password/kode OTP
// berkali-kali tanpa dikunci) atau di-spam (kirim OTP ke email orang lain
// berkali-kali, boros kuota Brevo). Semua limiter di bawah dihitung per
// alamat IP.

// Login (customer & admin pakai endpoint yang sama) — cegah brute-force
// password. 10 percobaan / 15 menit per IP cukup longgar buat orang lupa
// password beberapa kali, tapi berat buat script brute-force.
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Terlalu banyak percobaan login. Coba lagi dalam beberapa menit." }
});

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

module.exports = { loginLimiter, registerLimiter, otpVerifyLimiter, otpResendLimiter, forgotPasswordLimiter };
