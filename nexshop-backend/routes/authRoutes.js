const express = require("express");
const router = express.Router();

const authController = require("../controllers/authController");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const superAdminMiddleware = require("../middleware/superAdminMiddleware");
const { requireAdminPin } = require("../middleware/adminPinMiddleware");
const { loginLimiter, adminLoginLimiter, registerLimiter, otpVerifyLimiter, otpResendLimiter, forgotPasswordLimiter, resetPasswordLimiter } = require("../middleware/rateLimiter");

router.post("/register", registerLimiter, authController.register);
router.post("/login", loginLimiter, adminLoginLimiter, authController.login);
router.get("/public-config", authController.publicAuthConfig);
router.get("/google/start", authController.googleStart);
router.get("/google/callback", authController.googleCallback);
router.post("/google/exchange", authController.googleExchange);
router.get("/google/link/start", authMiddleware, authController.googleLinkStart);
router.post("/verify-otp", otpVerifyLimiter, authController.verifyOtp);
router.post("/resend-otp", otpResendLimiter, authController.resendOtp);
router.post("/forgot-password", forgotPasswordLimiter, authController.forgotPassword);
router.post("/reset-password", resetPasswordLimiter, authController.resetPassword);

// Admin — buka blokir rate-limit login untuk 1 IP (lihat authController.unlockLoginIp)
router.post("/admin/blocked-ips", authMiddleware, superAdminMiddleware, requireAdminPin, authController.listBlockedIps);
router.post("/admin/unlock-login", authMiddleware, superAdminMiddleware, requireAdminPin, authController.unlockLoginIp);

module.exports = router;
