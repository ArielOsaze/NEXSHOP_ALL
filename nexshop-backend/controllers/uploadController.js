const supabase = require("../config/db");
const { createWebpFileName, optimizeImageToWebp } = require("../utils/imageOptimizer");

// Bucket Supabase Storage per jenis upload. Pastikan ketiga bucket ini sudah
// dibuat di Supabase Storage (public) sebelum dipakai: "products", "promo", "logos", "mascots".
const BUCKETS = {
    product: "products",
    promo: "promo",
    logo: "logos",
    mascot: "mascots"
};

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

async function uploadImage(req, res) {
    try {
        if (req.user.role !== "admin") {
            return res.status(403).json({ message: "Akses ditolak, khusus admin" });
        }

        if (!req.file) {
            return res.status(400).json({ message: "File tidak ditemukan" });
        }

        if (!ALLOWED_MIME_TYPES.includes(req.file.mimetype)) {
            return res.status(400).json({ message: "File harus berupa gambar (JPG, PNG, WEBP, atau GIF)" });
        }

        const type = req.query.type || "product";
        const bucket = BUCKETS[type] || BUCKETS.product;

        const preset = type === "logo" ? "logo" : type === "promo" ? "promo" : "product";
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
        console.error(err);
        res.status(500).json({
            message: process.env.NODE_ENV === "production" ? "Terjadi kesalahan pada server" : (err.message || "Server Error")
        });
    }
}

module.exports = { uploadImage };
