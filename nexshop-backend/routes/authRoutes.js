const express = require("express");
const router = express.Router();

const authController = require("../controllers/authController");
const authMiddleware = require("../middleware/authMiddleware");
const { loginLimiter, registerLimiter, otpVerifyLimiter, otpResendLimiter, forgotPasswordLimiter } = require("../middleware/rateLimiter");

router.post("/register", registerLimiter, authController.register);
router.post("/login", loginLimiter, authController.login);
router.post("/verify-otp", otpVerifyLimiter, authController.verifyOtp);
router.post("/resend-otp", otpResendLimiter, authController.resendOtp);
router.post("/forgot-password", forgotPasswordLimiter, authController.forgotPassword);
router.post("/reset-password", authController.resetPassword);

// Admin — buka blokir rate-limit login untuk 1 IP (lihat authController.unlockLoginIp)
router.post("/admin/unlock-login", authMiddleware, authController.unlockLoginIp);

module.exports = router;
