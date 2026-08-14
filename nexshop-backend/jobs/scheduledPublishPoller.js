"use strict";
/**
 * scheduledPublishPoller.js
 * Memeriksa dan mempublikasikan artikel yang dijadwalkan setiap POLL_INTERVAL_MS.
 *
 * Atomic safety:
 *   - Update dilakukan dengan filter ganda: status='scheduled' AND scheduled_at <= NOW()
 *   - Jika poller berjalan bersamaan (mis. multiple server instance), update yang kedua
 *     tidak akan menemukan baris lagi karena status sudah berubah ke 'published'.
 *   - Tidak perlu lock tambahan untuk deployment single-instance.
 *
 * Abstraksi:
 *   - Fungsi runScheduledPublish diekspos terpisah agar bisa dipanggil dari
 *     external cron, Railway cron, atau VPS cron jika dipindahkan dari setInterval.
 */

const { runScheduledPublish } = require("../controllers/newsArticleController");

const POLL_INTERVAL_MS   = 60 * 1000;  // 60 detik
const FIRST_RUN_DELAY_MS = 30 * 1000;  // tunggu 30 detik saat startup

let _started = false;

/**
 * Jalankan satu siklus scheduled publish.
 * Bisa dipanggil dari external cron tanpa memanggil startScheduledPublishPoller.
 */
async function runPoll() {
    try {
        const count = await runScheduledPublish();
        if (count > 0) {
            console.log(`[scheduled-publish-poller] ${count} artikel dipublikasikan`);
        }
    } catch (err) {
        console.error("[scheduled-publish-poller] Error tidak tertangani:", err && err.message);
    }
}

/**
 * Start poller — hanya boleh dipanggil sekali.
 * Guard _started mencegah duplicate timer jika module di-import berkali-kali.
 */
function startScheduledPublishPoller() {
    if (_started) {
        console.log("⚠️  Scheduled publish poller sudah berjalan, skip duplikasi.");
        return;
    }
    _started = true;

    setTimeout(() => {
        runPoll();
        setInterval(runPoll, POLL_INTERVAL_MS);
    }, FIRST_RUN_DELAY_MS);

    console.log(`⏱️  Scheduled publish poller aktif (cek tiap ${POLL_INTERVAL_MS / 1000} detik)`);
}

module.exports = { startScheduledPublishPoller, runPoll };
