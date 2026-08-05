const express = require("express");
const router = express.Router();
const userController = require("../controllers/userController");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");

router.get("/", authMiddleware, adminMiddleware, userController.getUsers);
router.get("/otp", authMiddleware, adminMiddleware, userController.getPendingOtp);
router.get("/:id/detail", authMiddleware, adminMiddleware, userController.getUserDetail);
router.put("/:id", authMiddleware, adminMiddleware, userController.updateUser);
router.post("/:id/resend-otp", authMiddleware, adminMiddleware, userController.adminResendOtp);
router.delete("/:id", authMiddleware, adminMiddleware, userController.deleteUser);

module.exports = router;
