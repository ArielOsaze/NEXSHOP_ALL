const jwt = require("jsonwebtoken");
const supabase = require("../config/db");
const { isMissingTableError } = require("../services/resellerService");

// Portal Reseller memiliki namespace token sendiri. JWT customer/admin biasa
// tidak boleh dipakai untuk membuka endpoint pengajuan atau konsol partner.
module.exports = async (req, res, next) => {
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

        // Signature-valid is not enough: a token can outlive a portal-account
        // deletion, scope change, or suspension. Re-bind every request to the
        // currently registered Portal account and its owner.
        const [{ data: portalAccount, error: portalError }, { data: owner, error: ownerError }] = await Promise.all([
            supabase.from("reseller_portal_accounts").select("id,user_id,status").eq("id", decoded.portal_account_id).eq("user_id", decoded.id).maybeSingle(),
            supabase.from("users").select("id,account_scope").eq("id", decoded.id).maybeSingle()
        ]);
        if (portalError || ownerError) {
            const error = portalError || ownerError;
            if (isMissingTableError(error)) {
                return res.status(503).json({ message: "Portal Reseller belum selesai dikonfigurasi.", code: "PORTAL_ACCOUNT_STORE_UNAVAILABLE" });
            }
            return res.status(503).json({ message: "Identity Portal Reseller belum dapat diverifikasi.", code: "PORTAL_IDENTITY_UNAVAILABLE" });
        }
        if (!portalAccount || !owner || owner.account_scope !== "portal_only") {
            return res.status(403).json({ message: "Akun Portal Reseller terdaftar diperlukan. Akun belanja tidak dapat membuka portal.", code: "PORTAL_ACCOUNT_REQUIRED" });
        }
        if (["suspended", "disabled", "rejected"].includes(String(portalAccount.status || "").toLowerCase())) {
            return res.status(403).json({ message: "Akun Portal Reseller tidak aktif.", code: "PORTAL_ACCOUNT_INACTIVE" });
        }

        if (decoded.two_factor_verified === true) {
            req.user = decoded;
            return next();
        }
        // diperiksa terhadap status factor di database sebelum diterima.
        const { data: factor, error } = await supabase
            .from("reseller_portal_2fa")
            .select("enabled")
            .eq("portal_account_id", decoded.portal_account_id)
            .maybeSingle();
        if (error && !isMissingTableError(error)) {
            return res.status(503).json({ message: "Status keamanan Portal Reseller belum dapat diverifikasi.", code: "PORTAL_2FA_STATUS_UNAVAILABLE" });
        }
        if (factor?.enabled && decoded.two_factor_verified !== true) {
            return res.status(401).json({ message: "Verifikasi 2FA diperlukan untuk melanjutkan.", code: "PORTAL_2FA_REQUIRED" });
        }

        req.user = decoded;
        return next();
    } catch (_) {
        return res.status(401).json({ message: "Token Portal Reseller tidak valid", code: "PORTAL_TOKEN_INVALID" });
    }
};
