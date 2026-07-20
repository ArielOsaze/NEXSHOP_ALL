const express = require("express");
const multer = require("multer");
const router = express.Router();
const promoController = require("../controllers/promoController");
const authMiddleware = require("../middleware/authMiddleware");

const upload = multer({ storage: multer.memoryStorage() });

router.get("/", promoController.getSlides);                          // publik, buat carousel di toko
router.get("/all", authMiddleware, promoController.getAllSlidesAdmin); // admin, termasuk yg nonaktif
router.post("/", authMiddleware, upload.single("image"), promoController.createSlide);
router.put("/:id", authMiddleware, upload.single("image"), promoController.updateSlide);
router.delete("/:id", authMiddleware, promoController.deleteSlide);

module.exports = router;
