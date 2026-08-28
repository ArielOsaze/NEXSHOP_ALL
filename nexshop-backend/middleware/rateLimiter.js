const rateLimit = require("express-rate-limit");
// ipKeyGenerator menormalkan alamat IPv6 ke prefix /64 sebelum dipakai
// sebagai kunci. Tanpa itu, satu klien IPv6 bisa berpindah-pindah
// alamat di dalam blok miliknya sendiri dan mendapat jatah limit baru
// terus-menerus (express-rate-limit v7 juga memperingatkan soal ini).
const { ipKeyGenerator } = require("express-rate-limit");
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

// Cek Tagihan (inquiry pascabayar) — dibatasi JAUH lebih ketat dari cek
// nickname: tiap panggilan inquiry ke TokoVoucher itu berbayar (motong
// saldo deposit kita), jadi satu IP yang nge-spam tombol "Cek Tagihan"
// beneran bikin saldo kekuras walaupun gak ada transaksi sama sekali.
const inquiryLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 menit
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Terlalu banyak permintaan cek tagihan. Tunggu sebentar ya." }
});

// Pendaftaran reseller — cegah satu orang spam kirim pengajuan berkali-kali
// (tiap pengajuan bikin notifikasi ke admin + WhatsApp).
const resellerApplyLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Terlalu banyak percobaan pendaftaran reseller. Coba lagi nanti." }
});

// Upload KYC dapat dilakukan sebelum login agar pendaftar baru bisa mengisi
// formulir, tetapi endpoint anonim dengan file besar perlu kuota tersendiri.
const kycUploadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Terlalu banyak upload dokumen identitas. Coba lagi satu jam lagi." }
});

// Login khusus Partner Portal reseller. Sebelumnya endpoint
// POST /api/reseller/auth/login TIDAK punya limiter sama sekali, jadi
// password akun mitra (yang saldonya bisa jutaan rupiah) bisa ditebak
// tanpa batas -- padahal login toko utama sudah dibatasi sejak lama.
const resellerLoginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Terlalu banyak percobaan login Partner Portal. Coba lagi dalam beberapa menit." }
});

const resellerTwoFactorVerifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 15,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Terlalu banyak percobaan kode 2FA. Coba lagi dalam beberapa menit." }
});

// Open API reseller (/api/v1/reseller/*). Dibatasi PER API KEY, bukan per

// IP: satu mitra biasanya memanggil dari satu server, jadi kunci per-IP
// akan salah sasaran begitu beberapa mitra berbagi jaringan/NAT yang sama.
// Kalau kunci API belum terbaca, jatuh ke IP.
const resellerApiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        const key = req.headers["x-nexshop-api-key"] || req.headers["x-api-key"];
        if (key) return "apikey:" + String(key).slice(0, 64);
        const auth = String(req.headers["authorization"] || "");
        if (auth.startsWith("Bearer nx_live_")) return "apikey:" + auth.slice(7, 71);
        return "ip:" + ipKeyGenerator(req.ip || "unknown");
    },
    message: {
        success: false,
        message: "Rate limit terlampaui (maksimal 120 request per menit). Beri jeda antar permintaan.",
        code: "RATE_LIMITED"
    }
});

// Endpoint tes webhook memicu request keluar dari server kita ke alamat
// yang ditentukan mitra. Tanpa batas, tombol itu bisa dipakai sebagai
// amplifier untuk membanjiri pihak ketiga dari IP NexShop.
const resellerWebhookTestLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Terlalu sering menjalankan tes webhook. Coba lagi beberapa menit lagi." }
});

// Callback pembayaran wallet tidak terautentikasi (verifikasinya
// server-to-server ke iPaymu). Setiap panggilan memicu satu request keluar,
// jadi lajunya tetap perlu dibatasi supaya tidak bisa dipakai menghabiskan
// kuota API gateway pembayaran.
const walletNotificationLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Terlalu banyak notifikasi masuk." }
});

module.exports = { resellerLoginLimiter, resellerApiLimiter, resellerWebhookTestLimiter, walletNotificationLimiter, loginLimiter, registerLimiter, otpVerifyLimiter, otpResendLimiter, forgotPasswordLimiter, resetPasswordLimiter, aiChatLimiter, resetLoginLimiter, getBlockedLoginIps, checkNicknameLimiter, inquiryLimiter, resellerApplyLimiter, kycUploadLimiter, resellerTwoFactorVerifyLimiter };
