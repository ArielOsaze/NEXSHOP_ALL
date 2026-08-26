// Route WA API proxy — akses admin dashboard fitur "QR Scan & Status WA API"
// Auth: Bearer JWT (admin login) + security_pin (6 digit) via withAdminPin pattern
// Akses via frontend:
//   withAdminPin(async (pin) => apiFetch("/settings/wa-api/status", { method: "POST", body: JSON.stringify({ security_pin: pin }) }));
//
// CATATAN: URL/Key WA API diambil dari getWaApiConfig() — utamakan yang
// tersimpan di dashboard (Settings > API Keys), .env cuma fallback darurat.
// Jangan hardcode WA_API_URL/WA_API_KEY module-level lagi di sini, supaya
// admin bisa ganti dari dashboard tanpa perlu edit .env di VPS.
//
// CATATAN ROUTING: POST /rescan di file ini SENGAJA TIDAK didaftarkan lagi
// (dulu ada, tapi jadi dead code / gak pernah kepanggil karena
// routes/settingsRoutes.js sudah lebih dulu mendaftarkan
// POST /api/settings/wa-api/rescan dengan requireAdminPin, jadi request-nya
// selalu ditangkap di sana lebih dulu — lihat settingsController.forceWaRescan).

const express = require("express");
const router = express.Router({ mergeParams: true });
const axios = require("axios");
const { getWaApiConfig } = require("../config/settings");

/** GET /api/settings/wa-api/status  — cek koneksi WA + dapat QR (NO auth — read-only seperti /health) */
router.get("/status", async (req, res) => {
    try {
        const { url, key } = await getWaApiConfig();
        const health = await axios.get(`${url}/health`, {
            headers: { "X-API-Key": key },
            timeout: 8000
        });
        // Ambil QR juga kalau belum connected
        let qrData = null;
        if (!health.data.waConnected && !health.data.qrAvailable) {
            try {
                const qrResp = await axios.get(`${url}/qr`, {
                    headers: { "X-API-Key": key },
                    timeout: 8000
                });
                qrData = qrResp.data;
            } catch (qrErr) { /* */ }
        }
        if (qrData?.qr === null) qrData = null; // WA connected

        res.json({
            success: true,
            waConnected: health.data.waConnected,
            qrAvailable: qrData?.qr ? true : false,
            qr: qrData?.qr || null,
            qrImage: qrData?.qrImage || null,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        res.status(200).json({
            success: false,
            message: "WA API server tidak dapat dihubungi. Pastikan proses 'nexshop-wa-api' berjalan dan URL/Key di Settings > API Keys sudah benar.",
            waConnected: false,
            error: err.message
        });
    }
});

/** GET /api/settings/wa-api/dashboard
 * Halaman HTML simpel — akses bebas (hanya QR PNG read-only, tidak mengubah apa-apa)
 * Bisa dibuka langsung di browser admin / diembed iframe.
 */
router.get("/dashboard", async (req, res) => {
    try {
        const { url, key } = await getWaApiConfig();
        const health = await axios.get(`${url}/health`, {
            headers: { "X-API-Key": key },
            timeout: 8000
        });

        let qrImg = '';
        if (!health.data.waConnected) {
            try {
                const qrResp = await axios.get(`${url}/qr`, {
                    headers: { "X-API-Key": key },
                    timeout: 8000
                });
                if (qrResp.data.qrImage) {
                    qrImg = `<img src="${qrResp.data.qrImage}" alt="QR Code WA" style="width:256px;height:256px;">`;
                }
            } catch (e) { /* */ }
        }

        const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="10">
  <title>NexShop WA API — QR Scan</title>
  <style>
    body { font-family: sans-serif; text-align: center; padding: 30px; background: #0f172a; color: #e2e8f0; }
    .card { display: inline-block; background: #1e293b; padding: 30px; border-radius: 12px; margin: 20px; }
    h1 { color: #10b981; }
    .connected { color: #10b981; font-weight: bold; }
    .disconnected { color: #ef4444; font-weight: bold; }
    img { border: 4px solid #334155; border-radius: 8px; }
    a { color: #38bdfa; }
  </style>
</head>
<body>
  <div class="card">
    <h1>📱 NexShop WA API</h1>
    <p>Status: <span class="${health.data.waConnected ? 'connected' : 'disconnected'}">
      ${health.data.waConnected ? '✅ TERHUBUNG' : '⚠️ BELUM TERHUBUNG'}
    </span></p>
    ${qrImg || '<p>Tunggu sebentar, QR sedang digenerate...</p>'}
    <p style="font-size:13px; margin-top:15px;">Buka WhatsApp di ponsel → Settings → Linked Devices → Scan QR</p>
    <p style="font-size:12px; opacity:0.7;">Reset session &amp; QR baru: tombol "Reset QR WhatsApp" di Admin Dashboard &gt; Settings &gt; API Keys.</p>
  </div>
</body>
</html>`;
        res.set("Content-Type", "text/html");
        res.send(html);
    } catch (err) {
        res.status(200).send(`<html><body style="background:#0f172a;color:#e2e8f0;padding:30px;"><h1>⚠️ WA API Server Offline</h1><p>Pastikan PM2 nexshop-wa-api berjalan: <code>pm2 start server.js --name nexshop-wa-api</code></p></body></html>`);
    }
});

module.exports = router;
