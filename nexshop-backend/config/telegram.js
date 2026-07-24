const axios = require("axios");
require("dotenv").config();

if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    console.log("⚠️ TELEGRAM_BOT_TOKEN atau TELEGRAM_CHAT_ID belum diisi di .env — notifikasi Telegram nonaktif");
}

// Kirim notifikasi ke Telegram (misal tiap ada pembelian sukses). Sengaja
// silent-fail: kalau gagal kirim ke Telegram, itu JANGAN sampai bikin proses
// utama (update status order/topup) ikut gagal — sama kayak pola email invoice.
async function sendTelegramNotification(message) {
    if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) return;

    try {
        await axios.post(
            `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
            {
                chat_id: process.env.TELEGRAM_CHAT_ID,
                text: message,
                parse_mode: "HTML"
            }
        );
    } catch (err) {
        console.log("Gagal kirim notifikasi Telegram:", err.response?.data || err.message);
    }
}

module.exports = { sendTelegramNotification };
