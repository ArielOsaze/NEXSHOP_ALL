const { flushPendingDeliveries, RelayNotSetupError } = require("../services/webhookRelayService");

// ===========================================================
// Retry pengiriman Webhook Relay.
//
// Pengiriman pertama dicoba langsung begitu callback TokoVoucher masuk.
// Poller ini yang ngurus sisanya: server toko penerima yang lagi mati,
// timeout, atau balasan 5xx. Jadwal mundurnya (1m, 5m, 15m, 1j, 3j) diatur
// di webhookRelayService.js -- di sini cuma dibangunkan tiap menit dan
// baris yang sudah jatuh tempo yang bakal keambil.
// ===========================================================
const INTERVAL_MS = 60 * 1000;

async function runWebhookRelayPoller() {
    try {
        await flushPendingDeliveries();
    } catch (err) {
        // Tabel belum dibuat (migration 009 belum jalan) itu kondisi normal
        // di instalasi baru -- jangan spam log tiap menit.
        if (err instanceof RelayNotSetupError) return;
        console.error("[webhook-relay-poller] error:", err.message);
    }
}

function startWebhookRelayPoller() {
    setInterval(runWebhookRelayPoller, INTERVAL_MS);
}

module.exports = { startWebhookRelayPoller, runWebhookRelayPoller };
