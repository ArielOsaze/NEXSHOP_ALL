const bcrypt = require("bcrypt");
const supabase = require("../config/db");

function isValidSecurityPin(value) {
    return typeof value === "string" && /^\d{6}$/.test(value);
}

async function logSensitiveAction(req, action, details = {}) {
    try {
        await supabase.from("admin_security_audit_logs").insert([{
            admin_id: req.user.id,
            admin_email: req.user.email,
            admin_username: req.user.fullname || req.user.email,
            ip_address: req.ip || "",
            user_agent: String(req.get("user-agent") || "").slice(0, 500),
            action,
            details
        }]);
    } catch (err) {
        // Audit tidak boleh menjatuhkan operasi utama, tetapi kegagalan tetap terlihat di log server.
        console.error("Admin security audit log error:", err.message);
    }
}

async function verifyAdminPin(req, pin) {
    if (!isValidSecurityPin(pin)) return { ok: false, status: 400, message: "Masukkan Security PIN 6 digit yang valid" };
    try {
        const { data: user, error } = await supabase.from("users").select("security_pin_hash").eq("id", req.user.id).maybeSingle();
        if (error) return { ok: false, status: 500, message: "Schema Security PIN belum tersedia. Jalankan migration Security PIN terbaru." };
        if (!user || !user.security_pin_hash) return { ok: false, status: 428, message: "Security PIN belum dibuat", code: "ADMIN_PIN_SETUP_REQUIRED" };
        if (!await bcrypt.compare(pin, user.security_pin_hash)) {
            await logSensitiveAction(req, "PIN_VERIFICATION_FAILED");
            return { ok: false, status: 401, message: "Security PIN tidak sesuai" };
        }
        await logSensitiveAction(req, "PIN_VERIFIED");
        return { ok: true };
    } catch (err) {
        return { ok: false, status: 500, message: "Server gagal memverifikasi Security PIN Admin" };
    }
}

async function requireAdminPin(req, res, next) {
    const checked = await verifyAdminPin(req, req.body && req.body.security_pin);
    if (!checked.ok) {
        res.set("X-Admin-Pin-Error", "1");
        return res.status(checked.status).json({ message: checked.message, code: checked.code });
    }
    req.adminPinVerified = true;
    next();
}

module.exports = { isValidSecurityPin, verifyAdminPin, requireAdminPin, logSensitiveAction };
