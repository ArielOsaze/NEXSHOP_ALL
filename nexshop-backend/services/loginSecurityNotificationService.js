const { sendUserSecurityWhatsApp } = require("./userWhatsAppService");
const {
    buildLoginSecurityMessage,
    getClientIp,
    lookupIpLocation
} = require("./userNotificationHelpers");

const FRONTEND_URL = (process.env.FRONTEND_URL || "https://nexshop.cloud").replace(/\/$/, "");

function resolveLoginContext(user, req, explicitContext) {
    const requested = String(explicitContext || req?.body?.login_context || "").trim().toLowerCase();
    if (requested === "admin") return "admin";
    // Role tidak boleh menentukan template: admin/staff juga bisa login ke web utama.
    return "user";
}

async function sendLoginSecurityNotification(user, req, options = {}) {
    if (!user || !user.phone) return { success: false, reason: "missing_user_phone" };

    const loginContext = resolveLoginContext(user, req, options.loginContext);
    const ip = getClientIp(req);
    const location = await lookupIpLocation(ip);
    const message = buildLoginSecurityMessage({
        user,
        loginContext,
        timestamp: new Date(),
        ip,
        location,
        userAgent: req.get?.("user-agent") || req.headers?.["user-agent"] || "",
        resetUrl: `${FRONTEND_URL}/#/forgot-password`
    });

    return sendUserSecurityWhatsApp(user.phone, message);
}

module.exports = { sendLoginSecurityNotification };
