const express = require("express");
const router = express.Router();
const notificationController = require("../controllers/notificationController");
const authMiddleware = require("../middleware/authMiddleware");

router.get("/", authMiddleware, notificationController.list);
router.put("/mark-read", authMiddleware, notificationController.markAllRead);

module.exports = router;
