const express = require("express");
const multer = require("multer");
const router = express.Router();
const promoController = require("../controllers/promoController");
const authMiddleware = require("../middleware/authMiddleware");

// Batasin ukuran file di sini juga (bukan cuma andalin client_max_body_size
// di nginx) — biar errornya jelas & konsisten baik di server yang pakai
// nginx maupun yang tidak (mis. dijalanin langsung/pakai platform lain).
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 } // 15MB
});

// Kasih pesan error yang jelas kalau file kelebihan ukuran, daripada
// biarin multer ngelempar error generik yang bikin bingung di frontend.
function handleUploadError(err, req, res, next) {
    if (err && err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ message: "Ukuran gambar terlalu besar, maksimal 15MB" });
    }
    if (err) return res.status(400).json({ message: err.message || "Gagal upload gambar" });
    next();
}

router.get("/", promoController.getSlides);                          // publik, buat carousel di toko
router.get("/all", authMiddleware, promoController.getAllSlidesAdmin); // admin, termasuk yg nonaktif
router.post("/", authMiddleware, upload.single("image"), handleUploadError, promoController.createSlide);
router.put("/:id", authMiddleware, upload.single("image"), handleUploadError, promoController.updateSlide);
router.delete("/:id", authMiddleware, promoController.deleteSlide);

module.exports = router;
