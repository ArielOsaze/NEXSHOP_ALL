const crypto = require("crypto");

const PASSWORD_RESET_EXPIRY_MINUTES = 5;

function hashResetToken(token) {
    return crypto.createHash("sha256").update(String(token), "utf8").digest("hex");
}

function createPasswordResetToken(now = new Date()) {
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(now.getTime() + PASSWORD_RESET_EXPIRY_MINUTES * 60 * 1000).toISOString();
    return {
        token,
        tokenHash: hashResetToken(token),
        expiresAt
    };
}

function buildPasswordResetLink(frontendUrl, token) {
    const base = String(frontendUrl || "").replace(/\/$/, "") || "http://localhost:5500";
    return `${base}/#/reset-password?token=${encodeURIComponent(token)}`;
}

function buildPortalPasswordResetLink(frontendUrl, token) {
    const base = String(frontendUrl || "").replace(/\/$/, "") || "http://localhost:5500";
    return `${base}/portal-reseller?reset_password=1&token=${encodeURIComponent(token)}`;
}

function buildPasswordResetWhatsAppMessage({ fullname, email, resetLink }) {
    const name = String(fullname || email || "Kak").trim().slice(0, 120) || "Kak";
    return [
        "🔐 Permintaan Reset Password NexShop",
        "",
        `Halo ${name}, gunakan link unik berikut untuk membuat password baru:`,
        resetLink,
        "",
        "Link ini hanya berlaku 5 menit dan hanya dapat digunakan sekali.",
        "Jangan teruskan link ini kepada siapa pun. Jika kamu tidak meminta reset password, abaikan pesan ini dan segera amankan akunmu."
    ].join("\n");
}

function buildPortalPasswordResetWhatsAppMessage({ fullname, email, resetLink }) {
    const name = String(fullname || email || "Kak").trim().slice(0, 120) || "Kak";
    return [
        "🔐 Reset Password Partner Portal NexShop",
        "",
        `Halo ${name}, gunakan link berikut untuk membuat password Portal Reseller yang baru:`,
        resetLink,
        "",
        "Link berlaku 5 menit dan hanya dapat digunakan satu kali.",
        "Jangan teruskan link ini kepada siapa pun. Jika kamu tidak meminta reset password, abaikan pesan ini dan hubungi admin NexShop."
    ].join("\n");
}

module.exports = {
    PASSWORD_RESET_EXPIRY_MINUTES,
    hashResetToken,
    createPasswordResetToken,
    buildPasswordResetLink,
    buildPortalPasswordResetLink,
    buildPasswordResetWhatsAppMessage,
    buildPortalPasswordResetWhatsAppMessage
};
