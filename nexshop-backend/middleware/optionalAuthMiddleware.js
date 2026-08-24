const jwt = require("jsonwebtoken");

/**
 * Autentikasi opsional untuk halaman publik dan checkout web.
 *
 * Middleware ini sengaja HANYA menerima JWT sesi web. API Key reseller
 * mempunyai jalur terpisah di /api/v1/reseller yang mewajibkan pasangan
 * API Key + Secret Key dan memotong saldo deposit. Menerima API Key di
 * endpoint checkout publik akan membuka jalur alternatif untuk memperoleh
 * harga reseller tanpa kontrak keamanan dan debit saldo Open API.
 */
module.exports = (req, res, next) => {
    const authHeader = String(req.headers.authorization || "");
    const match = authHeader.match(/^Bearer\s+(.+)$/i);

    req.user = null;
    if (!match) return next();

    const token = match[1].trim();

    // Prefix API Key tidak pernah diperlakukan sebagai sesi web. Klien API
    // harus memakai endpoint /api/v1/reseller dengan Secret Key yang wajib.
    if (!token || token.startsWith("nx_live_")) return next();

    if (!process.env.JWT_SECRET) return next();

    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
    } catch (_) {
        req.user = null;
    }

    return next();
};
