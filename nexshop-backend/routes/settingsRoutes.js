const express = require("express");
const router = express.Router();
const settingsController = require("../controllers/settingsController");
const authMiddleware = require("../middleware/authMiddleware");
const superAdminMiddleware = require("../middleware/superAdminMiddleware");
const { requireAdminPin } = require("../middleware/adminPinMiddleware");
const rateLimit = require("express-rate-limit");

const adminPinVerifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { message: "Terlalu banyak percobaan Security PIN. Coba lagi 15 menit." }
});
const pinChangeRequestLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 3, standardHeaders: true, legacyHeaders: false, message: { message: "Terlalu banyak permintaan OTP. Coba lagi 15 menit." } });
const pinChangeOtpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false, message: { message: "Terlalu banyak percobaan OTP. Coba lagi 15 menit." } });

const testApiGamesLimiter = rateLimit({ windowMs: 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false, message: { message: "Terlalu banyak test. Coba lagi sebentar." } });

const adminMiddleware = require("../middleware/adminMiddleware");

// Publik — dipakai frontend toko (nama toko, logo, kontak)
router.get("/store", settingsController.getStoreSettingsPublic);

// Admin
router.put("/store", authMiddleware, superAdminMiddleware, requireAdminPin, settingsController.updateStoreSettingsAdmin);
router.get("/security-pin", authMiddleware, adminMiddleware, settingsController.getAdminPinStatus);
router.post("/security-pin/setup", authMiddleware, superAdminMiddleware, settingsController.setupAdminPin);
router.post("/security-pin/verify", authMiddleware, superAdminMiddleware, adminPinVerifyLimiter, settingsController.verifyAdminPin);
router.post("/security-pin/change/request", authMiddleware, superAdminMiddleware, requireAdminPin, pinChangeRequestLimiter, settingsController.requestAdminPinChangeOtp);
router.post("/security-pin/change/verify-otp", authMiddleware, superAdminMiddleware, pinChangeOtpLimiter, settingsController.verifyAdminPinChangeOtp);
router.post("/security-pin/change", authMiddleware, superAdminMiddleware, pinChangeOtpLimiter, settingsController.changeAdminPin);
router.post("/api-keys", authMiddleware, superAdminMiddleware, requireAdminPin, settingsController.getApiKeysAdmin);
router.post("/api-keys/reveal", authMiddleware, superAdminMiddleware, requireAdminPin, settingsController.revealApiKeysAdmin);
router.put("/api-keys", authMiddleware, superAdminMiddleware, requireAdminPin, settingsController.updateApiKeysAdmin);
router.post("/runtime-config", authMiddleware, superAdminMiddleware, requireAdminPin, settingsController.getRuntimeConfigAdmin);
router.post("/runtime-config/reveal", authMiddleware, superAdminMiddleware, requireAdminPin, settingsController.revealRuntimeConfigSecretAdmin);
router.put("/runtime-config", authMiddleware, superAdminMiddleware, requireAdminPin, settingsController.updateRuntimeConfigAdmin);
router.post("/test-whatsapp", authMiddleware, superAdminMiddleware, requireAdminPin, settingsController.testWhatsAppAdmin);
router.post("/test-user-whatsapp", authMiddleware, superAdminMiddleware, requireAdminPin, settingsController.testUserWhatsApp);

// QR adalah kredensial login WhatsApp. Status boleh dibaca oleh admin yang
// sudah login, sedangkan reset sesi tetap membutuhkan Security PIN.
router.get("/wa-api/status", authMiddleware, superAdminMiddleware, settingsController.getWaApiStatus);
router.post("/wa-api/provision", authMiddleware, superAdminMiddleware, requireAdminPin, settingsController.provisionWaApiGatewayAdmin);
router.post("/wa-api/rescan", authMiddleware, superAdminMiddleware, requireAdminPin, settingsController.forceWaRescan);
router.post("/apigames/test", authMiddleware, superAdminMiddleware, requireAdminPin, testApiGamesLimiter, settingsController.testApiGamesAdmin);

// Profil admin yang sedang login
router.get("/me", authMiddleware, settingsController.getMe);
router.put("/me", authMiddleware, settingsController.updateMe);

module.exports = router;
