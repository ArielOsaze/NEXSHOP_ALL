const axios = require("axios");
require("dotenv").config();
const { getApiKeys } = require("./settings");

// Kirim notifikasi ke WhatsApp lewat WA Gateway (waapi.fyas.my.id), dipanggil
// dari controller lain (order/topup) tiap ada event penting (pembelian sukses,
// dst) — pola & alasan silent-fail-nya sama persis kayak sendTelegramNotification:
// kalau gagal kirim WA, itu JANGAN sampai bikin proses utama (update status
// order/topup) ikut gagal.
//
// Config (URL/Key/nomor tujuan) diambil dari tabel api_keys (bisa diedit
// lewat Settings > API Keys di admin dashboard), dengan fallback ke .env
// kalau admin belum pernah isi dari dashboard sama sekali.
async function sendWhatsAppNotification(message) {
    let waapi_url, waapi_key, waapi_target_number;
    try {
        ({ waapi_url, waapi_key, waapi_target_number } = await getApiKeys());
    } catch (err) {
        console.log("Gagal ambil config WAAPI:", err.message);
        return;
    }

    if (!waapi_url || !waapi_key || !waapi_target_number) {
        console.log("⚠️ WAAPI_URL / WAAPI_KEY / WAAPI_TARGET_NUMBER belum diisi — notifikasi WhatsApp nonaktif");
        return;
    }

    try {
        await axios.post(
            `${waapi_url.replace(/\/$/, "")}/api/whatsapp/send-message`,
            {
                number: waapi_target_number,
                message
            },
            {
                headers: {
                    "Content-Type": "application/json",
                    "X-API-Key": waapi_key
                },
                timeout: 10000
            }
        );
    } catch (err) {
        console.log("Gagal kirim notifikasi WhatsApp:", err.response?.data || err.message);
    }
}

module.exports = { sendWhatsAppNotification };
