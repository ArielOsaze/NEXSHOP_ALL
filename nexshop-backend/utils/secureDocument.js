const crypto = require("crypto");

// ===========================================================
// ENKRIPSI DOKUMEN IDENTITAS (KYC / FOTO KTP)
//
// Masalah yang diperbaiki:
// Foto KTP mitra reseller sebelumnya diunggah ke bucket Supabase "avatars"
// yang BERSIFAT PUBLIK, lalu URL publiknya disimpan apa adanya di kolom
// reseller_applications.ktp_url. Konsekuensinya:
//   * Siapa pun yang memegang URL itu bisa membuka foto KTP orang lain --
//     tanpa login, tanpa batas waktu. URL semacam ini gampang bocor lewat
//     riwayat browser, log proxy, header Referer, atau screenshot panel
//     admin yang diteruskan ke orang lain.
//   * NIK + foto KTP adalah data pribadi yang bersifat spesifik menurut
//     UU PDP; menyimpannya di penyimpanan yang bisa dibaca publik bukan
//     sekadar bug, tapi masalah kepatuhan.
//
// Cara kerja sekarang:
//   1. Berkas dienkripsi di memori dengan AES-256-GCM SEBELUM menyentuh
//      storage. GCM dipilih karena sekaligus memberi authentication tag --
//      berkas yang diubah-ubah di storage akan gagal didekripsi, bukan
//      diam-diam menghasilkan gambar rusak.
//   2. Kunci diturunkan dari env KYC_ENCRYPTION_KEY memakai scrypt, jadi
//      env boleh berupa passphrase biasa (tidak harus 32 byte persis).
//   3. Setiap berkas memakai IV acak 12 byte. IV, tag, dan salt disimpan
//      di header berkas terenkripsi, jadi tidak perlu tabel tambahan.
//   4. SHA-256 dari berkas ASLI ikut dikembalikan sebagai sidik jari --
//      dipakai untuk memeriksa integritas dan mendeteksi satu foto KTP
//      yang sama dipakai berulang oleh banyak pendaftar.
//
// Format berkas terenkripsi (biner):
//   magic "NXKYC1" (6) | salt (16) | iv (12) | tag (16) | ciphertext (sisa)
// ===========================================================

const MAGIC = Buffer.from("NXKYC1", "utf8");
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;

class KycKeyMissingError extends Error {
    constructor() {
        super(
            "KYC_ENCRYPTION_KEY belum di-set. Dokumen identitas tidak boleh disimpan tanpa enkripsi, " +
            "jadi upload KTP sengaja ditolak sampai kunci ini dikonfigurasi."
        );
        this.name = "KycKeyMissingError";
        this.code = "KYC_KEY_MISSING";
        this.status = 503;
    }
}

function getMasterSecret() {
    const secret = process.env.KYC_ENCRYPTION_KEY;
    if (!secret || String(secret).trim().length < 16) {
        throw new KycKeyMissingError();
    }
    return String(secret).trim();
}

// Kunci diturunkan per-berkas (salt berbeda tiap berkas) supaya bocornya
// satu kunci turunan tidak otomatis membuka berkas lain.
function deriveKey(secret, salt) {
    return crypto.scryptSync(secret, salt, KEY_LEN);
}

/**
 * Sidik jari berkas asli. Dipakai untuk integritas & deteksi duplikat.
 * @returns {string} hex SHA-256
 */
function hashDocument(buffer) {
    return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * Enkripsi buffer dokumen.
 * @returns {{ payload: Buffer, sha256: string, algorithm: string }}
 */
function encryptDocument(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw new Error("Data dokumen kosong atau tidak valid");
    }

    const secret = getMasterSecret();
    const salt = crypto.randomBytes(SALT_LEN);
    const iv = crypto.randomBytes(IV_LEN);
    const key = deriveKey(secret, salt);

    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
        payload: Buffer.concat([MAGIC, salt, iv, tag, ciphertext]),
        sha256: hashDocument(buffer),
        algorithm: "aes-256-gcm"
    };
}

/**
 * Dekripsi buffer dokumen yang dihasilkan encryptDocument().
 * Melempar kalau berkas tidak dikenali atau sudah diubah (auth tag gagal).
 */
function decryptDocument(payload) {
    if (!Buffer.isBuffer(payload) || payload.length < MAGIC.length + SALT_LEN + IV_LEN + TAG_LEN) {
        throw new Error("Berkas terenkripsi tidak valid atau tidak lengkap");
    }
    if (!payload.subarray(0, MAGIC.length).equals(MAGIC)) {
        throw new Error("Berkas ini bukan dokumen KYC terenkripsi NexShop");
    }

    const secret = getMasterSecret();
    let offset = MAGIC.length;
    const salt = payload.subarray(offset, (offset += SALT_LEN));
    const iv = payload.subarray(offset, (offset += IV_LEN));
    const tag = payload.subarray(offset, (offset += TAG_LEN));
    const ciphertext = payload.subarray(offset);

    const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey(secret, salt), iv);
    decipher.setAuthTag(tag);
    // final() melempar kalau tag tidak cocok -> berkas dianggap dirusak.
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Referensi dokumen yang disimpan di database, MENGGANTIKAN URL publik.
 * Bentuknya sengaja bukan URL supaya tidak ada kode/UI yang bisa keliru
 * menempelkannya ke <img src> dan membocorkannya ke luar.
 */
function buildDocumentRef(objectPath) {
    return "kyc:" + objectPath;
}

function isDocumentRef(value) {
    return typeof value === "string" && value.startsWith("kyc:");
}

function parseDocumentRef(value) {
    if (!isDocumentRef(value)) return null;
    const objectPath = value.slice(4);
    // Tolak path traversal & path kosong.
    if (!objectPath || objectPath.includes("..") || objectPath.startsWith("/")) return null;
    if (!/^[A-Za-z0-9/_.-]+$/.test(objectPath)) return null;
    return objectPath;
}

function isKycConfigured() {
    try {
        getMasterSecret();
        return true;
    } catch (_) {
        return false;
    }
}

module.exports = {
    encryptDocument,
    decryptDocument,
    hashDocument,
    buildDocumentRef,
    parseDocumentRef,
    isDocumentRef,
    isKycConfigured,
    KycKeyMissingError
};
