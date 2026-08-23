const express = require("express");
const router = express.Router();
const resellerController = require("../controllers/resellerController");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const { resellerApplyLimiter } = require("../middleware/rateLimiter");

// Publik — autentikasi mandiri khusus mitra reseller
router.post("/auth/register", resellerApplyLimiter, resellerController.resellerRegister);
router.post("/auth/login", resellerController.resellerLogin);

// Publik — dipakai halaman info reseller buat nampilin tabel tingkatan
router.get("/tiers", resellerController.getPublicTiers);

// User yang sudah login
router.get("/me", authMiddleware, resellerController.getMyResellerStatus);
router.post("/apply", authMiddleware, resellerApplyLimiter, resellerController.applyReseller);

// Partner Portal — Reseller Aktif
router.get("/portal/overview", authMiddleware, resellerController.getPortalOverview);
router.get("/portal/secret", authMiddleware, resellerController.revealSecretKey);
router.post("/portal/api-key/generate", authMiddleware, resellerController.generateOrRotateApiKey);
router.put("/portal/settings", authMiddleware, resellerController.updatePortalSettings);
router.get("/portal/products", authMiddleware, resellerController.getPortalProducts);
router.get("/portal/orders", authMiddleware, resellerController.getPortalOrders);
router.post("/portal/test-webhook", authMiddleware, resellerController.testPortalWebhook);

// Admin & staff
router.get("/admin/applications", authMiddleware, adminMiddleware, resellerController.listApplications);
router.post("/admin/applications/:id/decision", authMiddleware, adminMiddleware, resellerController.decideApplication);
router.get("/admin/resellers", authMiddleware, adminMiddleware, resellerController.listResellers);
router.put("/admin/resellers/:id", authMiddleware, adminMiddleware, resellerController.updateResellerUser);
router.get("/admin/tiers", authMiddleware, adminMiddleware, resellerController.listTiersAdmin);
router.put("/admin/tiers/:code", authMiddleware, adminMiddleware, resellerController.updateTier);

module.exports = router;
