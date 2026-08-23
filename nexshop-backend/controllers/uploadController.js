const crypto = require("crypto");
const supabase = require("../config/db");
const { createWebpFileName, optimizeImageToWebp } = require("../utils/imageOptimizer");
const {
    encryptDocument,
    buildDocumentRef,
    KycKeyMissingError
} = require("../utils/secureDocument");

// Bucket Supabase Storage per jenis upload. Pastikan ketiga bucket ini sudah
// dibuat di Supabase Storage (public) sebelum dipakai: "products", "promo", "logos", "mascots".
const BUCKETS = {
    product: "products",
    promo: "promo",
    logo: "logos",
    mascot: "mascots",
    avatar: "avatars",
    music: "music",
    music_cover: "music"
};

// Dokumen identitas TIDAK boleh satu bucket dengan avatar.
//
// Sebelumnya kyc & ktp dipetakan ke bucket "avatars" yang publik, lalu
// getPublicUrl() mengembalikan URL yang bisa dibuka siapa saja tanpa login.
// Artinya foto KTP mitra reseller praktis terpajang di internet begitu
// URL-nya bocor sekali saja.
//
// Bucket di bawah HARUS dibuat sebagai bucket PRIVAT di Supabase Storage.
// Isinya pun sudah dienkripsi AES-256-GCM lebih dulu (lihat
// utils/secureDocument.js), jadi meskipun bucket-nya salah dikonfigurasi
// jadi publik, yang terunduh cuma blob acak tanpa kunci.
const KYC_BUCKET = process.env.SUPABASE_KYC_BUCKET || "kyc-documents";
const KYC_TYPES = ["kyc", "ktp"];

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const ALLOWED_AUDIO_MIME_TYPES = ["audio/mpeg", "audio/wav", "audio/ogg"];

async function uploadImage(req, res) {
    try {
        const type = req.query.type || "product";
        const isKycType = KYC_TYPES.includes(type);
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

        // ==========================================================
        // JALUR KHUSUS DOKUMEN IDENTITAS (KYC / FOTO KTP)
        //
        // Berbeda dari gambar lain, dokumen ini:
        //   * dikompres dulu ke WebP (buang EXIF -- foto KTP dari HP hampir
        //     selalu membawa koordinat GPS tempat foto diambil),
        //   * lalu DIENKRIPSI sebelum diunggah,
        //   * disimpan di bucket privat,
        //   * dan yang dikembalikan ke client adalah REFERENSI OPAK
        //     ("kyc:<path>"), bukan URL yang bisa dibuka langsung.
        //
        // Foto KTP hanya bisa dilihat admin lewat endpoint terautentikasi
        // GET /api/reseller/admin/kyc-document yang mendekripsi on-the-fly.
        // ==========================================================
        if (isKycType) {
            const optimized = await optimizeImageToWebp(req.file.buffer, "product");

            let terenkripsi;
            try {
                terenkripsi = encryptDocument(optimized.buffer);
            } catch (kunciErr) {
                if (kunciErr instanceof KycKeyMissingError) {
                    console.error("Upload KYC ditolak:", kunciErr.message);
                    return res.status(503).json({
                        message: "Penyimpanan dokumen identitas belum siap di server. Hubungi admin NexShop.",
                        code: kunciErr.code
                    });
                }
                throw kunciErr;
            }

            // Nama objek acak penuh -- tidak memuat nama, email, atau id user,
            // supaya isi bucket tidak bisa dikaitkan ke orang tertentu hanya
            // dari daftar nama berkasnya.
            const objectPath = "kyc/" + new Date().toISOString().slice(0, 7) + "/" + crypto.randomUUID() + ".bin";

            const { error: kycErr } = await supabase.storage
                .from(KYC_BUCKET)
                .upload(objectPath, terenkripsi.payload, {
                    contentType: "application/octet-stream",
                    cacheControl: "no-store",
                    upsert: false
                });

            if (kycErr) throw kycErr;

            return res.json({
                // Nama field tetap "url" demi kompatibilitas dengan form yang
                // sudah ada, tapi ISINYA kini referensi opak, bukan URL.
                url: buildDocumentRef(objectPath),
                ref: buildDocumentRef(objectPath),
                encrypted: true,
                algorithm: terenkripsi.algorithm,
                // Sidik jari berkas asli: dipakai admin untuk mendeteksi satu
                // foto KTP dipakai ulang oleh banyak pendaftar.
                sha256: terenkripsi.sha256,
                originalBytes: optimized.originalBytes,
                storedBytes: terenkripsi.payload.length
            });
        }

        const bucket = BUCKETS[type] || BUCKETS.product;

        const PRESET_MAP = { logo: "logo", promo: "promo", avatar: "avatar" };
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
