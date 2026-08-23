const crypto = require("crypto");
const supabase = require("../config/db");
const jwt = require("jsonwebtoken");
const { isMissingTableError } = require("../services/resellerService");

// ===========================================================
// AUTENTIKASI OPEN API RESELLER
//
// Catatan keamanan penting (semuanya perbaikan dari versi sebelumnya):
//
// 1. JWT_SECRET tidak boleh punya nilai default hardcoded. Dulu file ini
//    memakai fallback "nexshop-secret-jwt-key-2026" -- nilai yang ikut
//    ter-commit ke repo. Kalau env JWT_SECRET lupa dipasang, semua orang
//    yang pernah lihat repo ini bisa menandatangani token admin palsu.
//    Sekarang: kalau secret-nya kosong, verifikasi JWT ditolak, bukan
//    dilanjutkan memakai secret tebakan.
//
// 2. IP client TIDAK boleh diambil langsung dari header X-Forwarded-For /
//    X-Real-IP / CF-Connecting-IP. Header itu dikirim oleh client dan bisa
//    dipalsukan bebas. Express sudah punya req.ip yang dihitung dari
//    `trust proxy` (di-set ke 1 di server.js, sesuai 1 lapis Nginx di
//    depan app) -- itulah satu-satunya sumber yang sah.
//
// 3. Dulu predikat whitelist-nya berbunyi:
//       allowed === clientIp || allowed === "*" || clientIp === "127.0.0.1"
//    Klausa terakhir bikin siapa pun yang bisa memaksa clientIp jadi
//    127.0.0.1 -- persis lewat lubang nomor 2 di atas, cukup kirim header
//    `X-Forwarded-For: 127.0.0.1` -- lolos dari IP whitelist sepenuhnya.
//    Klausa itu dihapus.
//
// 4. Secret Key sekarang WAJIB, bukan "divalidasi kalau kebetulan
//    dikirim". Sebelumnya cukup memegang API Key saja untuk memesan atas
//    nama reseller, sehingga Secret Key praktis tidak berfungsi sebagai
//    faktor kedua. Perbandingannya juga dibuat timing-safe.
// ===========================================================

const JWT_SECRET = process.env.JWT_SECRET || "";

function cleanIp(rawIp) {
    if (!rawIp) return "";
    let ip = String(rawIp).trim();
    if (ip.startsWith("::ffff:")) ip = ip.slice(7);
    if (ip === "::1") ip = "127.0.0.1";
    return ip;
}

// Sumber tunggal IP client: req.ip milik Express (sudah menghormati
// `trust proxy`). Header mentah tidak pernah dibaca di sini.
function getClientIp(req) {
    return cleanIp(req.ip || (req.connection && req.connection.remoteAddress) || "");
}

// Perbandingan rahasia yang tidak membocorkan panjang/prefix lewat waktu
// eksekusi. Kedua sisi di-hash dulu supaya panjang buffer-nya selalu sama --
// crypto.timingSafeEqual melempar kalau panjangnya beda.
function secureCompare(a, b) {
    const bufA = crypto.createHash("sha256").update(String(a == null ? "" : a), "utf8").digest();
    const bufB = crypto.createHash("sha256").update(String(b == null ? "" : b), "utf8").digest();
    return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Middleware Autentikasi Open API Reseller.
 *
 * Menerima:
 * 1. X-NexShop-Api-Key + X-NexShop-Secret  (dua-duanya wajib)
 * 2. Authorization: Bearer <api_key>       + X-NexShop-Secret (wajib)
 * 3. Authorization: Bearer <jwt>           (sesi login web biasa)
 */
async function apiKeyAuthMiddleware(req, res, next) {
    const headerApiKey = req.headers["x-nexshop-api-key"] || req.headers["x-api-key"];
    const headerSecret = req.headers["x-nexshop-secret"] || req.headers["x-api-secret"];
    const authHeader = req.headers["authorization"] || "";

    let bearerToken = "";
    if (authHeader.startsWith("Bearer ")) {
        bearerToken = authHeader.slice(7).trim();
    }

    const targetApiKey =
        (headerApiKey ? String(headerApiKey).trim() : "") ||
        (bearerToken.startsWith("nx_live_") ? bearerToken : "");

    // ---- Jalur 1: API Key + Secret Key ----
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
                        success: false,
                        message: "Fitur API Key Reseller belum di-setup di database. Jalankan migration 010_create_reseller_api_and_kyc.sql.",
                        code: "API_KEY_NOT_SETUP"
                    });
                }
                throw error;
            }

            if (!keyRecord || !keyRecord.is_active) {
                return res.status(401).json({
                    success: false,
                    message: "API Key tidak valid atau sedang dinonaktifkan.",
                    code: "INVALID_API_KEY"
                });
            }

            // Secret Key WAJIB -- bukan opsional seperti versi sebelumnya.
            const providedSecret = headerSecret ? String(headerSecret).trim() : "";
            if (!providedSecret) {
                return res.status(401).json({
                    success: false,
                    message: "Secret Key wajib dikirim lewat header X-NexShop-Secret.",
                    code: "SECRET_KEY_REQUIRED"
                });
            }
            if (!keyRecord.secret_key || !secureCompare(providedSecret, keyRecord.secret_key)) {
                return res.status(401).json({
                    success: false,
                    message: "Secret Key tidak cocok dengan API Key.",
                    code: "INVALID_SECRET_KEY"
                });
            }

            // IP Whitelist (opsional, diatur reseller sendiri lewat portal).
            if (keyRecord.ip_whitelist && keyRecord.ip_whitelist.trim()) {
                const clientIp = getClientIp(req);
                const allowedIps = keyRecord.ip_whitelist
                    .split(",")
                    .map((item) => cleanIp(item))
                    .filter(Boolean);

                // "*" tetap didukung sebagai opt-out eksplisit oleh pemilik
                // akun. Yang dihapus adalah bypass diam-diam untuk 127.0.0.1.
                const isAllowed = allowedIps.some((allowed) => allowed === "*" || allowed === clientIp);
                if (!isAllowed) {
                    return res.status(403).json({
                        success: false,
                        message: "Akses ditolak: IP Anda (" + clientIp + ") tidak terdaftar dalam IP Whitelist akun reseller ini.",
                        code: "IP_NOT_WHITELISTED",
                        client_ip: clientIp
                    });
                }
            }

            const { data: user, error: userErr } = await supabase
                .from("users")
                .select("id, email, fullname, role, reseller_status, reseller_tier, is_blacklisted")
                .eq("id", keyRecord.user_id)
                .maybeSingle();

            if (userErr || !user) {
                return res.status(401).json({ success: false, message: "Akun pemilik API Key tidak ditemukan." });
            }

            if (user.is_blacklisted) {
                return res.status(403).json({
                    success: false,
                    message: "Akun reseller ini diblokir. Hubungi admin NexShop.",
                    code: "ACCOUNT_BLOCKED"
                });
            }

            if (user.reseller_status !== "approved") {
                return res.status(403).json({
                    success: false,
                    message: "Akses API ditolak. Status reseller Anda belum aktif atau sedang disuspend.",
                    code: "RESELLER_NOT_APPROVED",
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

            // Statistik pemakaian -- dinaikkan lewat RPC atomik kalau ada,
            // supaya dua request berbarengan tidak saling menimpa hitungan.
            setImmediate(async () => {
                try {
                    const { error: rpcErr } = await supabase.rpc("increment_reseller_api_usage", {
                        p_key_id: keyRecord.id
                    });
                    if (rpcErr) {
                        await supabase
                            .from("reseller_api_keys")
                            .update({
                                total_requests: (keyRecord.total_requests || 0) + 1,
                                last_used_at: new Date().toISOString(),
                                updated_at: new Date().toISOString()
                            })
                            .eq("id", keyRecord.id);
                    }
                } catch (_) {
                    /* statistik gagal tidak boleh mengganggu request */
                }
            });

            return next();
        } catch (err) {
            console.error("apiKeyAuthMiddleware error:", err.message);
            return res.status(500).json({ success: false, message: "Gagal memvalidasi API Key." });
        }
    }

    // ---- Jalur 2: JWT sesi web biasa ----
    if (bearerToken) {
        if (!JWT_SECRET) {
            console.error("apiKeyAuthMiddleware: JWT_SECRET belum di-set, verifikasi token ditolak.");
            return res.status(500).json({ success: false, message: "Konfigurasi server belum lengkap." });
        }
        try {
            req.user = jwt.verify(bearerToken, JWT_SECRET);
            return next();
        } catch (_) {
            return res.status(401).json({ success: false, message: "Sesi login kedaluwarsa atau token tidak valid." });
        }
    }

    return res.status(401).json({
        success: false,
        message: "Kredensial API tidak ditemukan. Sertakan Bearer Token, atau pasangan X-NexShop-Api-Key + X-NexShop-Secret."
    });
}

/**
 * Versi optional-auth untuk endpoint publik yang harganya menyesuaikan
 * kalau kebetulan pemanggilnya seorang reseller.
 *
 * Perbaikan: dulu fungsi ini memanggil apiKeyAuthMiddleware lalu berharap
 * kegagalan datang lewat callback -- padahal middleware itu MENGIRIM
 * respons 401/403 sendiri. Akibatnya kredensial yang salah/kedaluwarsa
 * bikin endpoint "opsional" ikut gagal keras, bukan lanjut sebagai tamu.
 * Sekarang respons di-intercept: kalau autentikasinya gagal, request
 * diteruskan sebagai guest tanpa pernah mengirim respons error.
 */
async function optionalApiKeyOrJwtAuth(req, res, next) {
    const headerApiKey = req.headers["x-nexshop-api-key"] || req.headers["x-api-key"];
    const authHeader = req.headers["authorization"] || "";
    const hasCreds = Boolean(headerApiKey || authHeader.startsWith("Bearer "));

    if (!hasCreds) {
        req.user = null;
        return next();
    }

    let settled = false;
    const finish = (asGuest) => {
        if (settled) return;
        settled = true;
        if (asGuest) req.user = null;
        next();
    };

    // Shim respons: apa pun yang coba dikirim middleware utama ditelan,
    // lalu request diteruskan sebagai guest.
    const fakeRes = {
        status() { return this; },
        json() { finish(true); return this; },
        send() { finish(true); return this; }
    };

    try {
        await apiKeyAuthMiddleware(req, fakeRes, () => finish(false));
    } catch (_) {
        finish(true);
    }
    finish(true);
}

module.exports = {
    apiKeyAuthMiddleware,
    optionalApiKeyOrJwtAuth,
    getClientIp
};
