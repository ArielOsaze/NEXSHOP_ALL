const express = require("express");
const multer = require("multer");
const { uploadImage } = require("../controllers/uploadController");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

// Batasin ukuran file di sini juga (bukan cuma andalin client_max_body_size
// di nginx) — biar errornya jelas & konsisten baik di server yang pakai
// nginx maupun yang tidak.
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

// Sebelumnya endpoint ini publik total (gak ada authMiddleware) — siapapun
// di internet bisa upload file ke storage kita tanpa login sama sekali.
// Dipakai cuma buat gambar produk/promo/logo dari admin dashboard, jadi
// wajib login (role admin dicek di uploadController).
router.post("/", authMiddleware, upload.single("image"), handleUploadError, uploadImage);

module.exports = router;
