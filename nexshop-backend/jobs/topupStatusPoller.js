// Fallback polling buat transaksi topup TokoVoucher yang nyangkut di
// "pending"/"processing" -- jaga-jaga kalau webhook mereka gak sempet
// nyampe. Gak butuh library cron tambahan, cukup setInterval biasa.
const topupController = require("../controllers/topupController");

const POLL_INTERVAL_MS = 10 * 60 * 1000; // 10 menit, sesuai anjuran TokoVoucher
const FIRST_RUN_DELAY_MS = 60 * 1000; // tunggu 1 menit dulu pas baru start server, biar gak nabrak proses startup lain

function runPoll() {
    topupController.pollStuckOrders().catch((err) => {
        console.log("[topup-poller] error tidak tertangani:", err);
    });
}

function startTopupStatusPoller() {
    setTimeout(() => {
        runPoll();
        setInterval(runPoll, POLL_INTERVAL_MS);
    }, FIRST_RUN_DELAY_MS);

    console.log(`⏱️  Topup status poller aktif (cek tiap ${POLL_INTERVAL_MS / 60000} menit)`);
}

module.exports = { startTopupStatusPoller };
