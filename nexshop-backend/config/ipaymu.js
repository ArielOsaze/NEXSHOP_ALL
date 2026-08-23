const crypto = require("crypto");
const axios = require("axios");
const https = require("https");
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

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// FIX (Agustus 2026): request random gagal di kondisi jaringan yang gak stabil
// sesaat (VPS <-> server iPaymu) -- kadang sukses, kadang timeout/connection
// reset, gak konsisten. Timeout tadi cuma bikin gagalnya cepat, tapi belum
// nutup kegagalan sesaat kayak gini. Sekarang di-retry otomatis, TAPI HANYA
// kalau errornya jaringan murni (gak ada response SAMA SEKALI dari iPaymu --
// timeout/connection reset/DNS gagal/dst). Kalau iPaymu sempat merespons
// (4xx/5xx dengan body, misal "saldo tidak cukup" atau "channel tidak
// aktif"), itu PENOLAKAN ASLI dari mereka -- JANGAN diulang, karena ngulang
// permintaan yang emang ditolak gak akan berubah hasilnya dan cuma buang
// waktu request checkout kamu.
//
// Retry aman dilakuin di sini karena semua request kita (create transaksi
// maupun cek status) selalu nyertain referenceId yang unik per order --
// asalkan iPaymu treat referenceId sebagai idempotency key (lazim buat API
// pembayaran), request kedua paling dianggap "transaksi udah ada" bukan bikin
// transaksi baru dobel. Kalau ternyata iPaymu TIDAK idempotent by
// referenceId, kabarin saya biar retry-nya dimatikan lagi.
async function requestWithRetry(path, body, { timeoutMs = 15000, retries = 1 } = {}) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await requestOnce(path, body, timeoutMs);
        } catch (err) {
            lastErr = err;
            const isNetworkLevelError = !err.httpStatus; // gak ada response HTTP sama sekali dari iPaymu
            const attemptsLeft = attempt < retries;
            if (!isNetworkLevelError || !attemptsLeft) throw err;
            console.log(`iPaymu request ke ${path} gagal jaringan (percobaan ${attempt + 1}/${retries + 1}): ${err.message} -- retry...`);
            await sleep(500 + attempt * 500);
        }
    }
    throw lastErr;
}

async function requestOnce(path, body, timeoutMs) {
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
            },
            httpsAgent: new https.Agent({ family: 4 }),
            // FIX (Agustus 2026): sebelumnya gak ada timeout sama sekali di sini.
            // Kalau IP VPS belum di-whitelist buat Direct Payment (QRIS/VA) di
            // dashboard iPaymu, request ke endpoint itu bisa nge-HANG lama
            // (bukan langsung ditolak) -- bikin browser user duluan yang
            // nyerah/timeout dan nampilin "Gagal terhubung ke server", padahal
            // di backend requestnya masih jalan dan baru fallback ke redirect
            // belakangan (jadi keliatan kayak "gagal tapi kok tetep kebuat").
            // Dengan timeout 15 detik, Direct Payment yang gantung bakal cepat
            // gagal & fallback ke redirect masih dalam satu request yang sama.
            timeout: timeoutMs
        });
        return res.data;
    } catch (axiosErr) {
        // axios langsung throw kalau HTTP status-nya 4xx/5xx, SEBELUM sempat kita
        // baca body-nya — padahal body itu (data.Message) yang isinya alasan asli
        // kenapa iPaymu nolak request (mis. "returnUrl tidak valid", "va tidak
        // ditemukan", dst). Di sini kita bungkus ulang biar alasan aslinya kebawa.
        const responseData = axiosErr.response && axiosErr.response.data;
        const isTimeout = axiosErr.code === "ECONNABORTED";
        const err = new Error(
            (responseData && responseData.Message) ||
            (isTimeout ? `Timeout ${timeoutMs}ms menghubungi iPaymu (${path})` : axiosErr.message)
        );
        err.ipaymuResponse = responseData || null;
        err.httpStatus = axiosErr.response && axiosErr.response.status;
        err.isTimeout = isTimeout;
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

    const data = await requestWithRetry("/payment", body, { timeoutMs: 15000, retries: 1 });

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
    // Read-only, aman di-retry lebih agresif (2x) kalau jaringan lagi flaky.
    const data = await requestWithRetry("/transaction", { transactionId: String(transactionId) }, { timeoutMs: 15000, retries: 2 });
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

    // Timeout lebih pendek (8s) khusus di sini: Direct Payment ini punya jalur
    // fallback ke Redirect Payment di controller kalau gagal, jadi lebih baik
    // gagal cepat & fallback, daripada bikin seluruh request checkout kelamaan
    // nunggu 15 detik penuh sebelum baru nyoba redirect. 1x retry buat nutup
    // network blip sesaat sebelum benar-benar nyerah dan fallback ke redirect.
    const data = await requestWithRetry("/payment/direct", body, { timeoutMs: 8000, retries: 1 });

    if (!data || Number(data.Status) !== 200 || !data.Data) {
        const err = new Error((data && data.Message) || "Gagal membuat transaksi iPaymu (Direct)");
        err.ipaymuResponse = data;
        throw err;
    }

    return {
        transactionId: data.Data.TransactionId || data.Data.transactionId,
        paymentNo: data.Data.PaymentNo || data.Data.paymentNo,
        qrContent: data.Data.QrString || data.Data.QrContent || data.Data.QrCode || data.Data.qrString || data.Data.qrContent || null,
        qrImage: data.Data.QrImage || data.Data.QrTemplate || data.Data.qrImage || null,
        expired: data.Data.Expired || data.Data.expired,
        amount: data.Data.Amount || data.Data.amount,
        fee: data.Data.Fee || data.Data.fee || 0,
        status: data.Data.Status || data.Data.status,
        url: data.Data.Url || data.Data.url
    };
}

module.exports = {
    createRedirectPayment,
    checkTransactionStatus,
    createDirectPayment,
    isDirectPaymentMethod,
    DIRECT_PAYMENT_METHODS
};
