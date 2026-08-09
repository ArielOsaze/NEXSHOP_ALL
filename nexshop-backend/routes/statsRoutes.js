const express = require("express");
const router = express.Router();
const statsController = require("../controllers/statsController");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");

router.get("/public", statsController.getPublicOverview); // publik, tanpa auth — buat trust bar di halaman utama
router.get("/leaderboard", statsController.getLeaderboard); // publik, top spenders
router.get("/overview", authMiddleware, adminMiddleware, statsController.getOverview);
router.get("/export-orders", authMiddleware, adminMiddleware, statsController.exportOrders);
router.get("/system-health", authMiddleware, adminMiddleware, statsController.getSystemHealth);
router.get("/ai-insights", authMiddleware, adminMiddleware, statsController.getAiInsights);

// ADMIN — Top Spenders (Leaderboard) CRUD
router.get("/admin/leaderboard", authMiddleware, adminMiddleware, statsController.getAdminLeaderboard);
router.post("/admin/leaderboard", authMiddleware, adminMiddleware, statsController.addTopSpender);
router.put("/admin/leaderboard/:id", authMiddleware, adminMiddleware, statsController.updateTopSpender);
router.delete("/admin/leaderboard/:id", authMiddleware, adminMiddleware, statsController.deleteTopSpender);

module.exports = router;
