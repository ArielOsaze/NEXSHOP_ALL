const express = require("express");
const router = express.Router();
const musicController = require("../controllers/musicController");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const superAdminMiddleware = require("../middleware/superAdminMiddleware");

// ==========================================
// PUBLIC ROUTES (Frontend)
// ==========================================
router.get("/public", musicController.getPublicMusic);

// ==========================================
// ADMIN ROUTES (Dashboard)
// ==========================================
router.get("/admin", authMiddleware, adminMiddleware, musicController.getAdminMusic);
router.post("/", authMiddleware, superAdminMiddleware, musicController.addMusic);
router.put("/:id", authMiddleware, superAdminMiddleware, musicController.updateMusic);
router.put("/:id/active", authMiddleware, superAdminMiddleware, musicController.setActiveMusic);
router.delete("/:id", authMiddleware, superAdminMiddleware, musicController.deleteMusic);
router.post("/toggle", authMiddleware, superAdminMiddleware, musicController.toggleMusicPlayer);

module.exports = router;
