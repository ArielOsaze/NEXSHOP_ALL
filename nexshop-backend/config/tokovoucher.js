const axios = require("axios");
const crypto = require("crypto");
const https = require("https");
const { getApiKeys } = require("./settings");

const BASE_URL = "https://api.tokovoucher.net";

const api = axios.create({
    baseURL: BASE_URL,
    timeout: 30000,
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
// POST JSON sesuai dokumentasi TokoVoucher. Secret tidak pernah dikirim
// sebagai query parameter agar tidak masuk URL/access log.
async function createTransaction({ refId, kodeProduk, tujuan, serverId }) {
    const { memberCode, secret } = await getCreds();
    const payload = {
        ref_id: refId,
        produk: kodeProduk,
        tujuan,
        member_code: memberCode,
        signature: buildRefSignature(memberCode, secret, refId)
    };
    if (serverId) payload.server_id = serverId;
    const { data } = await api.post(`/v1/transaksi`, payload, {
        headers: { "Content-Type": "application/json" }
    });
    return data;
}

// ===========================================================
// CEK TAGIHAN (INQUIRY) PASCABAYAR
//
// TokoVoucher cuma nyediain inquiry buat produk kategori PASCABAYAR
// (PLN Pascabayar, PDAM, Telkom/IndiHome, BPJS, dst) -- BUKAN buat semua
// produk. Endpoint & signature-nya juga beda sendiri dari endpoint lain:
//   POST /v1/pascabayar-inq  (body JSON)
//   signature = md5(ref_id:member_code:secret)
// Bandingin sama buildRefSignature() di atas yang urutannya
// md5(member_code:secret:ref_id) -- jangan ketuker.
//
// Host default ngikut dokumentasi resmi (api.tokovoucher.id). Kalau akun
// TokoVoucher-nya diarahkan ke host lain (mis. base .net yang dipakai
// endpoint lain di file ini), tinggal set env TOKOVOUCHER_PASCABAYAR_URL
// tanpa ubah kode.
// ===========================================================
const PASCABAYAR_BASE_URL = (process.env.TOKOVOUCHER_PASCABAYAR_URL || "https://api.tokovoucher.id").replace(/\/$/, "");

const pascabayarApi = axios.create({
    baseURL: PASCABAYAR_BASE_URL,
    httpsAgent: new https.Agent({ family: 4 }),
    timeout: 30000
});

function buildInquirySignature(refId, memberCode, secret) {
    return md5(`${refId}:${memberCode}:${secret}`);
}

// PENTING: tiap panggilan inquiry MOTONG SALDO TokoVoucher kita (biaya cek
// tagihan), jadi endpoint yang manggil fungsi ini wajib di-rate-limit dan
// gak boleh kebuka buat dipanggil beruntun dari client.
async function inquiryPascabayar({ refId, kodeProduk, tujuan, serverId }) {
    const { memberCode, secret } = await getCreds();
    const payload = {
        ref_id: refId,
        produk: kodeProduk,
        tujuan,
        server_id: serverId || "",
        member_code: memberCode,
        signature: buildInquirySignature(refId, memberCode, secret)
    };
    const { data } = await pascabayarApi.post(`/v1/pascabayar-inq`, payload, {
        headers: { "Content-Type": "application/json" }
    });
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
    inquiryPascabayar,
    verifyWebhookSignature
};
