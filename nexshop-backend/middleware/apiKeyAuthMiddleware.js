const supabase = require("../config/db");
const jwt = require("jsonwebtoken");
const { isMissingTableError } = require("../services/resellerService");

const JWT_SECRET = process.env.JWT_SECRET || "nexshop-secret-jwt-key-2026";

function cleanIp(rawIp) {
    if (!rawIp) return "";
    let ip = String(rawIp).trim();
    if (ip.startsWith("::ffff:")) ip = ip.slice(7);
    if (ip === "::1") ip = "127.0.0.1";
    return ip;
}

function getClientIp(req) {
    const forwarded = req.headers["x-forwarded-for"];
    if (forwarded) {
        const first = forwarded.split(",")[0].trim();
        if (first) return cleanIp(first);
    }
    const cfIp = req.headers["cf-connecting-ip"];
    if (cfIp) return cleanIp(cfIp);
    const realIp = req.headers["x-real-ip"];
    if (realIp) return cleanIp(realIp);
    return cleanIp(req.ip || req.connection?.remoteAddress || "");
}

/**
 * Middleware Autentikasi Fleksibel:
 * Mendukung:
 * 1. Header API Key Reseller: X-NexShop-Api-Key & X-NexShop-Secret
 * 2. Header Authorization: Bearer <api_key> (jika diawali nx_live_)
 * 3. Header Authorization: Bearer <jwt_token> (standar login web)
 * 
 * Jika API Key digunakan:
 * - Memeriksa IP Whitelist (jika dikonfigurasi oleh reseller)
 * - Memastikan akun reseller berstatus 'approved'
 * - Menghitung request usage counter
 */
async function apiKeyAuthMiddleware(req, res, next) {
    const headerApiKey = req.headers["x-nexshop-api-key"] || req.headers["x-api-key"];
    const headerSecret = req.headers["x-nexshop-secret"] || req.headers["x-api-secret"];
    const authHeader = req.headers["authorization"] || "";

    let bearerToken = "";
    if (authHeader.startsWith("Bearer ")) {
        bearerToken = authHeader.slice(7).trim();
    }

    // 1. Kasus API Key terdeteksi
    const targetApiKey = (headerApiKey ? String(headerApiKey).trim() : "") || (bearerToken.startsWith("nx_live_") ? bearerToken : "");

    if (targetApiKey) {
        try {
            const { data: keyRecord, error } = await supabase
                .from("reseller_api_keys")
                .select("id, user_id, api_key, secret_key, ip_whitelist, is_active, total_requests")
                .eq("api_key", targetApiKey)
                .maybeSingle();

            if (error) {
                if (isMissingTableError(error)) {
                    return res.status(503).json({
                        message: "Fitur API Key Reseller belum di-setup di database. Jalankan migration 010_create_reseller_api_and_kyc.sql.",
                        code: "API_KEY_NOT_SETUP"
                    });
                }
                throw error;
            }

            if (!keyRecord || !keyRecord.is_active) {
                return res.status(401).json({ message: "API Key tidak valid atau sedang dinonaktifkan." });
            }

            // Validasi Secret Key jika dikirim di header
            if (headerSecret && String(headerSecret).trim() !== keyRecord.secret_key) {
                return res.status(401).json({ message: "Secret Key tidak cocok dengan API Key." });
            }

            // Validasi IP Whitelist jika diatur oleh reseller
            if (keyRecord.ip_whitelist && keyRecord.ip_whitelist.trim()) {
                const clientIp = getClientIp(req);
                const allowedIps = keyRecord.ip_whitelist
                    .split(",")
                    .map((item) => cleanIp(item))
                    .filter(Boolean);

                const isAllowed = allowedIps.some((allowed) => allowed === clientIp || allowed === "*" || clientIp === "127.0.0.1");
                if (!isAllowed) {
                    return res.status(403).json({
                        message: `Akses ditolak: IP Anda (${clientIp}) tidak terdaftar dalam IP Whitelist akun reseller ini.`,
                        code: "IP_NOT_WHITELISTED",
                        client_ip: clientIp
                    });
                }
            }

            // Ambil data user reseller
            const { data: user, error: userErr } = await supabase
                .from("users")
                .select("id, email, fullname, role, reseller_status, reseller_tier")
                .eq("id", keyRecord.user_id)
                .maybeSingle();

            if (userErr || !user) {
                return res.status(401).json({ message: "Akun pemilik API Key tidak ditemukan." });
            }

            if (user.reseller_status !== "approved") {
                return res.status(403).json({
                    message: "Akses API ditolak. Status reseller Anda belum aktif atau sedang disuspend.",
                    reseller_status: user.reseller_status
                });
            }

            req.user = {
                id: user.id,
                email: user.email,
                fullname: user.fullname,
                role: user.role,
                reseller_status: user.reseller_status,
                reseller_tier: user.reseller_tier,
                is_api_key: true,
                api_key_id: keyRecord.id
            };

            // Update stats di latar belakang (tidak memblokir request)
            setImmediate(async () => {
                try {
                    await supabase
                        .from("reseller_api_keys")
                        .update({
                            total_requests: (keyRecord.total_requests || 0) + 1,
                            last_used_at: new Date().toISOString(),
                            updated_at: new Date().toISOString()
                        })
                        .eq("id", keyRecord.id);
                } catch {
                    /* abaikan error statistik */
                }
            });

            return next();
        } catch (err) {
            console.error("apiKeyAuthMiddleware error:", err.message);
            return res.status(500).json({ message: "Gagal memvalidasi API Key." });
        }
    }

    // 2. Kasus JWT Bearer Token standar
    if (bearerToken) {
        try {
            const decoded = jwt.verify(bearerToken, JWT_SECRET);
            req.user = decoded;
            return next();
        } catch {
            return res.status(401).json({ message: "Sesi login kedaluwarsa atau token tidak valid." });
        }
    }

    return res.status(401).json({ message: "Kredensial API tidak ditemukan. Sertakan Bearer Token atau X-NexShop-Api-Key." });
}

/**
 * Versi Optional Auth:
 * Jika kredensial dikirim dan valid -> pasang req.user (harga reseller aktif).
 * Jika tidak ada kredensial -> lolos sebagai guest umum tanpa error 401.
 */
async function optionalApiKeyOrJwtAuth(req, res, next) {
    const headerApiKey = req.headers["x-nexshop-api-key"] || req.headers["x-api-key"];
    const authHeader = req.headers["authorization"] || "";
    let bearerToken = "";
    if (authHeader.startsWith("Bearer ")) {
        bearerToken = authHeader.slice(7).trim();
    }

    const hasCreds = Boolean(headerApiKey || bearerToken);
    if (!hasCreds) {
        req.user = null;
        return next();
    }

    // Jika ada kredensial, jalankan verifikasi apiKeyAuthMiddleware
    apiKeyAuthMiddleware(req, res, (err) => {
        if (err) {
            req.user = null;
        }
        next();
    });
}

module.exports = {
    apiKeyAuthMiddleware,
    optionalApiKeyOrJwtAuth
};
