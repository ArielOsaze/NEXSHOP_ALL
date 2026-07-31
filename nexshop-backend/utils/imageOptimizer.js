const crypto = require("crypto");
const sharp = require("sharp");

// Batas dimensi mengikuti ukuran tampilan terbesar di toko. File yang lebih
// kecil tidak pernah diperbesar, sehingga detail sumber tetap terjaga.
const IMAGE_PRESETS = Object.freeze({
    product: { width: 1600, height: 1600 },
    logo: { width: 1024, height: 1024 },
    promo: { width: 2560, height: 1440 },
    promoMobile: { width: 1600, height: 2560 }
});

const MAX_INPUT_PIXELS = 64 * 1000 * 1000;

function createWebpFileName() {
    return `webp/${Date.now()}-${crypto.randomUUID()}.webp`;
}

/**
 * Mengubah gambar raster menjadi WebP berkualitas tinggi. Metadata EXIF,
 * thumbnail, dan profil warna yang tidak dibutuhkan tidak ikut disimpan;
 * rotate() tetap menerapkan orientasi dari kamera sebelum metadata dibuang.
 */
async function optimizeImageToWebp(buffer, presetName = "product") {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw new Error("Data gambar kosong atau tidak valid");
    }

    const preset = IMAGE_PRESETS[presetName] || IMAGE_PRESETS.product;
    const { data, info } = await sharp(buffer, {
        animated: true,
        limitInputPixels: MAX_INPUT_PIXELS
    })
        .rotate()
        .resize({
            width: preset.width,
            height: preset.height,
            fit: "inside",
            withoutEnlargement: true
        })
        .webp({
            quality: 86,
            alphaQuality: 100,
            effort: 6,
            smartSubsample: true
        })
        .toBuffer({ resolveWithObject: true });

    return {
        buffer: data,
        contentType: "image/webp",
        width: info.width,
        height: info.height,
        originalBytes: buffer.length,
        optimizedBytes: data.length
    };
}

module.exports = {
    IMAGE_PRESETS,
    createWebpFileName,
    optimizeImageToWebp
};
