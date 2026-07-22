const express = require("express");
const router = express.Router();
const userController = require("../controllers/userController");
const authMiddleware = require("../middleware/authMiddleware");

router.get("/", authMiddleware, userController.getUsers);
router.get("/:id/detail", authMiddleware, userController.getUserDetail);
router.put("/:id", authMiddleware, userController.updateUser);

module.exports = router;
