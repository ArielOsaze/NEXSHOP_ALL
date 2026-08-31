const express = require("express");
const router = express.Router();
const webhookRelayController = require("../controllers/webhookRelayController");
const authMiddleware = require("../middleware/authMiddleware");
const superAdminMiddleware = require("../middleware/superAdminMiddleware");
const { requireAdminPin } = require("../middleware/adminPinMiddleware");

// ===========================================================
// WEBHOOK RELAY — semua rute di sini khusus dashboard admin.
//
// Semua pembacaan maupun perubahan relay dibatasi Super Admin karena
// riwayat/konfigurasi relay dapat mengungkap atau mengarahkan data transaksi.
// Rute menerima callback tetap di topupRoutes.js.
// (/api/topup/tokovoucher-webhook) -- itu yang didaftarkan di dashboard
// TokoVoucher, dan relay ini nempel di belakangnya.
// ===========================================================

router.get("/admin/info", authMiddleware, superAdminMiddleware, webhookRelayController.getRelayInfo);
router.get("/admin/endpoints", authMiddleware, superAdminMiddleware, webhookRelayController.listEndpoints);
router.get("/admin/deliveries", authMiddleware, superAdminMiddleware, webhookRelayController.listDeliveries);

router.post("/admin/endpoints", authMiddleware, superAdminMiddleware, webhookRelayController.createEndpoint);
router.put("/admin/endpoints/:id", authMiddleware, superAdminMiddleware, webhookRelayController.updateEndpoint);
router.delete("/admin/endpoints/:id", authMiddleware, superAdminMiddleware, webhookRelayController.deleteEndpoint);
router.post("/admin/endpoints/:id/test", authMiddleware, superAdminMiddleware, webhookRelayController.testEndpoint);
router.post("/admin/deliveries/:id/retry", authMiddleware, superAdminMiddleware, webhookRelayController.retryDelivery);

// Secret = kunci tanda tangan payload. Selain Super Admin, tetap diminta
// Security PIN, sama kayak halaman API Keys.
router.post("/admin/endpoints/:id/secret", authMiddleware, superAdminMiddleware, requireAdminPin, webhookRelayController.revealSecret);
router.post("/admin/endpoints/:id/rotate-secret", authMiddleware, superAdminMiddleware, requireAdminPin, webhookRelayController.rotateSecret);

module.exports = router;
