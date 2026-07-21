const crypto = require("crypto");
const axios = require("axios");
const { getApiKeys } = require("./settings");

// ===========================================================
// iPaymu API v2 (Redirect Payment) — menggantikan Midtrans Snap.
// Dokumentasi: https://docs.ipaymu.com/
//
// Beda alur dari Midtrans: gak ada snap_token/popup JS. iPaymu Redirect
// Payment mengembalikan `Url` (halaman pembayaran iPaymu) yang harus
// dibuka lewat redirect biasa (window.location.href) di frontend. Setelah
// pembayaran, iPaymu redirect balik ke returnUrl/cancelUrl, DAN kirim
// webhook server-to-server ke notifyUrl (ini yang jadi sumber kebenaran
// status pembayaran, bukan query string di returnUrl).
// ===========================================================

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
}

// Bikin transaksi Redirect Payment. `itemDetails` = [{ name, price, quantity }]
// Return { sessionId, paymentUrl } atau throw error kalau gagal.
async function createRedirectPayment({ referenceId, itemDetails, buyerName, buyerEmail, buyerPhone, returnUrl, notifyUrl, cancelUrl }) {
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
        buyerPhone: buyerPhone || undefined
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

module.exports = { createRedirectPayment, checkTransactionStatus };
