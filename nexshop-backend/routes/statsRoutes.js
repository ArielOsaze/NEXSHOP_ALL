const express = require("express");
const router = express.Router();
const statsController = require("../controllers/statsController");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");

router.get("/public", statsController.getPublicOverview); // publik, tanpa auth — buat trust bar di halaman utama
router.get("/overview", authMiddleware, adminMiddleware, statsController.getOverview);
router.get("/export-orders", authMiddleware, adminMiddleware, statsController.exportOrders);
router.get("/system-health", authMiddleware, adminMiddleware, statsController.getSystemHealth);
router.get("/ai-insights", authMiddleware, adminMiddleware, statsController.getAiInsights);

module.exports = router;
