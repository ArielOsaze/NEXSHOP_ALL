const express = require("express");
const router = express.Router();
const userController = require("../controllers/userController");
const authMiddleware = require("../middleware/authMiddleware");

router.get("/", authMiddleware, userController.getUsers);
router.get("/otp", authMiddleware, userController.getPendingOtp);
router.get("/:id/detail", authMiddleware, userController.getUserDetail);
router.put("/:id", authMiddleware, userController.updateUser);
router.post("/:id/resend-otp", authMiddleware, userController.adminResendOtp);
router.delete("/:id", authMiddleware, userController.deleteUser);

module.exports = router;
