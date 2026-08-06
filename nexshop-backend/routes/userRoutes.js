const express = require("express");
const router = express.Router();
const userController = require("../controllers/userController");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const { requireAdminPin } = require("../middleware/adminPinMiddleware");

// All account data and mutations are sensitive. POST avoids accepting a PIN in
// a query string and every route verifies it independently (no trusted session).
router.post("/list", authMiddleware, adminMiddleware, requireAdminPin, userController.getUsers);
router.post("/otp", authMiddleware, adminMiddleware, requireAdminPin, userController.getPendingOtp);
router.post("/:id/detail", authMiddleware, adminMiddleware, requireAdminPin, userController.getUserDetail);
router.put("/:id", authMiddleware, adminMiddleware, requireAdminPin, userController.updateUser);
router.post("/:id/resend-otp", authMiddleware, adminMiddleware, requireAdminPin, userController.adminResendOtp);
router.delete("/:id", authMiddleware, adminMiddleware, requireAdminPin, userController.deleteUser);

module.exports = router;
