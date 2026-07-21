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
    "free fire": "freefire",
    "free fire max": "freefire"
};

function md5(str) {
    return crypto.createHash("md5").update(str).digest("hex");
}

function resolveGameCode(kategori) {
    if (!kategori) return null;
    return SUPPORTED_GAMES[kategori.trim().toLowerCase()] || null;
}

async function getCreds() {
    const keys = await getApiKeys();
    if (!keys.apigames_merchant_id || !keys.apigames_secret_key) {
        return null; // belum dikonfigurasi admin — bukan error, cuma "gak aktif"
    }
    return { merchantId: keys.apigames_merchant_id, secretKey: keys.apigames_secret_key };
}

// Cek nickname akun. Return null kalau gamenya gak didukung ATAU ApiGames belum
// dikonfigurasi (dianggap "fitur gak aktif", bukan error) — return
// { is_valid, username } kalau berhasil dicek.
async function checkNickname({ kategori, tujuan, serverId }) {
    const gameCode = resolveGameCode(kategori);
    if (!gameCode) return null;

    const creds = await getCreds();
    if (!creds) return null;

    const { merchantId, secretKey } = creds;
    const signature = md5(merchantId + secretKey);

    // Mobile Legends butuh Zone ID (server_id) digabung ke user_id dengan format
    // "userid(zoneid)" — konvensi umum yang dipakai kebanyakan reseller topup.
    const userId = gameCode === "mobilelegend" && serverId ? `${tujuan}(${serverId})` : tujuan;

    const { data } = await axios.get(`${BASE_URL}/merchant/${merchantId}/cek-username/${gameCode}`, {
        params: { user_id: userId, signature },
        timeout: 8000
    });

    if (!data || !data.data) return null;
    return {
        is_valid: !!data.data.is_valid,
        username: data.data.username || ""
    };
}

module.exports = { checkNickname, resolveGameCode };
