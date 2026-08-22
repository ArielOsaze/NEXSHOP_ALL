const express = require("express");
const router = express.Router();
const resellerController = require("../controllers/resellerController");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const { resellerApplyLimiter } = require("../middleware/rateLimiter");

// Publik — dipakai halaman info reseller buat nampilin tabel tingkatan
router.get("/tiers", resellerController.getPublicTiers);

// User yang sudah login
router.get("/me", authMiddleware, resellerController.getMyResellerStatus);
router.post("/apply", authMiddleware, resellerApplyLimiter, resellerController.applyReseller);

// Admin & staff
router.get("/admin/applications", authMiddleware, adminMiddleware, resellerController.listApplications);
router.post("/admin/applications/:id/decision", authMiddleware, adminMiddleware, resellerController.decideApplication);
router.get("/admin/resellers", authMiddleware, adminMiddleware, resellerController.listResellers);
router.put("/admin/resellers/:id", authMiddleware, adminMiddleware, resellerController.updateResellerUser);
router.get("/admin/tiers", authMiddleware, adminMiddleware, resellerController.listTiersAdmin);
router.put("/admin/tiers/:code", authMiddleware, adminMiddleware, resellerController.updateTier);

module.exports = router;
