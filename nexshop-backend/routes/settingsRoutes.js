const express = require("express");
const router = express.Router();
const settingsController = require("../controllers/settingsController");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const { requireAdminPin } = require("../middleware/adminPinMiddleware");
const rateLimit = require("express-rate-limit");

const adminPinVerifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Terlalu banyak percobaan Security PIN. Coba lagi 15 menit." }
});

// Publik — dipakai frontend toko (nama toko, logo, kontak)
router.get("/store", settingsController.getStoreSettingsPublic);

// Admin
router.put("/store", authMiddleware, adminMiddleware, settingsController.updateStoreSettingsAdmin);
router.get("/security-pin", authMiddleware, adminMiddleware, settingsController.getAdminPinStatus);
router.post("/security-pin/setup", authMiddleware, adminMiddleware, settingsController.setupAdminPin);
router.post("/security-pin/verify", authMiddleware, adminMiddleware, adminPinVerifyLimiter, settingsController.verifyAdminPin);
router.post("/api-keys", authMiddleware, adminMiddleware, requireAdminPin, settingsController.getApiKeysAdmin);
router.post("/api-keys/reveal", authMiddleware, adminMiddleware, requireAdminPin, settingsController.revealApiKeysAdmin);
router.put("/api-keys", authMiddleware, adminMiddleware, requireAdminPin, settingsController.updateApiKeysAdmin);
router.post("/test-whatsapp", authMiddleware, adminMiddleware, requireAdminPin, settingsController.testWhatsAppAdmin);

// Profil admin yang sedang login
router.get("/me", authMiddleware, settingsController.getMe);
router.put("/me", authMiddleware, settingsController.updateMe);

module.exports = router;
