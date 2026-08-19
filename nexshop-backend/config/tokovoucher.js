const axios = require("axios");
const crypto = require("crypto");
const https = require("https");
const { getApiKeys } = require("./settings");

const BASE_URL = "https://api.tokovoucher.net";

const api = axios.create({
    baseURL: BASE_URL,
    httpsAgent: new https.Agent({ family: 4 })
});

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
    const { data } = await api.get(`/member`, {
        params: { member_code: memberCode, signature }
    });
    return data;
}

// Cari produk berdasarkan kode/prefix, mis. "ML" buat semua produk Mobile Legends
async function searchProducts(kode) {
    const { memberCode, secret } = await getCreds();
    const signature = buildDefaultSignature(memberCode, secret);
    const { data } = await api.get(`/produk/code`, {
        params: { member_code: memberCode, signature, kode }
    });
    return data;
}

// Ambil seluruh katalog produk (kategori, operator, jenis, produk) sekaligus —
// dipakai saat admin klik "Sync Produk" di dashboard Topup Diamond
async function getFullCatalog() {
    const { memberCode, secret } = await getCreds();
    const signature = buildDefaultSignature(memberCode, secret);
    const { data } = await api.get(`/member/produk/full`, {
        params: { member_code: memberCode, signature }
    });
    return data;
}

// Hierarchical API Fallbacks untuk sinkronisasi katalog
async function getCategories() {
    const { memberCode, secret } = await getCreds();
    const signature = buildDefaultSignature(memberCode, secret);
    const { data } = await api.get(`/member/produk/category/list`, {
        params: { member_code: memberCode, signature }
    });
    return data;
}

async function getOperators(categoryId) {
    const { memberCode, secret } = await getCreds();
    const signature = buildDefaultSignature(memberCode, secret);
    const { data } = await api.get(`/member/produk/operator/list`, {
        params: { member_code: memberCode, signature, id_kategori: categoryId }
    });
    return data;
}

async function getJenisProduk(operatorId) {
    const { memberCode, secret } = await getCreds();
    const signature = buildDefaultSignature(memberCode, secret);
    const { data } = await api.get(`/member/produk/jenis/list`, {
        params: { member_code: memberCode, signature, id_operator: operatorId }
    });
    return data;
}

async function getProdukList(jenisId) {
    const { memberCode, secret } = await getCreds();
    const signature = buildDefaultSignature(memberCode, secret);
    const { data } = await api.get(`/member/produk/list`, {
        params: { member_code: memberCode, signature, id_jenis: jenisId }
    });
    return data;
}

// Eksekusi transaksi topup (dipanggil setelah pembayaran iPaymu berhasil)
//
// PENTING: tujuan & server_id dikirim sebagai parameter TERPISAH ke TokoVoucher
// (sesuai dokumentasi resmi mereka: .../transaksi?...&tujuan=[tujuan]&server_id=[server_id]).
// Sebelumnya kode ini malah menggabungkan manual jadi "tujuan|server_id" dalam satu
// string -- itu yang bikin error "bad user id ... strconv.ParseInt: parsing
// \"60034816|\": invalid syntax" pas checkout Diamond ML: user_id yang sampai ke
// backend TokoVoucher ikutan kebawa karakter "|" nya, jadi gagal di-parse sebagai
// angka murni. Kirim terpisah = server_id-nya diproses TokoVoucher sendiri, tujuan
// tetap bersih cuma angka player id.
async function createTransaction({ refId, kodeProduk, tujuan, serverId }) {
    const { memberCode, secret } = await getCreds();
    const params = {
        ref_id: refId,
        produk: kodeProduk,
        tujuan,
        member_code: memberCode,
        secret
    };
    if (serverId) {
        params.server_id = serverId;
    }
    const { data } = await api.get(`/v1/transaksi`, { params });
    return data;
}

// Cek status transaksi yang sudah pernah dibuat (buat retry/polling manual)
async function checkStatus(refId) {
    const { memberCode, secret } = await getCreds();
    const signature = buildRefSignature(memberCode, secret, refId);
    const { data } = await api.get(`/v1/transaksi/status`, {
        params: { ref_id: refId, member_code: memberCode, signature }
    });
    return data;
}

// Validasi header webhook yang dikirim TokoVoucher ke server kita:
// X-TokoVoucher-Authorization = md5(member_code:secret:ref_id)
async function verifyWebhookSignature(headerSignature, refId) {
    const { memberCode, secret } = await getCreds();
    const expected = buildRefSignature(memberCode, secret, refId);

    // Pakai perbandingan timing-safe (bukan `===`) -- perbandingan string
    // biasa berhenti di karakter pertama yang beda, jadi teorinya bisa
    // dipakai buat nebak signature karakter-demi-karakter lewat selisih
    // waktu respons (timing attack). timingSafeEqual butuh dua Buffer
    // dengan PANJANG SAMA, makanya dicek dulu panjangnya sebelum dibanding
    // (kalau panjangnya beda, otomatis dianggap tidak valid).
    if (!headerSignature || typeof headerSignature !== "string") return false;
    const expectedBuf = Buffer.from(expected, "utf8");
    const receivedBuf = Buffer.from(headerSignature, "utf8");
    if (expectedBuf.length !== receivedBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

module.exports = {
    checkBalance,
    searchProducts,
    getFullCatalog,
    getCategories,
    getOperators,
    getJenisProduk,
    getProdukList,
    createTransaction,
    checkStatus,
    verifyWebhookSignature
};
