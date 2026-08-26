const net = require("net");

function resolveUserDisplayName(user = {}) {
    const fullname = typeof user.fullname === "string" ? user.fullname.trim() : "";
    const genericNames = new Set(["pelanggan", "customer", "pengguna", "pengguna nexshop", "kak", "-"]);
    if (fullname && !genericNames.has(fullname.toLowerCase()) && !/^(player|user|pelanggan)\b/i.test(fullname)) return fullname.slice(0, 100);

    const email = typeof user.email === "string" ? user.email.trim() : "";
    const localPart = email.split("@", 1)[0].trim();
    return localPart || "Pengguna NexShop";
}

function formatWibTimestamp(date = new Date()) {
    const parts = new Intl.DateTimeFormat("id-ID", {
        timeZone: "Asia/Jakarta",
        day: "2-digit",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.day} ${values.month} ${values.year} ${values.hour}:${values.minute}:${values.second} WIB`;
}

function describeUserAgent(userAgent = "") {
    const value = String(userAgent || "");
    let browser = "Browser tidak dikenal";
    if (/Edg\//i.test(value)) browser = "Microsoft Edge";
    else if (/OPR\//i.test(value)) browser = "Opera";
    else if (/Chrome\//i.test(value)) browser = "Google Chrome";
    else if (/Firefox\//i.test(value)) browser = "Mozilla Firefox";
    else if (/Safari\//i.test(value)) browser = "Safari";

    let os = "perangkat tidak dikenal";
    if (/Windows NT/i.test(value)) os = "Windows";
    else if (/Android/i.test(value)) os = "Android";
    else if (/(iPhone|iPad|iPod)/i.test(value)) os = "iOS";
    else if (/Mac OS X/i.test(value)) os = "macOS";
    else if (/Linux/i.test(value)) os = "Linux";

    return `${browser} (${os})`;
}

function buildLoginSecurityMessage({ user, timestamp, ip, location, userAgent, resetUrl }) {
    const name = resolveUserDisplayName(user);
    const safeLocation = String(location || "Lokasi tidak terdeteksi").slice(0, 160);
    const safeIp = String(ip || "tidak tersedia").slice(0, 80);
    const device = describeUserAgent(userAgent);
    const role = String(user?.role || "").trim().toLowerCase();
    const isAdminLogin = role === "admin" || role === "staff";
    const roleLabel = role === "staff" ? "Staff" : "Admin";
    const safeEmail = String(user?.email || "tidak tersedia").trim().slice(0, 160);
    const adminTitle = role === "staff" ? "🔐 *Peringatan Login Staff NexShop*" : "🔐 *Peringatan Login Admin NexShop*";
    const intro = isAdminLogin
        ? `Halo ${name}, akses dashboard ${role === "staff" ? "staff" : "admin"} NexShop baru saja berhasil digunakan.`
        : `Halo ${name}, akun NexShop kamu baru saja login.`;

    return [
        isAdminLogin ? adminTitle : "🔐 *Peringatan Login NexShop*",
        "",
        intro,
        ...(isAdminLogin ? [`Nama: ${name}`, `Email: ${safeEmail}`, `Peran: ${roleLabel}`, "Dashboard: https://nexshop.cloud/admin/dashboard"] : []),
        `Waktu: ${formatWibTimestamp(timestamp)}`,
        `Lokasi perkiraan: ${safeLocation}`,
        `IP: ${safeIp}`,
        `Perangkat: ${device}`,
        "",
        "Jika ini Anda, abaikan pesan ini.",
        "Jika ini bukan Anda, segera reset password melalui link berikut:",
        String(resetUrl || "https://nexshop.cloud/#/forgot-password"),
        "",
        "Jangan berikan password atau OTP kepada siapa pun."
    ].join("\n");
}

function getClientIp(req = {}) {
    const forwarded = String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
    return forwarded || String(req.ip || req.socket?.remoteAddress || "").replace(/^::ffff:/, "") || "tidak tersedia";
}

function isPublicIp(ip) {
    if (!net.isIP(ip)) return false;
    if (ip === "127.0.0.1" || ip === "::1" || ip.startsWith("10.") || ip.startsWith("192.168.") || ip.startsWith("169.254.")) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return false;
    if (ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80:")) return false;
    return true;
}

async function lookupIpLocation(ip, fetchImpl = global.fetch) {
    if (!isPublicIp(ip) || typeof fetchImpl !== "function") return "Lokasi jaringan lokal/tidak tersedia";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    try {
        const response = await fetchImpl(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, { signal: controller.signal });
        if (!response.ok) return "Lokasi tidak terdeteksi";
        const data = await response.json();
        const parts = [data.city, data.region, data.country_name].filter((value) => typeof value === "string" && value.trim());
        return parts.length ? parts.join(", ").slice(0, 160) : "Lokasi tidak terdeteksi";
    } catch (_) {
        return "Lokasi tidak terdeteksi";
    } finally {
        clearTimeout(timer);
    }
}

module.exports = {
    resolveUserDisplayName,
    formatWibTimestamp,
    describeUserAgent,
    buildLoginSecurityMessage,
    getClientIp,
    lookupIpLocation,
    isPublicIp
};
