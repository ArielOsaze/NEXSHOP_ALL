const express = require("express");
const multer = require("multer");
const jwt = require("jsonwebtoken");
const { uploadImage, uploadAudio } = require("../controllers/uploadController");
const authMiddleware = require("../middleware/authMiddleware");
const superAdminMiddleware = require("../middleware/superAdminMiddleware");
const { kycUploadLimiter } = require("../middleware/rateLimiter");

const router = express.Router();

// Batasin ukuran file di sini juga (bukan cuma andalin client_max_body_size
// di nginx) — biar errornya jelas & konsisten baik di server yang pakai
// nginx maupun yang tidak.
const uploadImageConfig = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
    fileFilter: (_req, file, cb) => {
        const allowed = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
        if (!allowed.has(file.mimetype)) return cb(new Error("File harus berupa gambar JPG, PNG, WEBP, atau GIF"));
        cb(null, true);
    }
});

const uploadAudioConfig = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 30 * 1024 * 1024 } // 30MB untuk MP3/WAV
});

// Kasih pesan error yang jelas kalau file kelebihan ukuran, daripada
// biarin multer ngelempar error generik yang bikin bingung di frontend.
function handleUploadError(err, req, res, next) {
    if (err && err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ message: "Ukuran file terlalu besar (Maks 15MB Gambar, 30MB Audio)" });
    }
    if (err) return res.status(400).json({ message: err.message || "Gagal upload file" });
    next();
}

// Middleware upload auth: Izinkan pendaftar mitra baru mengunggah foto KTP (type=kyc / type=ktp)
// tanpa harus login terlebih dahulu. Untuk type lainnya, tetap wajib auth (admin/user).
function uploadImageAuth(req, res, next) {
    const type = req.query.type || "product";
    if (type === "kyc" || type === "ktp") {
        const authHeader = req.headers.authorization;
        if (authHeader) {
            const match = authHeader.match(/^Bearer\s+(.+)$/i);
            if (match) {
                try {
                    req.user = jwt.verify(match[1], process.env.JWT_SECRET);
                } catch (_) {}
            }
        }
        return next();
    }
    return authMiddleware(req, res, next);
}

function sensitiveImageAuth(req, res, next) {
    const type = String(req.query.type || "product").toLowerCase();
    if (type === "logo" || type === "mascot") return superAdminMiddleware(req, res, next);
    return uploadImageAuth(req, res, next);
}

function limitAnonymousKyc(req, res, next) {
    const type = String(req.query.type || "").toLowerCase();
    if (type === "kyc" || type === "ktp") return kycUploadLimiter(req, res, next);
    next();
}

router.post("/image", limitAnonymousKyc, sensitiveImageAuth, uploadImageConfig.single("image"), handleUploadError, uploadImage);
// Note: Backwards compatibility untuk endpoint lama ("/")
router.post("/", limitAnonymousKyc, sensitiveImageAuth, uploadImageConfig.single("image"), handleUploadError, uploadImage);

// Music player adalah konfigurasi dashboard, jadi asset audio juga khusus Admin.
router.post("/audio", authMiddleware, superAdminMiddleware, uploadAudioConfig.single("audio"), handleUploadError, uploadAudio);

module.exports = router;
