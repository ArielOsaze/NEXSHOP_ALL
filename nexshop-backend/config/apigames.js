const axios = require("axios");
const crypto = require("crypto");
const { getApiKeys } = require("./settings");

const BASE_URL = "https://v1.apigames.id";

// Game yang didukung ApiGames buat cek nickname otomatis (per dokumentasi resmi
// mereka, Juli 2026 cuma ini + Higgs Domino). Kalau kategori produk topup kita
// gak cocok salah satu ini, kita anggap "gak didukung" dan frontend fallback ke
// peringatan manual biasa (gak block checkout).
const SUPPORTED_GAMES = {
    "mobile legends": "mobilelegend",
    "mobile legends: bang bang": "mobilelegend",
    "mobile legend": "mobilelegend",
    "mlbb": "mobilelegend",
    "free fire": "freefire",
    "free fire max": "freefire",
    "ff": "freefire"
};

function md5(str) {
    return crypto.createHash("md5").update(str).digest("hex");
}

function resolveGameCode(kategori) {
    if (!kategori) return null;
    const normalized = String(kategori).trim().toLowerCase().replace(/\s+/g, " ");
    return SUPPORTED_GAMES[normalized] || null;
}

async function getCreds() {
    const keys = await getApiKeys();
    if (!keys.apigames_merchant_id || !keys.apigames_secret_key) {
        return null; // belum dikonfigurasi admin — bukan error, cuma "gak aktif"
    }
    return { merchantId: keys.apigames_merchant_id, secretKey: keys.apigames_secret_key };
}

// Cek nickname akun.
async function checkNickname({ kategori, tujuan, serverId }) {
    const gameCode = resolveGameCode(kategori);
    if (!gameCode) return { available: false, reason: "game_unsupported" };

    const creds = await getCreds();
    if (!creds) return { available: false, reason: "service_not_configured" };

    const { merchantId, secretKey } = creds;
    const signature = md5(merchantId + secretKey);

    // Mobile Legends butuh Zone ID (server_id) digabung ke user_id dengan format
    // "userid(zoneid)" — konvensi umum yang dipakai kebanyakan reseller topup.
    const userId = gameCode === "mobilelegend" && serverId ? `${tujuan}(${serverId})` : tujuan;

    try {
        const { data } = await axios.get(`${BASE_URL}/merchant/${merchantId}/cek-username/${gameCode}`, {
            params: { user_id: userId, signature },
            timeout: 8000
        });

        // ApiGames mengembalikan status 0 jika user_id tidak ditemukan atau invalid
        if (data && (data.status === 0 || data.status === "0")) {
            // Bisa jadi invalid/not found, atau signature salah.
            // Kita anggap is_valid: false jika error_msg mengindikasikan tidak ketemu.
            const errMsg = (data.error_msg || "").toLowerCase();
            if (errMsg.includes("not found") || errMsg.includes("tidak ditemukan") || errMsg.includes("invalid") || errMsg.includes("salah")) {
                return { available: true, is_valid: false, username: "" };
            }
            // Jika error lain (misal signature salah), lempar ke error umum
            console.log("[ApiGames] API Error:", data.error_msg);
            return { available: false, reason: "provider_unavailable", message: "Layanan verifikasi nickname sedang tidak tersedia." };
        }

        if (!data || typeof data.data !== "object") {
            console.log("[ApiGames] Unexpected response shape:", {
                gameCode,
                status: data?.status,
                hasData: !!data,
                dataType: typeof data?.data
            });
            return { available: false, reason: "provider_unavailable", message: "Layanan verifikasi nickname sedang tidak tersedia." };
        }
        return {
            available: true,
            is_valid: !!data.data.is_valid || data.status === 1 || data.status === "1",
            username: data.data.username || ""
        };
    } catch (err) {
        // Log diagnostik aman — tanpa merchant ID, secret, atau signature
        const logInfo = {
            gameCode,
            errorType: err.code || "UNKNOWN"
        };
        if (err.response) {
            logInfo.httpStatus = err.response.status;
            // Sanitasi pesan provider — jangan log payload penuh
            const provMsg = err.response.data?.message || err.response.data?.status || "";
            logInfo.providerMessage = String(provMsg).substring(0, 200);
        } else if (err.code === "ECONNABORTED" || err.code === "ETIMEDOUT") {
            logInfo.errorType = "timeout";
        } else if (err.code === "ENOTFOUND" || err.code === "ECONNREFUSED") {
            logInfo.errorType = "network";
        }
        console.log("[ApiGames] checkNickname error:", logInfo);

        return { available: false, reason: "provider_unavailable", message: "Layanan verifikasi nickname sedang tidak tersedia." };
    }
}

module.exports = { checkNickname, resolveGameCode };
