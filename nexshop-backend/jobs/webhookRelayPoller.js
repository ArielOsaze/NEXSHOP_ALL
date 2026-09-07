const { flushPendingDeliveries, RelayNotSetupError } = require("../services/webhookRelayService");
const { flushResellerWebhookDeliveries, isWebhookQueueMissing } = require("../services/resellerWebhookService");

// ===========================================================
// Retry pengiriman Webhook Relay dan callback langsung reseller.
// ===========================================================
const INTERVAL_MS = 60 * 1000;

async function runWebhookRelayPoller() {
    try {
        await flushPendingDeliveries();
    } catch (err) {
        // Tabel belum dibuat (migration 009 belum jalan) itu kondisi normal
        // di instalasi baru -- jangan spam log tiap menit.
        if (!(err instanceof RelayNotSetupError)) {
            console.error("[webhook-relay-poller] error:", err.message);
        }
    }

    try {
        await flushResellerWebhookDeliveries();
    } catch (err) {
        // Migration 026 boleh diterapkan setelah deploy kode.
        if (!isWebhookQueueMissing(err)) {
            console.error("[reseller-webhook-poller] error:", err.message);
        }
    }
}

function startWebhookRelayPoller() {
    setInterval(runWebhookRelayPoller, INTERVAL_MS);
}

module.exports = { startWebhookRelayPoller, runWebhookRelayPoller };
