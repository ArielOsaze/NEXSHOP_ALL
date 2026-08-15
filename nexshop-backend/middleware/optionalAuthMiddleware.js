const jwt = require("jsonwebtoken");

// Beda sama authMiddleware biasa: kalau TIDAK ada token, tetap lanjut
// (req.user = null) — dipakai buat endpoint yang boleh diakses guest
// maupun user login (misal checkout tanpa akun).
//
// BUG FIX (audit Agustus 2026): sebelumnya, kalau ADA token tapi ternyata
// tidak valid/kadaluarsa, request langsung ditolak 401 -- termasuk di
// endpoint publik seperti checkout (POST /orders, POST /topup) dan cek
// eligibility rating (GET /ratings/eligibility/:orderId).
//
// Masalahnya: token JWT di app ini kadaluarsa otomatis dalam 7 hari
// (lihat authController.js, jwt.sign expiresIn: "7d"), TAPI frontend
// TIDAK PERNAH menghapus token dari localStorage secara otomatis saat
// kadaluarsa -- token cuma dihapus kalau user klik tombol Logout secara
// eksplisit. Akibatnya, user yang pernah login lalu kembali ke situs
// setelah >7 hari (skenario umum untuk pengunjung yang tidak setiap hari
// belanja) akan selalu terkirim token basi di header Authorization, dan:
//   1. Checkout (produk maupun topup) GAGAL TOTAL dengan pesan "Token
//      tidak valid" -- padahal endpoint ini seharusnya tetap bisa diakses
//      sebagai guest.
//   2. Cek eligibility rating gagal (401) -- frontend (renderRatingPrompt)
//      diam-diam menyembunyikan form rating tanpa pesan error apa pun,
//      sehingga rating TIDAK PERNAH muncul walau order sudah "paid".
//
// Endpoint ini secara desain OPSIONAL (guest boleh akses), jadi token yang
// tidak valid/kadaluarsa seharusnya diperlakukan sama seperti TIDAK ADA
// token -- lanjut sebagai guest (req.user = null) -- bukan menolak
// request sepenuhnya. Ini tidak mengurangi keamanan: jwt.verify() yang
// gagal tetap berarti req.user TIDAK PERNAH diisi dari token yang tak
// terpercaya (tidak ada spoofing identitas); satu-satunya perubahan
// adalah request tetap diproses sebagai anonymous, bukan diblokir.
// Endpoint yang benar-benar WAJIB login (mis. /orders/my, admin routes)
// tetap memakai authMiddleware biasa yang tegas menolak token invalid.
module.exports = (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        req.user = null;
        return next();
    }

    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) {
        req.user = null;
        return next();
    }
    const token = match[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
    } catch (err) {
        // Token kadaluarsa/rusak/tidak valid -> perlakukan sebagai guest,
        // JANGAN blokir request (lihat penjelasan di atas).
        req.user = null;
    }
    next();
};
