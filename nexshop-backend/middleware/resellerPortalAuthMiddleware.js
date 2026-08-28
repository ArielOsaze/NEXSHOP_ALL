const jwt = require("jsonwebtoken");

// Portal Reseller memiliki namespace token sendiri. JWT customer/admin biasa
// tidak boleh dipakai untuk membuka endpoint pengajuan atau konsol partner.
module.exports = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ message: "Token Portal Reseller tidak ditemukan", code: "PORTAL_TOKEN_REQUIRED" });
    }

    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) {
        return res.status(401).json({ message: "Format token Portal Reseller tidak valid", code: "PORTAL_TOKEN_INVALID" });
    }

    try {
        const decoded = jwt.verify(match[1], process.env.JWT_SECRET);
        if (decoded.auth_context !== "reseller_portal" || !decoded.portal_account_id || !decoded.id) {
            return res.status(403).json({
                message: "Sesi akun belanja tidak berlaku untuk Partner Portal. Gunakan akun Portal Reseller terpisah.",
                code: "PORTAL_ACCOUNT_REQUIRED"
            });
        }
        req.user = decoded;
        next();
    } catch (_) {
        return res.status(401).json({ message: "Token Portal Reseller tidak valid", code: "PORTAL_TOKEN_INVALID" });
    }
};
