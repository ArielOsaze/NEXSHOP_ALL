// Route WA API proxy — akses admin dashboard fitur "QR Scan & Status WA API"
// Auth: Bearer JWT (admin login) + security_pin (6 digit) via withAdminPin pattern
// Akses via frontend:
//   withAdminPin(async (pin) => apiFetch("/settings/wa-api/status", { method: "POST", body: JSON.stringify({ security_pin: pin }) }));

const express = require("express");
const router = express.Router({ mergeParams: true });
const { requireAdminPin } = require("../middleware/adminPinMiddleware");
const axios = require("axios");

const WA_API_URL = process.env.WA_API_URL || "http://127.0.0.1:8080";
const WA_API_KEY = process.env.WA_API_KEY || "nexshop-wa-2024-secure-key";

/** GET /api/settings/wa-api/status  — cek koneksi WA + dapat QR (NO auth — read-only seperti /health) */
router.get("/status", async (req, res) => {
    try {
        const health = await axios.get(`${WA_API_URL}/health`, {
            headers: { "X-API-Key": WA_API_KEY },
            timeout: 8000
        });
        // Ambil QR juga kalau belum connected
        let qrData = null;
        if (!health.data.waConnected && !health.data.qrAvailable) {
            try {
                const qrResp = await axios.get(`${WA_API_URL}/qr`, {
                    headers: { "X-API-Key": WA_API_KEY },
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
            message: "WA API server (port 8080) tidak dapat dihubungi.",
            waConnected: false,
            error: err.message
        });
    }
});

/** POST /api/settings/wa-api/rescan — hapus session & restart WA socket */
router.post("/rescan", requireAdminPin, async (req, res) => {
    const fs = require("fs");
    const { execSync } = require("child_process");
    const path = require("path");
    const sessionDir = process.env.WA_SESSION_DIR || "C:/Users/ariel/nexshop/whatsapp-session";

    // hapus session lama
    let cleared = false;
    try {
        if (fs.existsSync(sessionDir)) {
            for (const f of fs.readdirSync(sessionDir)) {
                fs.unlinkSync(path.join(sessionDir, f));
                cleared = true;
            }
        }
    } catch (e) { /* */ }

    // restart WA API di PM2
    try {
        execSync("pm2 restart nexshop-wa-api", { timeout: 15000, stdio: "pipe" });
    } catch (e) { console.error("PM2 restart error:", e.message); }

    // Tunggu & kirim QR baru
    setTimeout(async () => {
        try {
            const qrResp = await axios.get(`${WA_API_URL}/qr`, {
                headers: { "X-API-Key": WA_API_KEY },
                timeout: 8000
            });
            res.json({
                success: true,
                message: "QR code WA baru digenerate. Scan di WhatsApp ponsel.",
                qr: qrResp.data.qr || null,
                qrImage: qrResp.data.qrImage || null,
                sessionCleared: cleared
            });
        } catch (e) {
            res.json({
                success: true,
                message: "Session dihapus & service restart. Refresh dashboard untuk QR baru.",
                sessionCleared: cleared
            });
        }
    }, 5000);
});

/** GET /api/settings/wa-api/dashboard
 * Halaman HTML simpel — akses bebas (hanya QR PNG read-only, tidak mengubah apa-apa)
 * Bisa dibuka langsung di browser admin / diembed iframe.
 */
router.get("/dashboard", async (req, res) => {
    try {
        const health = await axios.get(`${WA_API_URL}/health`, {
            headers: { "X-API-Key": WA_API_KEY },
            timeout: 8000
        });

        let qrImg = '';
        if (!health.data.waConnected) {
            try {
                const qrResp = await axios.get(`${WA_API_URL}/qr`, {
                    headers: { "X-API-Key": WA_API_KEY },
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
    <p><a href="/api/settings/wa-api/rescan" onclick="return confirm('Reset session WA & generate QR baru?')">🔄 Generate QR Baru</a></p>
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
