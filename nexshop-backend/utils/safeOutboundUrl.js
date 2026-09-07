const dns = require("dns").promises;
const net = require("net");

// ===========================================================
// VALIDATOR URL KELUAR (ANTI-SSRF)
//
// Dipakai untuk semua URL yang DITENTUKAN OLEH PENGGUNA lalu di-request
// oleh server kita sendiri -- saat ini: Webhook URL milik reseller
// (portal reseller) dan Webhook Relay.
//
// Kenapa perlu: server NexShop berada di dalam jaringan yang bisa
// menjangkau alamat yang tidak bisa dijangkau internet -- localhost,
// database internal, dan endpoint metadata cloud (169.254.169.254) yang
// pada banyak provider membocorkan kredensial IAM. Tanpa validasi, mitra
// reseller cukup menyimpan `http://169.254.169.254/latest/meta-data/...`
// sebagai Webhook URL lalu menekan tombol "Tes Webhook" untuk membuat
// server kita mengambil isinya -- dan versi lama endpoint tes itu
// mengembalikan body responsnya bulat-bulat ke pemanggil.
//
// Aturan yang ditegakkan:
// 1. Skema wajib https (http hanya diizinkan kalau ALLOW_INSECURE_WEBHOOK=1,
//    untuk keperluan development lokal).
// 2. Tanpa userinfo (https://user:pass@host) -- sering dipakai untuk
//    mengelabui parser dan mengaburkan host tujuan.
// 3. Port dibatasi ke 80/443 saja.
// 4. Hostname di-resolve, lalu SEMUA IP hasil resolusi harus publik.
//    Loopback, private range, link-local, CGNAT, multicast, dan reserved
//    ditolak -- termasuk kalau hostname publik sengaja diarahkan ke IP
//    internal (DNS rebinding tahap pertama).
// ===========================================================

const ALLOW_INSECURE = process.env.ALLOW_INSECURE_WEBHOOK === "1";
const ALLOWED_PORTS = new Set(["", "80", "443"]);

function ipv4ToParts(ip) {
    return ip.split(".").map((n) => parseInt(n, 10));
}

// Blok IPv4 yang tidak boleh jadi tujuan request server.
function isPrivateIPv4(ip) {
    const [a, b] = ipv4ToParts(ip);
    if (Number.isNaN(a) || Number.isNaN(b)) return true;
    if (a === 0) return true;                          // 0.0.0.0/8 "this network"
    if (a === 10) return true;                         // private
    if (a === 127) return true;                        // loopback
    if (a === 169 && b === 254) return true;           // link-local + metadata cloud
    if (a === 172 && b >= 16 && b <= 31) return true;  // private
    if (a === 192 && b === 168) return true;           // private
    if (a === 192 && b === 0) return true;             // IETF protocol assignments
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a >= 224) return true;                         // multicast + reserved + broadcast
    return false;
}

function parseIPv6ToBigInt(rawIp) {
    let ip = String(rawIp || "").toLowerCase();
    if (!ip || ip.includes("%")) return null;

    // Normalize an embedded dotted IPv4 tail to two hexadecimal groups.
    const lastColon = ip.lastIndexOf(":");
    const dottedTail = ip.slice(lastColon + 1);
    if (dottedTail.includes(".")) {
        const parts = dottedTail.split(".").map((part) => Number(part));
        if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
        const high = ((parts[0] << 8) | parts[1]).toString(16);
        const low = ((parts[2] << 8) | parts[3]).toString(16);
        ip = `${ip.slice(0, lastColon + 1)}${high}:${low}`;
    }

    const halves = ip.split("::");
    if (halves.length > 2) return null;
    const left = halves[0] ? halves[0].split(":") : [];
    const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
    if (left.concat(right).some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;

    const missing = halves.length === 2 ? 8 - left.length - right.length : 0;
    if (missing < 0 || (halves.length === 1 && left.length !== 8)) return null;
    const groups = left.concat(Array(missing).fill("0"), right);
    if (groups.length !== 8) return null;
    return groups.reduce((value, group) => (value << 16n) | BigInt(parseInt(group, 16)), 0n);
}

function isPrivateIPv6(ip) {
    const value = parseIPv6ToBigInt(ip);
    if (value === null) return true;

    // Unspecified and loopback.
    if (value === 0n || value === 1n) return true;

    // IPv4-mapped IPv6 (::ffff:0:0/96), including hexadecimal tails.
    if ((value >> 32n) === 0xffffn) {
        const ipv4 = Number(value & 0xffffffffn);
        const dotted = `${ipv4 >>> 24}.${(ipv4 >>> 16) & 255}.${(ipv4 >>> 8) & 255}.${ipv4 & 255}`;
        return isPrivateIPv4(dotted);
    }

    // IPv4-compatible/reserved ::/96 representations are not public targets.
    if ((value >> 32n) === 0n) return true;

    // Link-local fe80::/10, unique-local fc00::/7, multicast ff00::/8.
    if ((value >> 118n) === 0b1111111010n) return true;
    if ((value >> 121n) === 0b1111110n) return true;
    if ((value >> 120n) === 0xffn) return true;

    // Documentation, benchmarking, and deprecated site-local ranges.
    if ((value >> 96n) === 0x20010db8n) return true;
    if ((value >> 118n) === 0b1111111011n) return true;

    return false;
}

// URL.hostname mengembalikan literal IPv6 MASIH berkurung siku
// ("[::1]"), dan net.isIP() tidak mengenali bentuk itu -- tanpa ini
// https://[::1]/hook lolos validasi karena dianggap "nama domain biasa".
function unwrapHost(host) {
    const value = String(host || "").trim();
    if (value.startsWith("[") && value.endsWith("]")) return value.slice(1, -1);
    return value;
}

function isPrivateIp(rawIp) {
    const ip = unwrapHost(rawIp);
    const version = net.isIP(ip);
    if (version === 4) return isPrivateIPv4(ip);
    if (version === 6) return isPrivateIPv6(ip);
    return true; // bukan IP yang dikenali -> tolak
}

/**
 * Validasi bentuk URL saja (sinkron, tanpa DNS).
 * Dipakai saat menyimpan pengaturan supaya feedback-nya instan.
 *
 * @returns {{ok: true, url: string} | {ok: false, reason: string}}
 */
function validateWebhookUrlShape(rawUrl) {
    const value = String(rawUrl || "").trim();
    if (!value) return { ok: false, reason: "URL webhook kosong." };
    if (value.length > 500) return { ok: false, reason: "URL webhook terlalu panjang (maksimal 500 karakter)." };

    let parsed;
    try {
        parsed = new URL(value);
    } catch (_) {
        return { ok: false, reason: "Format URL tidak valid. Contoh yang benar: https://toko-kamu.com/webhook/nexshop" };
    }

    const scheme = parsed.protocol.replace(":", "");
    if (scheme !== "https" && !(scheme === "http" && ALLOW_INSECURE)) {
        return { ok: false, reason: "URL webhook wajib memakai HTTPS. Endpoint HTTP polos ditolak karena payload transaksi dikirim melewatinya." };
    }
    if (parsed.username || parsed.password) {
        return { ok: false, reason: "URL webhook tidak boleh memuat username/password (format https://user:pass@host)." };
    }
    if (!ALLOWED_PORTS.has(parsed.port)) {
        return { ok: false, reason: "Port webhook hanya boleh 80 atau 443." };
    }
    if (!parsed.hostname) {
        return { ok: false, reason: "Hostname pada URL webhook tidak terbaca." };
    }
    // Hostname yang SUDAH berupa IP privat langsung ditolak tanpa perlu DNS.
    const bareHost = unwrapHost(parsed.hostname);
    if (net.isIP(bareHost) && isPrivateIp(bareHost)) {
        return { ok: false, reason: "URL webhook tidak boleh mengarah ke alamat IP internal/privat." };
    }
    const host = bareHost.toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
        return { ok: false, reason: "URL webhook tidak boleh mengarah ke host internal." };
    }

    return { ok: true, url: parsed.toString() };
}

/**
 * Validasi penuh: bentuk URL + resolusi DNS harus mendarat di IP publik.
 * Dipakai tepat sebelum request benar-benar dikirim.
 *
 * @returns {Promise<{ok: true, url: string, addresses: string[]} | {ok: false, reason: string}>}
 */
async function assertSafeOutboundUrl(rawUrl) {
    const shape = validateWebhookUrlShape(rawUrl);
    if (!shape.ok) return shape;

    const hostname = unwrapHost(new URL(shape.url).hostname);

    if (net.isIP(hostname)) {
        return { ok: true, url: shape.url, addresses: [hostname] };
    }

    let addresses;
    try {
        const records = await dns.lookup(hostname, { all: true });
        addresses = records.map((r) => r.address);
    } catch (_) {
        return { ok: false, reason: "Domain webhook tidak dapat di-resolve. Pastikan DNS-nya sudah aktif." };
    }

    if (!addresses.length) {
        return { ok: false, reason: "Domain webhook tidak memiliki alamat IP." };
    }
    // SEMUA hasil resolusi harus publik. Satu saja privat -> tolak, supaya
    // domain yang punya A-record ganda (satu publik, satu internal) tidak
    // bisa dipakai untuk menembak jaringan dalam.
    const blocked = addresses.filter((ip) => isPrivateIp(ip));
    if (blocked.length) {
        return { ok: false, reason: "Domain webhook mengarah ke alamat internal/privat (" + blocked.join(", ") + "). Gunakan domain publik." };
    }

    return { ok: true, url: shape.url, addresses };
}

module.exports = {
    validateWebhookUrlShape,
    unwrapHost,
    assertSafeOutboundUrl,
    isPrivateIp
};
