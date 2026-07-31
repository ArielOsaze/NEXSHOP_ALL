const axios = require("axios");
require("dotenv").config();

if (!process.env.WAAPI_URL || !process.env.WAAPI_KEY || !process.env.WAAPI_TARGET_NUMBER) {
    console.log("⚠️ WAAPI_URL / WAAPI_KEY / WAAPI_TARGET_NUMBER belum diisi di .env — notifikasi WhatsApp nonaktif");
}

// Kirim notifikasi ke WhatsApp lewat WA Gateway (waapi.fyas.my.id), dipanggil
// dari controller lain (order/topup) tiap ada event penting (pembelian sukses,
// dst) — pola & alasan silent-fail-nya sama persis kayak sendTelegramNotification:
// kalau gagal kirim WA, itu JANGAN sampai bikin proses utama (update status
// order/topup) ikut gagal.
async function sendWhatsAppNotification(message) {
    if (!process.env.WAAPI_URL || !process.env.WAAPI_KEY || !process.env.WAAPI_TARGET_NUMBER) return;

    try {
        await axios.post(
            `${process.env.WAAPI_URL.replace(/\/$/, "")}/api/whatsapp/send-message`,
            {
                number: process.env.WAAPI_TARGET_NUMBER,
                message
            },
            {
                headers: {
                    "Content-Type": "application/json",
                    "X-API-Key": process.env.WAAPI_KEY
                },
                timeout: 10000
            }
        );
    } catch (err) {
        console.log("Gagal kirim notifikasi WhatsApp:", err.response?.data || err.message);
    }
}

module.exports = { sendWhatsAppNotification };
