const supabase = require("../config/db");
const crypto = require("crypto");
const { createRedirectPayment, checkTransactionStatus, createDirectPayment, isDirectPaymentMethod } = require("../config/ipaymu");
const { validatePromoCode, incrementUsage } = require("./promoCodeController");
const { buildDiscountedIpaymuItems } = require("../utils/promoDiscountSplit");
const { notify } = require("../config/notify");
const { sendOrderInvoiceEmail } = require("../config/mailer");
const { sendTelegramNotification } = require("../config/telegram");
const { sendWhatsAppNotification } = require("../config/whatsapp");
const { sendUserWhatsApp } = require("../services/userWhatsAppService");
const { processNotificationEvent } = require("../services/notificationDeliveryService");
const { cariCheckoutProdukPending, responsCheckoutPending } = require("../services/pendingCheckoutService");

const IPAYMU_PAYMENT_METHODS = Object.freeze({
    qris: "qris",
    va: "va",
    banktransfer: "banktransfer",
    card: "cc"
});

// URL frontend/backend dipakai buat returnUrl/cancelUrl/notifyUrl iPaymu.
// Isi FRONTEND_URL dan BACKEND_URL di .env (lihat .env.example).
const FRONTEND_URL = (process.env.FRONTEND_URL || "").replace(/\/$/, "");
const BACKEND_URL = (process.env.BACKEND_URL || "").replace(/\/$/, "");

function rupiahLog(n) {
    return "Rp" + Number(n).toLocaleString("id-ID");
}

exports.create = async (req, res) => {
    const { recipient_name, recipient_email, recipient_phone, items, payment_method, payment_channel } = req.body;
    // req.user bisa null (guest checkout) berkat optionalAuthMiddleware
    const userId = req.user ? req.user.id : null;

    if (!recipient_name || !recipient_email || !recipient_phone || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "Data pesanan tidak lengkap" });
    }

    // Nomor HP WAJIB nyata & unik per pembeli -- kalau kosong/default sebelumnya
    // (fallback "08123456789" di ipaymu.js) iPaymu Direct Payment (QRIS/VA)
    // nolak transaksi dengan "Suspicious buyer" karena nomor yang sama
    // dipakai berulang di banyak transaksi berbeda.
    const normalizedPhone = String(recipient_phone).trim();
    if (!/^(0|62)[0-9]{8,14}$/.test(normalizedPhone)) {
        return res.status(400).json({ message: "Nomor HP tidak valid (contoh: 08... atau 628...)" });
    }

    const normalizedPaymentMethod = String(payment_method || "").trim().toLowerCase();
    const ipaymuPaymentMethod = IPAYMU_PAYMENT_METHODS[normalizedPaymentMethod];
    if (!ipaymuPaymentMethod) {
        return res.status(400).json({ message: "Pilih metode pembayaran terlebih dahulu" });
    }

    try {
        // Ambil harga produk langsung dari database kita sendiri — JANGAN percaya
        // `total`/harga yang dikirim dari frontend, karena itu bisa dimanipulasi
        // di browser.
        // transaksi kalau gross_amount tidak sama dengan total item_details.
        const ids = items.map((i) => i.id);
        const { data: products, error: prodErr } = await supabase
            .from("products")
            .select("id, name, price")
            .in("id", ids);

        if (prodErr) {
            console.log(prodErr);
            return res.status(500).json({ message: "Gagal mengambil data produk" });
        }

        let item_details;
        try {
            item_details = items.map((item) => {
                const p = products.find((x) => x.id === item.id);
                if (!p) throw new Error(`Produk id ${item.id} tidak ditemukan`);
                // Wajib integer & dalam batas wajar -- sebelumnya cuma dicek
                // `> 0`, jadi qty desimal (mis. 0.5) atau angka raksasa
                // (mis. 999999999) bisa lolos dan bikin subtotal/total jadi
                // aneh (desimal) atau berpotensi dipakai buat spam order.
                if (!Number.isInteger(item.qty) || item.qty <= 0 || item.qty > 100) {
                    throw new Error(`Jumlah produk tidak valid`);
                }
                return {
                    id: String(p.id),
                    name: p.name.slice(0, 80),
                    price: p.price,
                    quantity: item.qty
                };
            });
        } catch (e) {
            return res.status(400).json({ message: e.message });
        }

        // Akun login tidak boleh membuat invoice baru untuk produk yang sama
        // selama invoice sebelumnya masih berstatus pending. Validasi ada di
        // server supaya tetap berlaku dari tab/perangkat lain.
        if (userId) {
            const pendingOrder = await cariCheckoutProdukPending(supabase, userId, ids);
            if (pendingOrder) {
                const namaProduk = item_details
                    .filter((item) => pendingOrder.product_ids.includes(String(item.id)))
                    .map((item) => item.name)
                    .join(", ");
                return res.status(409).json(responsCheckoutPending(pendingOrder, namaProduk));
            }
        }

        const subtotal = item_details.reduce((sum, i) => sum + i.price * i.quantity, 0);
        // ID dipakai untuk tracking guest yang bersifat publik. randomBytes
        // memberi 96 bit entropy, sehingga tidak dapat ditebak dari waktu
        // checkout seperti ID berbasis timestamp sebelumnya.
        const orderId = "NX" + crypto.randomBytes(12).toString("hex").toUpperCase();

        // Validasi ulang kode promo DI SERVER — jangan pernah percaya angka
        // diskon yang dikirim dari frontend, itu bisa dimanipulasi di browser.
        const { promo_code } = req.body;
        let discountAmount = 0;
        let appliedPromoCode = null;

        if (promo_code) {
            const promoResult = await validatePromoCode(promo_code, item_details, recipient_email);
            if (!promoResult.valid) {
                return res.status(400).json({ message: promoResult.message });
            }
            discountAmount = promoResult.discount;
            appliedPromoCode = promoResult.promo.code;
        }

        const total = Math.max(subtotal - discountAmount, 0);

        // iPaymu menjumlahkan price*qty dari array product/price/qty sebagai
        // total tagihan. Diskon TIDAK dikirim sebagai item harga negatif
        // (pernah bikin returnUrl macet, gak balik ke web) — disebar
        // proporsional ke tiap item supaya semua harga tetap >= 0 tapi
        // totalnya tetap sama persis dengan subtotal - diskon.
        const ipaymuItems = buildDiscountedIpaymuItems(item_details, discountAmount);

        // Simpan order dulu dengan status pending, sebelum minta payment URL ke iPaymu
        const { error: insertErr } = await supabase
            .from("orders")
            .insert([{
                id: orderId,
                user_id: userId,
                recipient_name,
                recipient_email,
                recipient_phone: normalizedPhone,
                payment_method: normalizedPaymentMethod,
                items,
                subtotal,
                discount_amount: discountAmount,
                promo_code: appliedPromoCode,
                total,
                status: "pending"
            }]);

        if (insertErr) {
            console.log(insertErr);
            return res.status(500).json({ message: "Gagal membuat pesanan" });
        }

        // Buat transaksi iPaymu, tentukan apakah Direct atau Redirect flow
        let isDirect = isDirectPaymentMethod(normalizedPaymentMethod);

        let payment;
        try {
            if (isDirect) {
                try {
                    payment = await createDirectPayment({
                        referenceId: orderId,
                        amount: total,
                        buyerName: recipient_name,
                        buyerEmail: recipient_email,
                        buyerPhone: normalizedPhone,
                        paymentMethod: ipaymuPaymentMethod,
                        paymentChannel: payment_channel,
                        notifyUrl: `${BACKEND_URL}/api/orders/notification`
                    });
                } catch (directErr) {
                    console.log(
                        directErr.isTimeout
                            ? `Direct payment TIMEOUT (kemungkinan IP VPS belum di-whitelist iPaymu Direct Payment), fallback ke redirect: ${directErr.message}`
                            : "Direct payment failed (IP whitelist/channel error), falling back to redirect:",
                        directErr.ipaymuResponse || directErr.message
                    );
                    notify(
                        "order",
                        `⚠️ Fallback direct→redirect utk order ${orderId}: ${
                            directErr.isTimeout
                                ? "TIMEOUT (kemungkinan IP VPS belum di-whitelist iPaymu Direct Payment)"
                                : ((directErr.ipaymuResponse && directErr.ipaymuResponse.Message) || directErr.message || "unknown error")
                        }`
                    );
                    isDirect = false;
                }
            }

            if (!isDirect) {
                payment = await createRedirectPayment({
                    referenceId: orderId,
                    itemDetails: ipaymuItems,
                    buyerName: recipient_name,
                    buyerEmail: recipient_email,
                    buyerPhone: normalizedPhone,
                    returnUrl: `${FRONTEND_URL}/#/payment-status?order=${orderId}&status=success`,
                    cancelUrl: `${FRONTEND_URL}/#/payment-status?order=${orderId}&status=cancel`,
                    notifyUrl: `${BACKEND_URL}/api/orders/notification`,
                    paymentMethod: ipaymuPaymentMethod
                });
            }
        } catch (ipaymuErr) {
            console.log("iPaymu error:", ipaymuErr.ipaymuResponse || ipaymuErr.message);
            // order sudah kepalang tercatat, tandai gagal biar gak nggantung di "pending"
            await supabase.from("orders").update({ status: "failed" }).eq("id", orderId);
            return res.status(500).json({ message: "Gagal membuat transaksi pembayaran" });
        }

        // simpan hasil pembayaran (session id / trx id)
        const updatePayload = isDirect 
            ? {
                ipaymu_trx_id: payment.transactionId,
                payment_no: payment.paymentNo,
                qr_content: payment.qrContent,
                payment_expired: payment.expired,
                payment_flow: "direct"
              }
            : {
                ipaymu_session_id: payment.sessionId,
                payment_url: payment.paymentUrl,
                payment_flow: "redirect"
              };

        await supabase
            .from("orders")
            .update(updatePayload)
            .eq("id", orderId);

        notify("order", `🛒 Pesanan baru ${orderId} dari ${recipient_name} senilai ${rupiahLog(total)}`);

        if (isDirect) {
            // Nominal yang WAJIB ditampilkan ke pembeli adalah yang beneran
            // ke-encode di QR/VA dari iPaymu (payment.amount) -- itu bisa
            // beda dari `total` kita kalau skema fee di akun iPaymu nge-bebanin
            // biaya admin ke pembeli. Fallback ke total+fee (BUKAN total polos)
            // kalau iPaymu gak balikin field Amount-nya.
            const displayAmount = payment.amount || (total + (payment.fee || 0));
            
            sendUserWhatsApp(normalizedPhone, "pending", { name: recipient_name, order_id: orderId, total: rupiahLog(displayAmount) });
            
            res.status(201).json({
                message: "Pesanan berhasil dibuat",
                orderId,
                flow: "direct",
                paymentData: {
                    paymentNo: payment.paymentNo,
                    qrContent: payment.qrContent,
                    expired: payment.expired,
                    amount: displayAmount,
                    fee: payment.fee
                }
            });
        } else {
            sendUserWhatsApp(normalizedPhone, "pending", { name: recipient_name, order_id: orderId, total: rupiahLog(total) });
            
            res.status(201).json({
                message: "Pesanan berhasil dibuat",
                orderId,
                flow: "redirect",
                paymentUrl: payment.paymentUrl
            });
        }
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server Error" });
    }
};

// ===========================
// PUBLIK — cek status ringkas 1 order (dipakai halaman "kembali dari
// pembayaran" setelah redirect dari iPaymu; guest checkout gak punya token
// login jadi gak bisa pakai /my). Sengaja cuma return field non-sensitif.
// ===========================
exports.getPublicStatus = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("orders")
            .select("id, status, total, payment_type, created_at, paid_at")
            .eq("id", req.params.id)
            .maybeSingle();

        if (error || !data) return res.status(404).json({ message: "Order tidak ditemukan" });
        res.json(data);
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

// Cek transaksi via ID — dipakai tab "Cek Transaksi" di web utama.
// Sengaja publik (tanpa authMiddleware) supaya guest checkout juga bisa cek,
// tapi field yang dibalikin dibatasi (gak expose recipient_email dst) biar
// orang lain yang cuma nebak-nebak Order ID gak bisa lihat data sensitif.
exports.getPublicDetail = async (req, res) => {
    try {
        const { data: order, error } = await supabase
            .from("orders")
            .select("id, status, total, subtotal, discount_amount, promo_code, payment_type, items, created_at, paid_at")
            .eq("id", req.params.id)
            .maybeSingle();

        if (error || !order) return res.status(404).json({ message: "Transaksi tidak ditemukan" });

        const rawItems = Array.isArray(order.items) ? order.items : [];
        let items = rawItems.map((i) => ({ name: "Produk", quantity: i.qty || 1 }));

        if (rawItems.length) {
            const { data: products } = await supabase
                .from("products")
                .select("id, name")
                .in("id", rawItems.map((i) => i.id));
            items = rawItems.map((i) => {
                const p = (products || []).find((x) => String(x.id) === String(i.id));
                return { name: p ? p.name : "Produk", quantity: i.qty || 1 };
            });
        }

        res.json({
            id: order.id,
            type: "order",
            status: order.status,
            payment_type: order.payment_type,
            items,
            subtotal: order.subtotal,
            discount_amount: order.discount_amount,
            promo_code: order.promo_code,
            total: order.total,
            created_at: order.created_at,
            paid_at: order.paid_at
        });
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server Error" });
    }
};

exports.getMyOrders = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("orders")
            .select("*")
            .eq("user_id", req.user.id)
            .order("created_at", { ascending: false });

        if (error) {
            console.log(error);
            return res.status(500).json({ message: "Database Error" });
        }

        // FEATURE (audit Agustus 2026): "Riwayat Saya" sebelumnya tidak
        // pernah kasih tahu order mana yang sudah/belum dirating -- padahal
        // fitur rating-via-riwayat (mirip Shopee: "Beri Nilai" di kartu
        // pesanan) SUDAH bisa secara teknis (klik item -> tab Cek Transaksi
        // -> form rating muncul kalau eligible), tapi user tidak tahu order
        // mana yang perlu dinilai tanpa klik satu-satu. Tambahkan flag
        // `has_rating` di sini (1 query tambahan, bukan N+1 per order) biar
        // frontend bisa nampilin badge "Beri Rating" / "Sudah Dinilai"
        // langsung di daftar riwayat.
        const paidOrderIds = (data || [])
            .filter(o => o.status === "paid")
            .map(o => o.id);

        let ratedOrderIds = new Set();
        if (paidOrderIds.length > 0) {
            const { data: ratings, error: ratingErr } = await supabase
                .from("order_ratings")
                .select("order_id")
                .in("order_id", paidOrderIds);
            if (!ratingErr && ratings) {
                ratedOrderIds = new Set(ratings.map(r => r.order_id));
            }
            // Kalau query rating gagal, jangan sampai gagalkan seluruh
            // request riwayat -- cukup skip flag has_rating (frontend akan
            // treat sebagai unknown/tidak tampilkan badge untuk order itu).
        }

        const withRatingFlag = (data || []).map(o => ({
            ...o,
            has_rating: o.status === "paid" ? ratedOrderIds.has(o.id) : null
        }));

        res.json(withRatingFlag);
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server Error" });
    }
};

// ===========================
// GET SEMUA PESANAN (untuk admin dashboard)
// select("*") dipakai (bukan enumerasi kolom) supaya tidak error kalau
// skema tabel `orders` kamu belum/tidak punya kolom tertentu (mis. status).
// Nama field di-alias di sini supaya langsung cocok dengan yang dipakai
// dashboard.js di frontend (customerName, date, dst) — tidak perlu ubah
// frontend lagi.
// ===========================
exports.getAllOrders = async (req, res) => {
    if (!["admin", "staff"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    try {
        const { data, error } = await supabase
            .from("orders")
            .select("*")
            .order("created_at", { ascending: false });

        if (error) {
            console.log(error);
            return res.status(500).json({ message: "Database Error" });
        }

        const orders = data.map(order => ({
            id: order.id,
            customerName: order.recipient_name,
            email: order.recipient_email,
            items: order.items,
            total: order.total,
            status: order.status || "pending", // fallback kalau kolom status belum ada
            paymentMethod: order.payment_method,
            date: order.created_at
        }));

        res.json(orders);
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server Error" });
    }
};

// ===========================
// WEBHOOK NOTIFIKASI IPAYMU
// Dipanggil langsung oleh server iPaymu (bukan dari frontend) tiap kali
// status pembayaran berubah. Ini SUMBER KEBENARAN status order — jangan
// pernah update status order cuma berdasarkan callback di frontend, karena
// itu bisa dipalsukan oleh user.
//
// iPaymu mengirim body berisi antara lain trx_id, status, reference_id, sid.
// Supaya gak asal percaya isi body webhook (bisa saja dipalsukan siapapun
// yang tahu URL notify-nya), kita cek ULANG statusnya langsung ke server
// iPaymu pakai trx_id sebelum update database (server-to-server, pakai
// signature ApiKey — jadi gak bisa dipalsukan).
//
// Daftarkan URL endpoint ini (https://domain-backend-kamu/api/orders/notification)
// di iPaymu Dashboard > Integrasi > Notify URL / API URL
// ===========================
exports.handleNotification = async (req, res) => {
    try {
        const body = req.body || {};
        const orderId = body.reference_id || body.referenceId;
        const trxId = body.trx_id || body.trxId;

        if (!orderId) {
            return res.status(400).json({ message: "reference_id tidak ada di body notifikasi" });
        }

        const { data: existingOrder } = await supabase
            .from("orders")
            .select("status, promo_code, recipient_name, recipient_email, items, subtotal, discount_amount, total")
            .eq("id", orderId)
            .maybeSingle();

        if (!existingOrder) {
            return res.status(404).json({ message: "Order tidak ditemukan" });
        }

        // Verifikasi ulang ke server iPaymu — JANGAN PERNAH percaya status dari
        // body webhook begitu saja (endpoint ini publik, siapapun yang tahu
        // URL-nya bisa kirim POST palsu klaim "berhasil" tanpa bayar beneran).
        // Kalau verifikasi ke iPaymu gagal (trx_id gak ada / gak valid / iPaymu
        // error), order TIDAK diubah statusnya sama sekali — dicatat ke
        // notifikasi admin buat dicek manual. iPaymu otomatis retry webhook
        // kalau gagal, jadi ini gak bikin order asli ketinggalan status.
        let verifiedStatus = null;
        if (trxId) {
            try {
                const trx = await checkTransactionStatus(trxId);
                verifiedStatus = String(trx.Status || trx.status || "").toLowerCase();
            } catch (verifyErr) {
                console.log("Gagal verifikasi status ke iPaymu:", verifyErr.message);
            }
        }

        if (verifiedStatus === null) {
            notify("security", `⚠️ Notifikasi pembayaran order ${orderId} gak bisa diverifikasi ke iPaymu (trx_id: ${trxId || "-"}). Status order TIDAK diubah, cek manual di dashboard iPaymu.`);
            return res.status(200).json({ message: "Diterima, menunggu verifikasi" });
        }

        let status = "pending";
        if (["berhasil", "success", "1", "paid", "settlement"].includes(verifiedStatus)) {
            status = "paid";
        } else if (["pending", "0"].includes(verifiedStatus)) {
            status = "pending";
        } else if (["gagal", "expired", "cancel", "cancelled", "-1", "failed", "expire"].includes(verifiedStatus)) {
            status = "failed";
        }

        // Tegakkan status monotonik: jangan turunkan status dari 'paid'
        if (existingOrder.status === "paid" && status !== "paid") {
            console.log(`Mengabaikan update webhook menjadi ${status} karena order ${orderId} sudah paid.`);
            return res.status(200).json({ message: "OK (Ignored downgrade)" });
        }

        const updatePayload = {
            status,
            payment_type: body.via || body.channel || "ipaymu",
            transaction_id: trxId || null
        };
        if (status === "paid") {
            updatePayload.paid_at = new Date().toISOString();
        }

        // Kueri kondisional agar tidak menimpa jika status sudah paid oleh request lain (race condition)
        let query = supabase.from("orders").update(updatePayload).eq("id", orderId);
        if (status !== "paid") {
            query = query.neq("status", "paid");
        }
        if (status === "paid") {
            query = query.in("status", ["pending", "failed"]);
        }

        const { data: updatedRows, error } = await query.select();

        if (error) {
            console.log(error);
            return res.status(500).json({ message: "Gagal update status pesanan" });
        }

        if (!updatedRows || updatedRows.length === 0) {
            return res.status(200).json({ message: "OK (No status transition made)" });
        }

        // catat pemakaian kode promo cuma sekali, pas transisi PERTAMA KALI ke "paid"
        if (status === "paid" && existingOrder.promo_code) {
            await incrementUsage(existingOrder.promo_code, existingOrder.recipient_email, orderId);
        }

        // kirim invoice email cuma sekali, pas transisi PERTAMA KALI ke "paid" —
        // gagal kirim email JANGAN sampai gagalin response ke iPaymu (bukan fatal)
        if (status === "paid" && existingOrder.recipient_email) {
            try {
                const rawItems = Array.isArray(existingOrder.items) ? existingOrder.items : [];
                const { data: products } = await supabase
                    .from("products")
                    .select("id, name, price")
                    .in("id", rawItems.map((i) => i.id));

                const items = rawItems.map((i) => {
                    const p = (products || []).find((x) => String(x.id) === String(i.id));
                    return { name: p ? p.name : "Produk", price: p ? p.price : 0, quantity: i.qty || 1 };
                });

                await sendOrderInvoiceEmail(existingOrder.recipient_email, {
                    orderId,
                    recipientName: existingOrder.recipient_name,
                    items,
                    subtotal: existingOrder.subtotal,
                    discountAmount: existingOrder.discount_amount,
                    promoCode: existingOrder.promo_code,
                    total: existingOrder.total
                });
            } catch (mailErr) {
                console.log("Gagal kirim invoice email:", mailErr.response?.data || mailErr.message);
            }
        }

        // kirim notif Telegram & WhatsApp cuma sekali, pas transisi PERTAMA KALI ke "paid"
        if (status === "paid" && existingOrder.status !== "paid") {
            sendTelegramNotification(
                `🛒 <b>Pembelian Baru</b>\nOrder ID: ${orderId}\nNama: ${existingOrder.recipient_name || "-"}\nTotal: ${rupiahLog(existingOrder.total)}`
            );
            sendWhatsAppNotification(
                `🛒 *Pembelian Baru*\nOrder ID: ${orderId}\nNama: ${existingOrder.recipient_name || "-"}\nTotal: ${rupiahLog(existingOrder.total)}`
            );

            // Anti-duplicate notification (idempotency) melalui service terpusat
            processNotificationEvent(orderId, "success").catch(e => console.log("Gagal trigger notif WA:", e));
        }

        // iPaymu expect balasan 200 OK sederhana
        res.status(200).json({ message: "OK" });
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: err.message || "Server Error" });
    }
};

// ADMIN — Ubah status pesanan (cancel, refund, mark as paid, dsb.)
exports.updateOrderStatusAdmin = async (req, res) => {
    if (!["admin", "staff"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    const { id } = req.params;
    const { status } = req.body;
    if (!["pending", "paid", "expired", "failed", "cancelled", "refunded"].includes(status)) {
        return res.status(400).json({ message: "Status pesanan tidak valid" });
    }
    try {
        const { data, error } = await supabase
            .from("orders")
            .update({ status })
            .eq("id", id)
            .select()
            .maybeSingle();

        if (error) return res.status(500).json({ message: "Gagal memperbarui status pesanan" });
        if (!data) return res.status(404).json({ message: "Pesanan tidak ditemukan" });

        notify("order", `📦 Admin ${req.user.email} mengubah status order #${id} menjadi "${status}"`);
        res.json({ message: `Status pesanan berhasil diubah menjadi ${status}`, data });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server Error" });
    }
};
