const express = require("express");
const router = express.Router();
const musicController = require("../controllers/musicController");
const authMiddleware = require("../middleware/authMiddleware");

// ==========================================
// PUBLIC ROUTES (Frontend)
// ==========================================
router.get("/public", musicController.getPublicMusic);

// ==========================================
// ADMIN ROUTES (Dashboard)
// ==========================================
router.get("/admin", authMiddleware, musicController.getAdminMusic);
router.post("/", authMiddleware, musicController.addMusic);
router.put("/:id/active", authMiddleware, musicController.setActiveMusic);
router.delete("/:id", authMiddleware, musicController.deleteMusic);
router.post("/toggle", authMiddleware, musicController.toggleMusicPlayer);

module.exports = router;
