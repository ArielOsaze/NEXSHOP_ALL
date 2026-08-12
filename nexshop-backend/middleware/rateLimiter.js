const rateLimit = require("express-rate-limit");
const { notify } = require("../config/notify");

// Kenapa ini penting: sebelumnya endpoint login/register/OTP gak ada
// batasan sama sekali, jadi bisa di-brute-force (nebak password/kode OTP
// berkali-kali tanpa dikunci) atau di-spam (kirim OTP ke email orang lain
// berkali-kali, boros kuota Brevo). Semua limiter di bawah dihitung per
// alamat IP.

const LOGIN_WINDOW_MS = 15 * 60 * 1000;

// IP yang lagi diblokir loginLimiter, dicatat di sini juga (selain di tabel
// notifikasi) supaya dashboard admin bisa nampilin daftarnya langsung —
// admin tinggal klik "Buka Blokir", gak perlu cari-cari/copas IP manual dari
// Notifikasi. ip -> timestamp kapan terakhir kena blokir.
const blockedLoginIps = new Map();

// Kalau ada user beneran (bukan attacker) yang kena limit ini gara-gara lupa
// password berkali-kali, dia harus nunggu sampai windowMs abis. Supaya admin
// bisa buka blokirnya lebih cepat tanpa nunggu, `handler` di bawah nyatet IP
// yang kena blokir (ke Notifikasi & ke daftar di Dashboard > Settings >
// Keamanan), dan resetLoginLimiter() di bawah dipakai controller admin buat
// buka blokirnya untuk 1 IP.
const loginLimiter = rateLimit({
    windowMs: LOGIN_WINDOW_MS,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Terlalu banyak percobaan login. Coba lagi dalam beberapa menit, atau hubungi admin untuk membuka blokir." },
    handler: (req, res, next, options) => {
        blockedLoginIps.set(req.ip, Date.now());
        notify("security", `🔒 Login diblokir sementara untuk IP ${req.ip} (10x percobaan gagal dalam 15 menit). Admin bisa buka blokir dari Dashboard > Settings > Keamanan.`);
        res.status(options.statusCode).json(options.message);
    }
});

// Daftar IP yang lagi diblokir (buat ditampilin di Dashboard > Settings >
// Keamanan). IP yang udah lewat windowMs otomatis kebuka sendiri, jadi
// dibuang dari daftar di sini juga.
function getBlockedLoginIps() {
    const now = Date.now();
    const result = [];
    for (const [ip, blockedAt] of blockedLoginIps.entries()) {
        if (now - blockedAt >= LOGIN_WINDOW_MS) {
            blockedLoginIps.delete(ip);
            continue;
        }
        result.push({ ip, blockedAt });
    }
    return result.sort((a, b) => b.blockedAt - a.blockedAt);
}

// Dipakai admin (lewat Dashboard > Settings > Keamanan) buat langsung buka
// blokir loginLimiter di atas untuk 1 alamat IP tertentu, tanpa perlu nunggu
// windowMs (15 menit) abis sendiri.
async function resetLoginLimiter(ip) {
    await loginLimiter.resetKey(ip);
    blockedLoginIps.delete(ip);
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

// Reset password tetap pakai token acak yang panjang, tetapi endpoint ini
// dibatasi agar tidak bisa dipakai untuk membebani bcrypt/database lewat
// request otomatis dalam jumlah besar.
const resetPasswordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Terlalu banyak percobaan reset password. Coba lagi beberapa menit." }
});

// Chat can trigger database retrieval and optional personalization. Keep it
// separate from the broad API limiter so one client cannot exhaust the worker.
const aiChatLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 40,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Terlalu banyak pesan ke NexBot. Coba lagi beberapa menit." }
});

// Cek Nickname — cegah abuse / spam hit api eksternal
const checkNicknameLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 menit
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Terlalu banyak percobaan cek akun. Silakan tunggu sebentar." }
});

module.exports = { loginLimiter, registerLimiter, otpVerifyLimiter, otpResendLimiter, forgotPasswordLimiter, resetPasswordLimiter, aiChatLimiter, resetLoginLimiter, getBlockedLoginIps, checkNicknameLimiter };
