const express = require("express");
const router = express.Router();
const userController = require("../controllers/userController");
const authMiddleware = require("../middleware/authMiddleware");
const superAdminMiddleware = require("../middleware/superAdminMiddleware");
const { requireAdminPin } = require("../middleware/adminPinMiddleware");
const { otpVerifyLimiter, otpResendLimiter } = require("../middleware/rateLimiter");

// All account data and mutations are sensitive. POST avoids accepting a PIN in
// a query string and every route verifies it independently (no trusted session).
router.post("/list", authMiddleware, superAdminMiddleware, requireAdminPin, userController.getUsers);
router.post("/otp", authMiddleware, superAdminMiddleware, requireAdminPin, userController.getPendingOtp);
router.post("/:id/detail", authMiddleware, superAdminMiddleware, requireAdminPin, userController.getUserDetail);
router.get("/me", authMiddleware, userController.getOwnProfile);
router.put("/me", authMiddleware, userController.updateOwnProfile);
router.put("/me/avatar", authMiddleware, userController.updateOwnAvatar);
router.put("/me/phone", authMiddleware, otpResendLimiter, userController.updateOwnPhone);
router.post("/me/phone/verify", authMiddleware, otpVerifyLimiter, userController.verifyOwnPhone);
router.put("/:id", authMiddleware, superAdminMiddleware, requireAdminPin, userController.updateUser);
router.post("/:id/resend-otp", authMiddleware, superAdminMiddleware, requireAdminPin, userController.adminResendOtp);
router.delete("/:id", authMiddleware, superAdminMiddleware, requireAdminPin, userController.deleteUser);

module.exports = router;
