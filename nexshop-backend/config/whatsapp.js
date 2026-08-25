/**
 * config/whatsapp.js — REPLACED from WAAPI to NexShop WA API (local Baileys server)
 *
 * Original: kirim notifikasi admin ke https://waapi.fyas.my.id/api/whatsapp/send-message
 * Sekarang : kirim ke WA API server (Baileys) di http://127.0.0.1:8080
 *
 * Notifikasi ini kirim ke ADMIN, pakai nomor yang dikonfig di Settings > API Keys
 * (waapi_target_number / NEXSHOP_ADMIN_WA_NUMBER).
 */

const axios = require("axios");
const { getApiKeys } = require("./settings");

const WA_API_BASE = process.env.WA_API_URL || "http://127.0.0.1:8080";
const WA_API_KEY = process.env.WA_API_KEY || "nexshop-wa-2024-secure-key";

/**
 * Kirim notifikasi ke WhatsApp admin lewat WA API server.
 * Pesan dikirim sebagai custom message via /send-otp endpoint.
 *
 * Pola & alasan silent-fail-nya sama persis kayak sebelumnya
 * (WAAPI/Fonnte): kalau gagal kirim WA, proses utama (order/topup)
 * JANGAN ikut gagal.
 */
async function sendWhatsAppNotification(message) {
    let waapi_target_number;
    try {
        ({ waapi_target_number } = await getApiKeys());
    } catch (err) {
        console.log("Gagal ambil config WA target number:", err.message);
        return;
    }

    if (!waapi_target_number) {
        console.log("⚠️ Nomor WA admin (waapi_target_number) belum diisi — notifikasi WhatsApp nonaktif");
        return;
    }

    try {
        // Kirim via /send-otp endpoint (pakai custom message)
        await axios.post(`${WA_API_BASE}/send-otp`, {
            phone: waapi_target_number,
            otp: "notify",  // dummy, karena message custom akan dipakai
            message: message
        }, {
            headers: {
                "Content-Type": "application/json",
                "X-API-Key": WA_API_KEY
            },
            timeout: 10000
        });
    } catch (err) {
        console.log("Gagal kirim notifikasi WhatsApp (WA API):", err.response?.data || err.message);
    }
}

module.exports = { sendWhatsAppNotification };
