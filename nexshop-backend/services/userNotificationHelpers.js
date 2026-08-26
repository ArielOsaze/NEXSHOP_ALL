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

function safeNotificationField(value, fallback = "tidak tersedia", maxLength = 140) {
    const text = String(value ?? "").replace(/[\r\n]+/g, " ").trim();
    return text ? text.slice(0, maxLength) : fallback;
}

function validCoordinate(value) {
    const number = Number(value);
    return Number.isFinite(number) && Math.abs(number) <= 180 ? number : null;
}

function formatLocationDetails(location) {
    if (typeof location === "string") {
        return [`Lokasi IP (perkiraan): ${safeNotificationField(location)}`];
    }
    if (!location || location.available === false) {
        return ["Lokasi IP: Tidak berhasil dipetakan dari IP ini."];
    }

    const city = safeNotificationField(location.city);
    const region = safeNotificationField(location.region);
    const country = safeNotificationField(location.country);
    const countryCode = location.countryCode ? ` (${safeNotificationField(location.countryCode, "", 8)})` : "";
    const coordinates = [location.latitude, location.longitude].every((value) => Number.isFinite(Number(value)))
        ? `${Number(location.latitude)}, ${Number(location.longitude)}`
        : "tidak tersedia";
    const lines = [
        "Lokasi IP (perkiraan):",
        `Kota: ${city}`,
        `Wilayah: ${region}`,
        `Negara: ${country}${countryCode}`,
        `Kode pos: ${safeNotificationField(location.postal)}`,
        `Koordinat perkiraan: ${coordinates}`
    ];
    if (location.mapUrl) lines.push(`Peta: ${safeNotificationField(location.mapUrl, "", 240)}`);
    lines.push(`ISP: ${safeNotificationField(location.isp)}`);
    lines.push(`Organisasi: ${safeNotificationField(location.organization)}`);
    lines.push(`ASN: ${safeNotificationField(location.asn)}`);
    lines.push(`Domain jaringan: ${safeNotificationField(location.domain)}`);
    lines.push(`Zona waktu: ${safeNotificationField(location.timezone)}${location.timezoneUtc ? ` (${safeNotificationField(location.timezoneUtc, "", 12)})` : ""}`);
    lines.push("Catatan: lokasi berbasis geolokasi IP, bukan GPS presisi; VPN, proxy, dan jaringan seluler dapat membuatnya meleset.");
    return lines;
}

function buildLoginSecurityMessage({ user, loginContext = "user", timestamp, ip, location, userAgent, resetUrl }) {
    const name = resolveUserDisplayName(user);
    const safeIp = safeNotificationField(ip, "tidak tersedia", 80);
    const device = describeUserAgent(userAgent);
    const role = String(user?.role || "").trim().toLowerCase();
    const isAdminDashboardLogin = loginContext === "admin";
    const roleLabel = role === "staff" ? "Staff" : role === "admin" ? "Admin" : "Pengguna";
    const safeEmail = safeNotificationField(user?.email, "tidak tersedia", 160);
    const dashboardTitle = role === "staff" ? "🔐 *Peringatan Login Dashboard Staff NexShop*" : "🔐 *Peringatan Login Dashboard Admin NexShop*";
    const intro = isAdminDashboardLogin
        ? `Halo ${name}, dashboard ${role === "staff" ? "staff" : "admin"} NexShop baru saja berhasil digunakan.`
        : `Halo ${name}, web utama NexShop baru saja menerima login akun kamu.`;

    return [
        isAdminDashboardLogin ? dashboardTitle : "🔐 *Peringatan Login Web Utama NexShop*",
        "",
        intro,
        `Konteks: ${isAdminDashboardLogin ? "Dashboard Admin NexShop" : "Web utama NexShop"}`,
        `Nama: ${name}`,
        `Email: ${safeEmail}`,
        `Peran: ${roleLabel}`,
        ...(isAdminDashboardLogin ? ["Dashboard: https://nexshop.cloud/admin/dashboard"] : []),
        `Waktu: ${formatWibTimestamp(timestamp)}`,
        ...formatLocationDetails(location),
        `IP: ${safeIp}`,
        `Perangkat: ${device}`,
        "",
        "Jika ini Anda, abaikan pesan ini.",
        "Jika ini bukan Anda, segera reset password melalui link berikut:",
        String(resetUrl || "Link reset aman tidak tersedia."),
        "",
        "Jangan berikan password atau OTP kepada siapa pun."
    ].join("\n");
}

function cleanClientIp(value) {
    return String(value || "").trim().replace(/^::ffff:/, "");
}

function getClientIp(req = {}) {
    // Express sudah memvalidasi satu lapis Nginx melalui trust proxy di server.js.
    // Jangan memakai X-Forwarded-For mentah karena header itu dapat dipalsukan client.
    return cleanClientIp(req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress) || "tidak tersedia";
}

function isPublicIp(ip) {
    if (!net.isIP(ip)) return false;
    if (ip === "127.0.0.1" || ip === "::1" || ip.startsWith("10.") || ip.startsWith("192.168.") || ip.startsWith("169.254.")) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return false;
    if (ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80:")) return false;
    return true;
}

function normalizeIpLocation(data, source) {
    if (!data || data.success === false || data.status === "fail") return null;
    const connection = data.connection || {};
    const latitude = validCoordinate(data.latitude);
    const longitude = validCoordinate(data.longitude);
    const country = data.country || data.country_name;
    const countryCode = data.country_code || data.countryCode;
    const timezone = typeof data.timezone === "string" ? data.timezone : data.timezone?.id;
    const timezoneUtc = typeof data.timezone === "object" ? data.timezone.utc : data.utc_offset;
    const asnRaw = connection.asn || data.asn;
    const asn = asnRaw ? (String(asnRaw).toUpperCase().startsWith("AS") ? String(asnRaw).toUpperCase() : `AS${asnRaw}`) : "";
    if (!data.city && !data.region && !country && latitude === null && longitude === null) return null;
    return {
        available: true,
        source,
        city: data.city,
        region: data.region,
        country,
        countryCode,
        postal: data.postal,
        latitude,
        longitude,
        mapUrl: latitude !== null && longitude !== null ? `https://www.google.com/maps?q=${latitude},${longitude}` : "",
        isp: connection.isp || data.org,
        organization: connection.org || data.org,
        asn,
        domain: connection.domain,
        timezone,
        timezoneUtc
    };
}

async function lookupIpLocation(ip, fetchImpl = global.fetch) {
    if (!isPublicIp(ip) || typeof fetchImpl !== "function") return "Lokasi jaringan lokal/tidak tersedia";
    const providers = [
        [`https://ipwho.is/${encodeURIComponent(ip)}`, "ipwho.is"],
        [`https://ipapi.co/${encodeURIComponent(ip)}/json/`, "ipapi.co"]
    ];
    for (const [url, source] of providers) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 1500);
        try {
            const response = await fetchImpl(url, {
                signal: controller.signal,
                headers: { "User-Agent": "NexShop-Security-Alert/1.0" }
            });
            if (!response.ok) continue;
            const location = normalizeIpLocation(await response.json(), source);
            if (location) return location;
        } catch (_) {
            // Provider geolocation tidak boleh menggagalkan login/notifikasi.
        } finally {
            clearTimeout(timer);
        }
    }
    return { available: false };
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
