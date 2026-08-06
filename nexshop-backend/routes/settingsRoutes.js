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
const pinChangeRequestLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 3, standardHeaders: true, legacyHeaders: false, message: { message: "Terlalu banyak permintaan OTP. Coba lagi 15 menit." } });
const pinChangeOtpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false, message: { message: "Terlalu banyak percobaan OTP. Coba lagi 15 menit." } });

// Publik — dipakai frontend toko (nama toko, logo, kontak)
router.get("/store", settingsController.getStoreSettingsPublic);

// Admin
router.put("/store", authMiddleware, adminMiddleware, requireAdminPin, settingsController.updateStoreSettingsAdmin);
router.get("/security-pin", authMiddleware, adminMiddleware, settingsController.getAdminPinStatus);
router.post("/security-pin/setup", authMiddleware, adminMiddleware, settingsController.setupAdminPin);
router.post("/security-pin/verify", authMiddleware, adminMiddleware, adminPinVerifyLimiter, settingsController.verifyAdminPin);
router.post("/security-pin/change/request", authMiddleware, adminMiddleware, requireAdminPin, pinChangeRequestLimiter, settingsController.requestAdminPinChangeOtp);
router.post("/security-pin/change/verify-otp", authMiddleware, adminMiddleware, pinChangeOtpLimiter, settingsController.verifyAdminPinChangeOtp);
router.post("/security-pin/change", authMiddleware, adminMiddleware, pinChangeOtpLimiter, settingsController.changeAdminPin);
router.post("/api-keys", authMiddleware, adminMiddleware, requireAdminPin, settingsController.getApiKeysAdmin);
router.post("/api-keys/reveal", authMiddleware, adminMiddleware, requireAdminPin, settingsController.revealApiKeysAdmin);
router.put("/api-keys", authMiddleware, adminMiddleware, requireAdminPin, settingsController.updateApiKeysAdmin);
router.post("/test-whatsapp", authMiddleware, adminMiddleware, requireAdminPin, settingsController.testWhatsAppAdmin);

// Profil admin yang sedang login
router.get("/me", authMiddleware, settingsController.getMe);
router.put("/me", authMiddleware, settingsController.updateMe);

module.exports = router;
