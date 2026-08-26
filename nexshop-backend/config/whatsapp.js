/**
 * config/whatsapp.js — REPLACED from WAAPI to NexShop WA API (local Baileys server)
 *
 * Original: kirim notifikasi admin ke https://waapi.fyas.my.id/api/whatsapp/send-message
 * Sekarang : kirim ke WA API server (Baileys), URL/Key-nya diambil dari
 * getWaApiConfig() — utamakan yang tersimpan di dashboard (Settings > API
 * Keys), .env cuma fallback kalau field dashboard kosong. Jangan hardcode
 * WA_API_URL/WA_API_KEY di sini lagi, supaya admin bisa ganti dari dashboard
 * tanpa perlu edit .env di VPS.
 *
 * Notifikasi ini kirim ke ADMIN, pakai nomor yang dikonfig di Settings > API Keys
 * (waapi_target_number / NEXSHOP_ADMIN_WA_NUMBER).
 */

const axios = require("axios");
const { getWaApiConfig } = require("./settings");

/**
 * Kirim notifikasi ke WhatsApp admin lewat WA API server.
 * Pesan dikirim sebagai custom message via /send-otp endpoint.
 *
 * Pola & alasan silent-fail-nya sama persis kayak sebelumnya
 * (WAAPI/Fonnte): kalau gagal kirim WA, proses utama (order/topup)
 * JANGAN ikut gagal.
 */
async function sendWhatsAppNotification(message) {
    let url, key, targetNumber;
    try {
        ({ url, key, targetNumber } = await getWaApiConfig());
    } catch (err) {
        console.log("Gagal ambil config WA API:", err.message);
        return;
    }

    if (!targetNumber) {
        console.log("⚠️ Nomor WA admin (waapi_target_number) belum diisi — notifikasi WhatsApp nonaktif");
        return;
    }

    try {
        // Kirim via /send-otp endpoint (pakai custom message)
        await axios.post(`${url}/send-otp`, {
            phone: targetNumber,
            otp: "notify",  // dummy, karena message custom akan dipakai
            message: message
        }, {
            headers: {
                "Content-Type": "application/json",
                "X-API-Key": key
            },
            timeout: 10000
        });
    } catch (err) {
        console.log("Gagal kirim notifikasi WhatsApp (WA API):", err.response?.data || err.message);
    }
}

module.exports = { sendWhatsAppNotification };
