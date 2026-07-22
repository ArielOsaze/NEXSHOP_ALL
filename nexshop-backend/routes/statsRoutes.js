const express = require("express");
const router = express.Router();
const statsController = require("../controllers/statsController");
const authMiddleware = require("../middleware/authMiddleware");

router.get("/public", statsController.getPublicOverview); // publik, tanpa auth — buat trust bar di halaman utama
router.get("/overview", authMiddleware, statsController.getOverview);

module.exports = router;
