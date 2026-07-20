const jwt = require("jsonwebtoken");

// Beda sama authMiddleware biasa: kalau TIDAK ada token, tetap lanjut
// (req.user = null) — dipakai buat endpoint yang boleh diakses guest
// maupun user login (misal checkout tanpa akun).
// Kalau ADA token tapi ternyata tidak valid/kadaluarsa, tetap ditolak
// (biar gak ada yang pura-pura login pakai token palsu).
module.exports = (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        req.user = null;
        return next();
    }

    const token = authHeader.split(" ")[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ message: "Token tidak valid" });
    }
};
