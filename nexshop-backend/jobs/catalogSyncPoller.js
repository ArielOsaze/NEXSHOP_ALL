const catalogService = require("../services/catalogService");
const { invalidateCatalogIndex } = require("../services/catalogIndexService");

// Poller interval: 60 minutes
const POLLER_INTERVAL = 60 * 60 * 1000;
let pollerTimer = null;

async function runCatalogSync() {
    try {
        console.log(`[catalog-sync-poller] Memulai sinkronisasi otomatis...`);
        const result = await catalogService.syncFullCatalog('auto');
        // Sync ini menulis langsung ke tabel produk tanpa lewat controller,
        // jadi pembungkus invalidasi di topupController tidak ikut kena.
        // Tanpa baris ini, etalase publik menyajikan katalog lama sampai TTL
        // cache habis padahal sinkronisasi baru saja selesai.
        invalidateCatalogIndex();
        console.log(`[catalog-sync-poller] Selesai sinkronisasi otomatis. Added: ${result.stats.added}, Updated: ${result.stats.updated}`);
    } catch (err) {
        console.error(`[catalog-sync-poller] Error:`, err.message);
    }
    
    // Schedule next run
    pollerTimer = setTimeout(runCatalogSync, POLLER_INTERVAL);
}

exports.startCatalogSyncPoller = () => {
    if (pollerTimer) return;
    
    // Delay first run by 2 minutes to let server start up
    pollerTimer = setTimeout(runCatalogSync, 2 * 60 * 1000);
    console.log("[catalog-sync-poller] Scheduler sinkronisasi katalog berjalan (interval 60 menit)");
};

exports.stopCatalogSyncPoller = () => {
    if (pollerTimer) {
        clearTimeout(pollerTimer);
        pollerTimer = null;
    }
};
