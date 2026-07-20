const express = require("express");
const router = express.Router();
const promoCodeController = require("../controllers/promoCodeController");
const authMiddleware = require("../middleware/authMiddleware");

// Publik — validasi kode dari halaman toko
router.post("/validate", promoCodeController.validate);

// Admin
router.get("/", authMiddleware, promoCodeController.getAll);
router.post("/", authMiddleware, promoCodeController.create);
router.put("/:id", authMiddleware, promoCodeController.update);
router.delete("/:id", authMiddleware, promoCodeController.remove);

module.exports = router;
