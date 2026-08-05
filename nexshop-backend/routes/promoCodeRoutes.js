const express = require("express");
const router = express.Router();
const promoCodeController = require("../controllers/promoCodeController");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");

// Publik — validasi kode dari halaman toko
router.post("/validate", promoCodeController.validate);

// Admin
router.get("/", authMiddleware, adminMiddleware, promoCodeController.getAll);
router.post("/", authMiddleware, adminMiddleware, promoCodeController.create);
router.put("/:id", authMiddleware, adminMiddleware, promoCodeController.update);
router.delete("/:id", authMiddleware, adminMiddleware, promoCodeController.remove);

module.exports = router;
