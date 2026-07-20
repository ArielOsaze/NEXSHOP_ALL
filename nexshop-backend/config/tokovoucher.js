const axios = require("axios");
const crypto = require("crypto");
const { getApiKeys } = require("./settings");

const BASE_URL = "https://api.tokovoucher.net";

function md5(str) {
    return crypto.createHash("md5").update(str).digest("hex");
}

// Signature "default" TokoVoucher (dipakai buat cek saldo & list produk):
// md5(member_code:secret)
function buildDefaultSignature(memberCode, secret) {
    return md5(`${memberCode}:${secret}`);
}

// Signature khusus per-transaksi (dipakai buat cek status & validasi webhook):
// md5(member_code:secret:ref_id)
function buildRefSignature(memberCode, secret, refId) {
    return md5(`${memberCode}:${secret}:${refId}`);
}

async function getCreds() {
    const keys = await getApiKeys();
    if (!keys.tokovoucher_member_code || !keys.tokovoucher_secret) {
        throw new Error("TokoVoucher Member Code/Secret belum diisi (Settings > API Keys)");
    }
    return {
        memberCode: keys.tokovoucher_member_code,
        secret: keys.tokovoucher_secret
    };
}

// Cek saldo akun TokoVoucher — dipakai admin buat monitoring saldo di dashboard
async function checkBalance() {
    const { memberCode, secret } = await getCreds();
    const signature = buildDefaultSignature(memberCode, secret);
    const { data } = await axios.get(`${BASE_URL}/member`, {
        params: { member_code: memberCode, signature }
    });
    return data;
}

// Cari produk berdasarkan kode/prefix, mis. "ML" buat semua produk Mobile Legends
async function searchProducts(kode) {
    const { memberCode, secret } = await getCreds();
    const signature = buildDefaultSignature(memberCode, secret);
    const { data } = await axios.get(`${BASE_URL}/produk/code`, {
        params: { member_code: memberCode, signature, kode }
    });
    return data;
}

// Ambil seluruh katalog produk (kategori, operator, jenis, produk) sekaligus —
// dipakai saat admin klik "Sync Produk" di dashboard Topup Diamond
async function getFullCatalog() {
    const { memberCode, secret } = await getCreds();
    const signature = buildDefaultSignature(memberCode, secret);
    const { data } = await axios.get(`${BASE_URL}/member/produk/full`, {
        params: { member_code: memberCode, signature }
    });
    return data;
}

// Eksekusi transaksi topup (dipanggil setelah pembayaran Midtrans berhasil)
async function createTransaction({ refId, kodeProduk, tujuan, serverId }) {
    const { memberCode, secret } = await getCreds();
    const params = {
        ref_id: refId,
        produk: kodeProduk,
        tujuan: serverId ? `${tujuan}|${serverId}` : tujuan,
        member_code: memberCode,
        secret
    };
    const { data } = await axios.get(`${BASE_URL}/v1/transaksi`, { params });
    return data;
}

// Cek status transaksi yang sudah pernah dibuat (buat retry/polling manual)
async function checkStatus(refId) {
    const { memberCode, secret } = await getCreds();
    const signature = buildRefSignature(memberCode, secret, refId);
    const { data } = await axios.get(`${BASE_URL}/v1/transaksi/status`, {
        params: { ref_id: refId, member_code: memberCode, signature }
    });
    return data;
}

// Validasi header webhook yang dikirim TokoVoucher ke server kita:
// X-TokoVoucher-Authorization = md5(member_code:secret:ref_id)
async function verifyWebhookSignature(headerSignature, refId) {
    const { memberCode, secret } = await getCreds();
    const expected = buildRefSignature(memberCode, secret, refId);
    return headerSignature && expected === headerSignature;
}

module.exports = {
    checkBalance,
    searchProducts,
    getFullCatalog,
    createTransaction,
    checkStatus,
    verifyWebhookSignature
};
