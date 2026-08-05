const express = require("express");
const router = express.Router();
const settingsController = require("../controllers/settingsController");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");

// Publik — dipakai frontend toko (nama toko, logo, kontak)
router.get("/store", settingsController.getStoreSettingsPublic);

// Admin
router.put("/store", authMiddleware, adminMiddleware, settingsController.updateStoreSettingsAdmin);
router.get("/api-keys", authMiddleware, adminMiddleware, settingsController.getApiKeysAdmin);
router.put("/api-keys", authMiddleware, adminMiddleware, settingsController.updateApiKeysAdmin);
router.post("/test-whatsapp", authMiddleware, adminMiddleware, settingsController.testWhatsAppAdmin);

// Profil admin yang sedang login
router.get("/me", authMiddleware, settingsController.getMe);
router.put("/me", authMiddleware, settingsController.updateMe);

module.exports = router;
