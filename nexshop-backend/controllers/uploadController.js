const supabase = require("../config/db");

// Bucket Supabase Storage per jenis upload. Pastikan ketiga bucket ini sudah
// dibuat di Supabase Storage (public) sebelum dipakai: "products", "promo", "logos".
const BUCKETS = {
    product: "products",
    promo: "promo",
    logo: "logos"
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

        const ext = req.file.originalname.split(".").pop();
        const fileName = Date.now() + "-" + Math.random().toString(36).substring(2, 8) + "." + ext;

        const { error } = await supabase.storage
            .from(bucket)
            .upload(fileName, req.file.buffer, {
                contentType: req.file.mimetype,
                upsert: false
            });

        if (error) throw error;

        const { data } = supabase.storage.from(bucket).getPublicUrl(fileName);

        res.json({ url: data.publicUrl });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: err.message });
    }
}

module.exports = { uploadImage };
