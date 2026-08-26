const net = require("net");

function unwrapIpv6Host(host) {
    const value = String(host || "").trim();
    return value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
}

function isPrivateIpv4(host) {
    const parts = host.split(".").map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    const [a, b] = parts;
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

function isPrivateIpv6(host) {
    const lower = host.toLowerCase();
    return lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80");
}

function isLocalGatewayHost(rawHost) {
    const host = unwrapIpv6Host(rawHost).toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost")) return true;
    const version = net.isIP(host);
    return version === 4 ? isPrivateIpv4(host) : version === 6 && isPrivateIpv6(host);
}

// Provision endpoint di gateway tidak punya API key sebelum setup pertama,
// jadi hanya backend yang berjalan di VPS yang sama yang boleh memakainya.
function isStrictLoopbackGatewayHost(rawHost) {
    const host = unwrapIpv6Host(rawHost).toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

/**
 * WA gateway bukan webhook milik pihak luar. Endpoint ini sengaja dapat
 * memakai HTTP saat ditempatkan di localhost/LAN privat; gateway publik tetap
 * wajib HTTPS agar API key dan isi pesan tidak terkirim dalam teks polos.
 */
function validateWaGatewayUrlShape(rawUrl) {
    const value = String(rawUrl || "").trim();
    if (!value) return { ok: false, reason: "URL gateway WhatsApp kosong." };
    if (value.length > 500) return { ok: false, reason: "URL gateway WhatsApp terlalu panjang." };

    let parsed;
    try {
        parsed = new URL(value);
    } catch (_) {
        return { ok: false, reason: "Format URL gateway tidak valid. Contoh: http://127.0.0.1:8080" };
    }

    if (!parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) {
        return { ok: false, reason: "URL gateway tidak boleh memakai kredensial, query string, atau fragment." };
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
        return { ok: false, reason: "URL gateway harus memakai HTTP atau HTTPS." };
    }
    if (parsed.pathname !== "/") {
        return { ok: false, reason: "URL gateway harus berupa origin tanpa path tambahan." };
    }
    if (parsed.port && (!/^\d+$/.test(parsed.port) || Number(parsed.port) < 1 || Number(parsed.port) > 65535)) {
        return { ok: false, reason: "Port gateway tidak valid." };
    }
    if (parsed.protocol === "http:" && !isLocalGatewayHost(parsed.hostname)) {
        return { ok: false, reason: "Gateway yang berada di host publik wajib memakai HTTPS. HTTP hanya boleh untuk localhost atau IP privat." };
    }
    return { ok: true, url: parsed.origin };
}

module.exports = { validateWaGatewayUrlShape, isLocalGatewayHost, isStrictLoopbackGatewayHost };
