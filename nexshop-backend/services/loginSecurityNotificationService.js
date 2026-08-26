const { sendUserSecurityWhatsApp } = require("./userWhatsAppService");
const {
    buildLoginSecurityMessage,
    getClientIp,
    lookupIpLocation
} = require("./userNotificationHelpers");

const FRONTEND_URL = (process.env.FRONTEND_URL || "https://nexshop.cloud").replace(/\/$/, "");

async function sendLoginSecurityNotification(user, req) {
    if (!user || !user.phone) return { success: false, reason: "missing_user_phone" };

    const ip = getClientIp(req);
    const location = await lookupIpLocation(ip);
    const message = buildLoginSecurityMessage({
        user,
        timestamp: new Date(),
        ip,
        location,
        userAgent: req.get?.("user-agent") || req.headers?.["user-agent"] || "",
        resetUrl: `${FRONTEND_URL}/#/forgot-password`
    });

    return sendUserSecurityWhatsApp(user.phone, message);
}

module.exports = { sendLoginSecurityNotification };
