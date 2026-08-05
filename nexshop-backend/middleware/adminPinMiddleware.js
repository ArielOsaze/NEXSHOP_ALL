const jwt = require("jsonwebtoken");

const PIN_TOKEN_TTL = "10m";

function pinSecret() {
    return `${process.env.JWT_SECRET || ""}:admin-security-pin`;
}

function issueAdminPinToken(user) {
    return jwt.sign(
        { id: user.id, role: user.role, scope: "admin-security-pin" },
        pinSecret(),
        { expiresIn: PIN_TOKEN_TTL }
    );
}

function requireAdminPin(req, res, next) {
    const token = req.get("X-Admin-Pin-Token");
    if (!token) return res.status(428).json({ message: "Verifikasi PIN Keamanan Admin diperlukan", code: "ADMIN_PIN_REQUIRED" });
    try {
        const payload = jwt.verify(token, pinSecret());
        if (payload.scope !== "admin-security-pin" || String(payload.id) !== String(req.user.id) || payload.role !== "admin") {
            return res.status(403).json({ message: "Verifikasi PIN Keamanan Admin tidak valid", code: "ADMIN_PIN_INVALID" });
        }
        req.adminPinVerified = true;
        next();
    } catch (err) {
        return res.status(428).json({ message: "Verifikasi PIN Keamanan Admin telah berakhir. Masukkan PIN kembali.", code: "ADMIN_PIN_EXPIRED" });
    }
}

module.exports = { issueAdminPinToken, requireAdminPin };
