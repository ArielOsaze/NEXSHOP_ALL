const supabase = require("../config/db");
const { createRedirectPayment, checkTransactionStatus } = require("../config/ipaymu");
const { validatePromoCode, incrementUsage } = require("./promoCodeController");
const { notify } = require("../config/notify");
const { sendOrderInvoiceEmail } = require("../config/mailer");
const { sendTelegramNotification } = require("../config/telegram");

// URL frontend/backend dipakai buat returnUrl/cancelUrl/notifyUrl iPaymu.
// Isi FRONTEND_URL dan BACKEND_URL di .env (lihat .env.example).
const FRONTEND_URL = (process.env.FRONTEND_URL || "").replace(/\/$/, "");
const BACKEND_URL = (process.env.BACKEND_URL || "").replace(/\/$/, "");

function rupiahLog(n) {
    return "Rp" + Number(n).toLocaleString("id-ID");
}

exports.create = async (req, res) => {
    const { recipient_name, recipient_email, items } = req.body;
    // req.user bisa null (guest checkout) berkat optionalAuthMiddleware
    const userId = req.user ? req.user.id : null;

    if (!recipient_name || !recipient_email || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "Data pesanan tidak lengkap" });
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
                if (!item.qty || item.qty <= 0) throw new Error(`Jumlah produk tidak valid`);
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

        const subtotal = item_details.reduce((sum, i) => sum + i.price * i.quantity, 0);
        const orderId = "NX" + Date.now();

        // Validasi ulang kode promo DI SERVER — jangan pernah percaya angka
        // diskon yang dikirim dari frontend, itu bisa dimanipulasi di browser.
        const { promo_code } = req.body;
        let discountAmount = 0;
        let appliedPromoCode = null;

        if (promo_code) {
            const promoResult = await validatePromoCode(promo_code, subtotal);
            if (!promoResult.valid) {
                return res.status(400).json({ message: promoResult.message });
            }
            discountAmount = promoResult.discount;
            appliedPromoCode = promoResult.promo.code;
        }

        const total = Math.max(subtotal - discountAmount, 0);

        // iPaymu menjumlahkan price*qty dari array product/price/qty sebagai
        // total tagihan — kalau ada diskon, kirim sebagai "item" negatif
        // tersendiri supaya total pas.
        const ipaymuItems = [...item_details];
        if (discountAmount > 0) {
            ipaymuItems.push({
                id: "DISCOUNT",
                name: `Diskon (${appliedPromoCode})`.slice(0, 80),
                price: -discountAmount,
                quantity: 1
            });
        }

        // Simpan order dulu dengan status pending, sebelum minta payment URL ke iPaymu
        const { error: insertErr } = await supabase
            .from("orders")
            .insert([{
                id: orderId,
                user_id: userId,
                recipient_name,
                recipient_email,
                payment_method: "ipaymu",
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

        // Buat transaksi iPaymu (Redirect Payment), dapetin URL halaman bayar
        let payment;
        try {
            payment = await createRedirectPayment({
                referenceId: orderId,
                itemDetails: ipaymuItems,
                buyerName: recipient_name,
                buyerEmail: recipient_email,
                returnUrl: `${FRONTEND_URL}/#/payment-status?order=${orderId}&status=success`,
                cancelUrl: `${FRONTEND_URL}/#/payment-status?order=${orderId}&status=cancel`,
                notifyUrl: `${BACKEND_URL}/api/orders/notification`
            });
        } catch (ipaymuErr) {
            console.log("iPaymu error:", ipaymuErr.ipaymuResponse || ipaymuErr.message);
            // order sudah kepalang tercatat, tandai gagal biar gak nggantung di "pending"
            await supabase.from("orders").update({ status: "failed" }).eq("id", orderId);
            return res.status(500).json({ message: "Gagal membuat transaksi pembayaran" });
        }

        // simpan session id, berguna buat referensi/cek status manual nanti
        await supabase

            .from("orders")
            .update({ ipaymu_session_id: payment.sessionId, payment_url: payment.paymentUrl })
            .eq("id", orderId);

        notify("order", `🛒 Pesanan baru ${orderId} dari ${recipient_name} senilai ${rupiahLog(total)}`);

        res.status(201).json({
            message: "Pesanan berhasil dibuat",
            orderId,
            paymentUrl: payment.paymentUrl
        });
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
            .select("id, status, total, recipient_name, payment_type, created_at, paid_at")
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
            .select("id, status, total, subtotal, discount_amount, promo_code, recipient_name, payment_type, items, created_at, paid_at")
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
            recipient_name: order.recipient_name,
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

        res.json(data);
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

        // Verifikasi ulang ke server iPaymu — jangan percaya status dari body webhook begitu saja
        let ipaymuStatus = String(body.status || "").toLowerCase();
        if (trxId) {
            try {
                const trx = await checkTransactionStatus(trxId);
                ipaymuStatus = String(trx.Status || trx.status || ipaymuStatus).toLowerCase();
            } catch (verifyErr) {
                console.log("Gagal verifikasi status ke iPaymu, pakai status dari body webhook:", verifyErr.message);
            }
        }

        let status = "pending";
        if (["berhasil", "success", "1", "paid", "settlement"].includes(ipaymuStatus)) {
            status = "paid";
        } else if (["pending", "0"].includes(ipaymuStatus)) {
            status = "pending";
        } else if (["gagal", "expired", "cancel", "cancelled", "-1", "failed", "expire"].includes(ipaymuStatus)) {
            status = "failed";
        }

        const updatePayload = {
            status,
            payment_type: body.via || body.channel || "ipaymu",
            transaction_id: trxId || null
        };
        if (status === "paid") {
            updatePayload.paid_at = new Date().toISOString();
        }

        const { error } = await supabase
            .from("orders")
            .update(updatePayload)
            .eq("id", orderId);

        if (error) {
            console.log(error);
            return res.status(500).json({ message: "Gagal update status pesanan" });
        }

        // catat pemakaian kode promo cuma sekali, pas transisi PERTAMA KALI ke "paid"
        if (status === "paid" && existingOrder.status !== "paid" && existingOrder.promo_code) {
            await incrementUsage(existingOrder.promo_code);
        }

        // kirim invoice email cuma sekali, pas transisi PERTAMA KALI ke "paid" —
        // gagal kirim email JANGAN sampai gagalin response ke iPaymu (bukan fatal)
        if (status === "paid" && existingOrder.status !== "paid" && existingOrder.recipient_email) {
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

        // kirim notif Telegram cuma sekali, pas transisi PERTAMA KALI ke "paid"
        if (status === "paid" && existingOrder.status !== "paid") {
            sendTelegramNotification(
                `🛒 <b>Pembelian Baru</b>\nOrder ID: ${orderId}\nNama: ${existingOrder.recipient_name || "-"}\nTotal: ${rupiahLog(existingOrder.total)}`
            );
        }

        // iPaymu expect balasan 200 OK sederhana
        res.status(200).json({ message: "OK" });
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: err.message || "Server Error" });
    }
};
