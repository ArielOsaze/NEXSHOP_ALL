const supabase = require("../config/db");
const { sendUserSecurityWhatsApp } = require("./userWhatsAppService");
const {
    buildLoginSecurityMessage,
    getClientIp,
    lookupIpLocation
} = require("./userNotificationHelpers");
const {
    createPasswordResetToken,
    buildPasswordResetLink
} = require("./passwordResetService");

const FRONTEND_URL = (process.env.FRONTEND_URL || "https://nexshop.cloud").replace(/\/$/, "");

function resolveLoginContext(user, req, explicitContext) {
    const requested = String(explicitContext || req?.body?.login_context || "").trim().toLowerCase();
    if (requested === "admin") return "admin";
    // Role tidak boleh menentukan template: admin/staff juga bisa login ke web utama.
    return "user";
}

async function sendLoginSecurityNotification(user, req, options = {}) {
    const phone = user?.phone || user?.phone_normalized;
    if (!user || !phone) return { success: false, reason: "missing_user_phone" };

    const resetToken = createPasswordResetToken();
    const { error: tokenError } = await supabase
        .from("users")
        .update({
            reset_password_token: resetToken.tokenHash,
            reset_password_expires_at: resetToken.expiresAt
        })
        .eq("id", user.id);
    if (tokenError) {
        console.log("Gagal menyimpan token reset dari login alert:", tokenError.message);
        return { success: false, reason: "reset_token_storage_failed" };
    }

    const loginContext = resolveLoginContext(user, req, options.loginContext);
    const ip = getClientIp(req);
    const location = await lookupIpLocation(ip);
    const resetUrl = buildPasswordResetLink(FRONTEND_URL, resetToken.token);
    const message = buildLoginSecurityMessage({
        user,
        loginContext,
        timestamp: new Date(),
        ip,
        location,
        userAgent: req.get?.("user-agent") || req.headers?.["user-agent"] || "",
        resetUrl
    });

    return sendUserSecurityWhatsApp(phone, message);
}

module.exports = { sendLoginSecurityNotification };
