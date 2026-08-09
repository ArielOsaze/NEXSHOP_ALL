const crypto = require("crypto");
const axios = require("axios");
const { getApiKeys } = require("./settings");

// ===========================================================
// iPaymu API v2 (Redirect Payment).
// Dokumentasi: https://docs.ipaymu.com/
//
// iPaymu Redirect Payment mengembalikan `Url` (halaman pembayaran iPaymu) yang harus
// dibuka lewat redirect biasa (window.location.href) di frontend. Setelah
// pembayaran, iPaymu redirect balik ke returnUrl/cancelUrl, DAN kirim
// webhook server-to-server ke notifyUrl (ini yang jadi sumber kebenaran
// status pembayaran, bukan query string di returnUrl).
// ===========================================================

// Konfigurasi payment method yang TERBUKTI support Direct Payment iPaymu.
// Hanya method yang sudah dikonfirmasi dari dokumentasi resmi iPaymu yang
// dimasukkan di sini. Sisanya tetap redirect.
const DIRECT_PAYMENT_METHODS = Object.freeze({
    qris: { paymentMethod: "qris" },
    va:   { paymentMethod: "va" }
});

function isDirectPaymentMethod(method) {
    return !!DIRECT_PAYMENT_METHODS[method];
}

function baseUrl(isProduction) {
    return isProduction ? "https://my.ipaymu.com/api/v2" : "https://sandbox.ipaymu.com/api/v2";
}

// Format timestamp yang diminta iPaymu: YYYYMMDDhhmmss
function buildTimestamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// Signature iPaymu v2:
// StringToSign = HTTPMethod:VaNumber:Lowercase(SHA256(RequestBody)):ApiKey
// Signature    = HMAC-SHA256(StringToSign, ApiKey)
function buildSignature({ method, va, apiKey, body }) {
    const bodyHash = crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex").toLowerCase();
    const stringToSign = `${method.toUpperCase()}:${va}:${bodyHash}:${apiKey}`;
    return crypto.createHmac("sha256", apiKey).update(stringToSign).digest("hex");
}

async function getCreds() {
    const keys = await getApiKeys();
    if (!keys.ipaymu_va || !keys.ipaymu_api_key) {
        console.log("❌ iPaymu VA/API Key belum diisi (.env atau Settings > API Keys)");
    }
    return {
        va: keys.ipaymu_va || "",
        apiKey: keys.ipaymu_api_key || "",
        isProduction: !!keys.ipaymu_is_production
    };
}

async function request(path, body) {
    const { va, apiKey, isProduction } = await getCreds();
    const signature = buildSignature({ method: "POST", va, apiKey, body });

    try {
        const res = await axios.post(`${baseUrl(isProduction)}${path}`, body, {
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
                va,
                signature,
                timestamp: buildTimestamp()
            }
        });
        return res.data;
    } catch (axiosErr) {
        // axios langsung throw kalau HTTP status-nya 4xx/5xx, SEBELUM sempat kita
        // baca body-nya — padahal body itu (data.Message) yang isinya alasan asli
        // kenapa iPaymu nolak request (mis. "returnUrl tidak valid", "va tidak
        // ditemukan", dst). Di sini kita bungkus ulang biar alasan aslinya kebawa.
        const responseData = axiosErr.response && axiosErr.response.data;
        const err = new Error((responseData && responseData.Message) || axiosErr.message);
        err.ipaymuResponse = responseData || null;
        err.httpStatus = axiosErr.response && axiosErr.response.status;
        throw err;
    }
}

// Bikin transaksi Redirect Payment. `itemDetails` = [{ name, price, quantity }]
// Return { sessionId, paymentUrl } atau throw error kalau gagal.
async function createRedirectPayment({ referenceId, itemDetails, buyerName, buyerEmail, buyerPhone, returnUrl, notifyUrl, cancelUrl, paymentMethod, paymentChannel }) {
    const body = {
        product: itemDetails.map((i) => i.name),
        qty: itemDetails.map((i) => i.quantity),
        price: itemDetails.map((i) => i.price),
        description: itemDetails.map((i) => i.name),
        returnUrl,
        notifyUrl,
        cancelUrl,
        referenceId,
        buyerName: buyerName || "Guest",
        buyerEmail: buyerEmail || undefined,
        buyerPhone: buyerPhone || undefined,
        ...(paymentMethod ? { paymentMethod } : {}),
        ...(paymentChannel ? { paymentChannel } : {})
    };

    const data = await request("/payment", body);

    if (!data || Number(data.Status) !== 200 || !data.Data || !data.Data.Url) {
        const err = new Error((data && data.Message) || "Gagal membuat transaksi iPaymu");
        err.ipaymuResponse = data;
        throw err;
    }

    return {
        sessionId: data.Data.SessionID,
        paymentUrl: data.Data.Url
    };
}

// Cek status transaksi langsung ke server iPaymu (server-to-server) — dipakai
// untuk MEMVERIFIKASI webhook notify yang masuk, supaya kita gak asal percaya
// body webhook (yang secara teori bisa dipalsukan orang lain yang tahu
// endpoint notify kita). transactionId = TrxId yang dikirim iPaymu di notify.
async function checkTransactionStatus(transactionId) {
    const data = await request("/transaction", { transactionId: String(transactionId) });
    if (!data || Number(data.Status) !== 200 || !data.Data) {
        const err = new Error((data && data.Message) || "Gagal mengecek status transaksi iPaymu");
        err.ipaymuResponse = data;
        throw err;
    }
    return data.Data; // berisi antara lain: Status ("berhasil"/"pending"/"expired"/dst), ReferenceId, Amount, dst
}

// Bikin transaksi Direct Payment (VA & QRIS)
// Return { transactionId, paymentNo, qrContent, expired, amount, fee, status, url } atau throw error.
async function createDirectPayment({ referenceId, amount, buyerName, buyerEmail, buyerPhone, paymentMethod, paymentChannel, notifyUrl }) {
    let finalChannel = paymentChannel;
    if (!finalChannel) {
        if (paymentMethod === "qris") finalChannel = "qris";
        if (paymentMethod === "va") finalChannel = "bni";
    }

    const body = {
        name: buyerName || "Guest",
        phone: buyerPhone || "08123456789",
        email: buyerEmail || "guest@example.com",
        amount,
        notifyUrl,
        referenceId,
        paymentMethod,
        ...(finalChannel ? { paymentChannel: finalChannel } : {})
    };

    const data = await request("/payment/direct", body);

    if (!data || Number(data.Status) !== 200 || !data.Data) {
        const err = new Error((data && data.Message) || "Gagal membuat transaksi iPaymu (Direct)");
        err.ipaymuResponse = data;
        throw err;
    }

    return {
        transactionId: data.Data.TransactionId,
        paymentNo: data.Data.PaymentNo,
        qrContent: data.Data.QrString || data.Data.QrContent, // iPaymu kadang pakai nama QrString / QrContent
        expired: data.Data.Expired,
        amount: data.Data.Amount,
        fee: data.Data.Fee,
        status: data.Data.Status,
        url: data.Data.Url
    };
}

module.exports = {
    createRedirectPayment,
    checkTransactionStatus,
    createDirectPayment,
    isDirectPaymentMethod,
    DIRECT_PAYMENT_METHODS
};
