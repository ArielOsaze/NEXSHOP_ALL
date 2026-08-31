const express = require("express");
const router = express.Router();
const notificationController = require("../controllers/notificationController");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");

router.get("/", authMiddleware, adminMiddleware, notificationController.list);
router.put("/mark-read", authMiddleware, adminMiddleware, notificationController.markAllRead);

module.exports = router;
