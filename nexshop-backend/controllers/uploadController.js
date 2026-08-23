const supabase = require("../config/db");
const { createWebpFileName, optimizeImageToWebp } = require("../utils/imageOptimizer");

// Bucket Supabase Storage per jenis upload. Pastikan ketiga bucket ini sudah
// dibuat di Supabase Storage (public) sebelum dipakai: "products", "promo", "logos", "mascots".
const BUCKETS = {
    product: "products",
    promo: "promo",
    logo: "logos",
    mascot: "mascots",
    avatar: "avatars",
    kyc: "avatars",
    ktp: "avatars",
    music: "music",
    music_cover: "music"
};

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const ALLOWED_AUDIO_MIME_TYPES = ["audio/mpeg", "audio/wav", "audio/ogg"];

async function uploadImage(req, res) {
    try {
        const type = req.query.type || "product";
        const isKycType = ["kyc", "ktp"].includes(type);
        const isUserAllowedType = ["avatar", "kyc", "ktp"].includes(type);
        
        if (!isKycType) {
            const role = req.user && req.user.role;
            if (!["admin", "staff"].includes(role) && !isUserAllowedType) {
                return res.status(403).json({ message: "Akses ditolak, khusus admin" });
            }
        }

        if (!req.file) {
            return res.status(400).json({ message: "File tidak ditemukan" });
        }

        if (!ALLOWED_MIME_TYPES.includes(req.file.mimetype)) {
            return res.status(400).json({ message: "File harus berupa gambar (JPG, PNG, WEBP, atau GIF)" });
        }
        
        if (type === "avatar" && req.file.size > 5 * 1024 * 1024) {
            return res.status(400).json({ message: "Ukuran foto profil maksimal 5MB" });
        }

        if ((type === "kyc" || type === "ktp") && req.file.size > 10 * 1024 * 1024) {
            return res.status(400).json({ message: "Ukuran foto KTP maksimal 10MB" });
        }

        const bucket = BUCKETS[type] || BUCKETS.product;

        const PRESET_MAP = { logo: "logo", promo: "promo", avatar: "avatar", kyc: "product", ktp: "product" };
        const preset = PRESET_MAP[type] || "product";
        const optimizedImage = await optimizeImageToWebp(req.file.buffer, preset);
        const fileName = createWebpFileName();

        const { error } = await supabase.storage
            .from(bucket)
            .upload(fileName, optimizedImage.buffer, {
                contentType: optimizedImage.contentType,
                cacheControl: "31536000",
                upsert: false
            });

        if (error) throw error;

        const { data } = supabase.storage.from(bucket).getPublicUrl(fileName);

        res.json({
            url: data.publicUrl,
            mimeType: optimizedImage.contentType,
            originalBytes: optimizedImage.originalBytes,
            optimizedBytes: optimizedImage.optimizedBytes
        });
    } catch (err) {
        console.error("Upload error:", err.message, err.statusCode || "", err);
        res.status(500).json({
            message: process.env.NODE_ENV === "production" ? "Terjadi kesalahan pada server" : (err.message || "Server Error")
        });
    }
}

async function uploadAudio(req, res) {
    try {
        if (!["admin", "staff"].includes(req.user.role)) {
            return res.status(403).json({ message: "Akses ditolak, khusus admin" });
        }

        if (!req.file) {
            return res.status(400).json({ message: "File audio tidak ditemukan" });
        }

        if (!ALLOWED_AUDIO_MIME_TYPES.includes(req.file.mimetype)) {
            return res.status(400).json({ message: "File harus berupa audio (MP3, WAV, atau OGG)" });
        }
        
        // Batasan ukuran: 30MB untuk audio. Multer sudah block dari awal (dikonfigurasi di router), tapi kita check lagi.
        if (req.file.size > 30 * 1024 * 1024) {
            return res.status(400).json({ message: "Ukuran file audio maksimal 30MB" });
        }

        const bucket = BUCKETS.music;
        
        // Buat nama file unik (UUID + extension asli)
        const crypto = require("crypto");
        const extMap = {
            "audio/mpeg": "mp3",
            "audio/wav": "wav",
            "audio/ogg": "ogg"
        };
        const ext = extMap[req.file.mimetype] || "mp3";
        const fileName = `${crypto.randomUUID()}.${ext}`;

        const { error } = await supabase.storage
            .from(bucket)
            .upload(fileName, req.file.buffer, {
                contentType: req.file.mimetype,
                cacheControl: "31536000",
                upsert: false
            });

        if (error) throw error;

        const { data } = supabase.storage.from(bucket).getPublicUrl(fileName);

        res.json({
            url: data.publicUrl,
            mimeType: req.file.mimetype,
            originalBytes: req.file.size
        });
    } catch (err) {
        console.error("Upload audio error:", err.message, err.statusCode || "", err);
        res.status(500).json({
            message: process.env.NODE_ENV === "production" ? "Terjadi kesalahan pada server saat upload audio" : (err.message || "Server Error")
        });
    }
}

module.exports = { uploadImage, uploadAudio };
