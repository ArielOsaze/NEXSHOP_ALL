"use strict";

const OUT_OF_SCOPE_REPLY = "Maaf, NexBot hanya dapat membantu pertanyaan tentang produk, layanan, transaksi, akun, Marketplace, dan program reseller NexShop. Silakan kirim pertanyaan yang berkaitan dengan NexShop.";

const DOMAIN_PATTERN = /\b(?:nexshop|nexbot|top\s?up|diamond|game\s?pass|mobile\s+legends|mlbb|free\s+fire|pubg|valorant|steam|playstation|nintendo|xbox|marketplace|ppob|e-?wallet|dana|ovo|gopay|shopeepay|linkaja|pulsa|paket\s+data|kuota|pln|token\s+listrik|pdam|bpjs|ipaymu|qris|virtual\s+account|checkout|keranjang|pesanan|order\s+id|refund|escrow|wallet|saldo|reseller|partner\s+portal|portal\s+reseller|kyc|tier|customer\s+service|whatsapp\s+admin|user\s+id|zone\s+id|pengembalian\s+dana|uang\s+kembali|2fa|authenticator|recovery\s+code|ktp|nik|(?:menghubungi|hubungi)\s+(?:cs|customer\s+service|admin|kami|siapa))\b/i;
const CUSTOMER_CARE_PATTERN = /\b(?:produk(?:\s+digital)?|barang|voucher|tagihan|cara\s+(?:checkout|top\s*up)|(?:beli|membeli|pesan)\s+(?:produk|barang)|checkout|keranjang|pesanan|order|pembayaran|transaksi|akun|login|masuk|password|harga\s+produk|bantuan|customer\s+care)\b/i;
const OUTSIDE_PATTERN = /\b(?:presiden|menteri|pemilu|politik|cuaca|prakiraan\s+cuaca|resep|masak|nasi\s+goreng|sepak\s*bola|pertandingan|liga\s+(?:inggris|spanyol|italia)|diagnosis|diagnosa|obat|sakit\s+kepala|kode\s+(?:python|javascript|java|php)|program\s+python|scraping|skripsi|puisi|lirik\s+lagu|zodiak|horoskop|wisata|hotel|tiket\s+pesawat)\b/i;
const GREETING_PATTERN = /^(?:halo|hai|hi|hello|hey|selamat\s+(?:pagi|siang|sore|malam)|terima\s+kasih|makasih|thanks)\b/i;

function conversationHasDomain(memory) {
    return (memory?.conversation || []).slice(-4).some((turn) => DOMAIN_PATTERN.test(String(turn?.message || "")));
}

function isNexShopScope(message, context = {}) {
    const text = String(message || "").replace(/\s+/g, " ").trim();
    if (!text) return false;
    if (GREETING_PATTERN.test(text) && text.length <= 80) return true;

    const explicitNexShop = /\b(?:nexshop|nexbot)\b/i.test(text);
    // Brand mention tidak boleh menjadi bypass untuk topik asing seperti
    // resep, politik, kesehatan, atau pembuatan kode. Bila user menyebut
    // NexShop dalam konteks tersebut, tetap arahkan kembali ke scope produk.
    if (OUTSIDE_PATTERN.test(text)) return false;
    if (DOMAIN_PATTERN.test(text) || CUSTOMER_CARE_PATTERN.test(text)) return true;
    if (Array.isArray(context.entities) && context.entities.length > 0) return true;

    // Pertanyaan lanjutan pendek seperti "kalau yang itu gimana?" hanya boleh
    // mewarisi scope bila percakapan sebelumnya memang membahas NexShop.
    if (text.length <= 120 && conversationHasDomain(context.memory)) return true;
    return false;
}

const DECORATIVE_EMOJI_PATTERN = /[📦💎📋✅⏳❌🚀✨🔐🛡🤝🎉🔥⚡]/gu;

function splitLongParagraph(paragraph) {
    if (paragraph.length <= 320 || /^[-\d]+[.)]\s/.test(paragraph)) return paragraph;
    const sentences = paragraph.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((part) => part.trim()).filter(Boolean) || [];
    if (sentences.length < 3) return paragraph;
    return `${sentences[0]}\n\n${sentences.slice(1).map((sentence) => `- ${sentence}`).join("\n")}`;
}

function formatProfessionalReply(value) {
    let text = String(value || "")
        .replace(/\r\n?/g, "\n")
        .replace(DECORATIVE_EMOJI_PATTERN, "")
        .replace(/[\uFE0E\uFE0F]/g, "")
        .replace(/^\s*#{1,6}\s*/gm, "")
        .replace(/^\s*[•●▪◦]\s*/gm, "- ")
        .replace(/[ \t]+$/gm, "")
        .replace(/^[ \t]+/gm, (indent) => indent.length > 3 ? "" : indent)
        .replace(/\n{3,}/g, "\n\n")
        .trim();

    if (!text) return "Informasi NexShop belum dapat ditampilkan saat ini. Silakan coba lagi.";

    text = text
        .split(/\n{2}/)
        .map((paragraph) => splitLongParagraph(paragraph.trim()))
        .filter(Boolean)
        .join("\n\n")
        .replace(/\n{3,}/g, "\n\n");

    return text;
}

module.exports = {
    DOMAIN_PATTERN,
    CUSTOMER_CARE_PATTERN,
    OUTSIDE_PATTERN,
    OUT_OF_SCOPE_REPLY,
    isNexShopScope,
    formatProfessionalReply
};
