/**
 * Normalisasi nomor HP Indonesia untuk API Fonnte (membutuhkan format 628...)
 */
function normalizePhoneNumber(phone) {
    if (!phone || typeof phone !== "string") return "";
    
    // Hapus semua karakter non-digit
    let cleaned = phone.replace(/\D/g, "");
    
    // Jika berawalan 08, ganti jadi 628
    if (cleaned.startsWith("08")) {
        cleaned = "62" + cleaned.substring(1);
    }
    
    // Jika tidak diawali 62 tapi sudah valid (meskipun jarang, mungkin user iseng), biarkan atau paksa?
    // Asumsi kita hanya handle nomor Indonesia untuk Fonnte
    if (!cleaned.startsWith("62")) {
        // Jika berawalan 8 (misal user masukin 8123), tambahkan 62
        if (cleaned.startsWith("8")) {
            cleaned = "62" + cleaned;
        }
    }
    
    return cleaned;
}

module.exports = { normalizePhoneNumber };
