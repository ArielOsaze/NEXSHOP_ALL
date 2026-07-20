const supabase = require("../config/db");
const tokovoucher = require("../config/tokovoucher");
const { getSnapClient } = require("../config/midtrans");
const { notify } = require("../config/notify");

function rupiahLog(n) {
    return "Rp" + Number(n).toLocaleString("id-ID");
}

// ===========================================================
// PUBLIK — daftar produk topup yang aktif, buat halaman toko
// ===========================================================
exports.getProducts = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("topup_products")
            .select("*")
            .eq("is_active", true)
            .order("kategori", { ascending: true })
            .order("sort_order", { ascending: true })
            .order("harga_jual", { ascending: true });

        if (error) {
            console.log(error);
            return res.status(500).json({ message: "Database Error" });
        }

        res.json(data || []);
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server Error" });
    }
};

// ===========================================================
// ADMIN — sync katalog dari TokoVoucher berdasarkan kode/prefix
// (mis. "ML" buat semua produk Mobile Legends). Produk baru masuk
// dalam keadaan is_active = false, admin yang aktifkan manual
// dan atur harga jualnya di dashboard.
// ===========================================================
exports.syncProducts = async (req, res) => {
    if (req.user.role !== "admin") {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }

    const { kode } = req.query;
    if (!kode) {
        return res.status(400).json({ message: "Parameter 'kode' wajib diisi, contoh: ML, FF, PUBG" });
    }

    try {
        const result = await tokovoucher.searchProducts(kode);

        if (!result || result.status !== 1 || !Array.isArray(result.data)) {
            return res.status(400).json({
                message: result?.error_msg || "Gagal mengambil produk dari TokoVoucher"
            });
        }

        const rows = result.data.map((p) => ({
            kode_produk: p.code,
            nama: p.nama_produk,
            kategori: p.operator_produk || p.category_name,
            deskripsi: p.deskripsi,
            harga_beli: p.price,
            // hanya set harga_jual saat produk BARU pertama kali masuk;
            // upsert di bawah pakai ignoreDuplicates:false jadi kita perlu
            // ambil produk existing dulu supaya harga_jual admin gak ketimpa
        }));

        const kodeList = rows.map((r) => r.kode_produk);
        const { data: existing } = await supabase
            .from("topup_products")
            .select("kode_produk, harga_jual, is_active")
            .in("kode_produk", kodeList);

        const existingMap = new Map((existing || []).map((e) => [e.kode_produk, e]));

        const upsertRows = rows.map((r) => {
            const prev = existingMap.get(r.kode_produk);
            return {
                ...r,
                harga_jual: prev ? prev.harga_jual : r.harga_beli, // default = harga modal, admin naikkan nanti
                is_active: prev ? prev.is_active : false,
                updated_at: new Date().toISOString()
            };
        });

        const { data, error } = await supabase
            .from("topup_products")
            .upsert(upsertRows, { onConflict: "kode_produk" })
            .select();

        if (error) {
            console.log(error);
            return res.status(500).json({ message: "Gagal menyimpan produk" });
        }

        res.json({ message: `${data.length} produk berhasil disinkronkan`, data });
    } catch (err) {
        console.log(err.response?.data || err.message);
        res.status(500).json({ message: "Gagal terhubung ke TokoVoucher" });
    }
};

// ADMIN — list semua produk topup (termasuk nonaktif), buat tabel dashboard
exports.getAllProductsAdmin = async (req, res) => {
    if (req.user.role !== "admin") {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    try {
        const { data, error } = await supabase
            .from("topup_products")
            .select("*")
            .order("kategori", { ascending: true })
            .order("harga_jual", { ascending: true });

        if (error) return res.status(500).json({ message: "Database Error" });
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

// ADMIN — update harga jual / aktif / butuh server id / urutan tampil
exports.updateProduct = async (req, res) => {
    if (req.user.role !== "admin") {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    const { id } = req.params;
    const { harga_jual, is_active, butuh_server_id, sort_order, nama, kategori, operator_logo } = req.body;

    const payload = { updated_at: new Date().toISOString() };
    if (harga_jual !== undefined) payload.harga_jual = harga_jual;
    if (is_active !== undefined) payload.is_active = is_active;
    if (butuh_server_id !== undefined) payload.butuh_server_id = butuh_server_id;
    if (sort_order !== undefined) payload.sort_order = sort_order;
    if (nama !== undefined) payload.nama = nama;
    if (kategori !== undefined) payload.kategori = kategori;
    if (operator_logo !== undefined) payload.operator_logo = operator_logo;

    try {
        const { data, error } = await supabase
            .from("topup_products")
            .update(payload)
            .eq("id", id)
            .select();

        if (error) return res.status(500).json({ message: "Gagal update produk" });
        if (!data.length) return res.status(404).json({ message: "Produk tidak ditemukan" });

        res.json({ message: "Produk berhasil diperbarui", data: data[0] });
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

exports.deleteProduct = async (req, res) => {
    if (req.user.role !== "admin") {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    const { id } = req.params;
    try {
        const { error } = await supabase.from("topup_products").delete().eq("id", id);
        if (error) return res.status(500).json({ message: "Gagal menghapus produk" });
        res.json({ message: "Produk berhasil dihapus" });
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

// ===========================================================
// CHECKOUT — bikin order topup + transaksi Midtrans (guest ATAU login,
// sama seperti checkout produk biasa)
// ===========================================================
exports.create = async (req, res) => {
    const { kode_produk, tujuan, server_id, recipient_email } = req.body;
    const userId = req.user ? req.user.id : null;

    if (!kode_produk || !tujuan) {
        return res.status(400).json({ message: "Produk dan tujuan (Player ID) wajib diisi" });
    }

    try {
        const { data: product, error: prodErr } = await supabase
            .from("topup_products")
            .select("*")
            .eq("kode_produk", kode_produk)
            .eq("is_active", true)
            .maybeSingle();

        if (prodErr || !product) {
            return res.status(404).json({ message: "Produk topup tidak ditemukan atau tidak aktif" });
        }

        if (product.butuh_server_id && !server_id) {
            return res.status(400).json({ message: "Server ID wajib diisi untuk produk ini" });
        }

        const orderId = "TP" + Date.now();

        const { error: insertErr } = await supabase.from("topup_orders").insert([{
            id: orderId,
            user_id: userId,
            kode_produk: product.kode_produk,
            nama_produk: product.nama,
            tujuan,
            server_id: server_id || null,
            recipient_email: recipient_email || null,
            harga: product.harga_jual,
            status: "pending"
        }]);

        if (insertErr) {
            console.log(insertErr);
            return res.status(500).json({ message: "Gagal membuat pesanan topup" });
        }

        let transaction;
        try {
            const snap = await getSnapClient();
            transaction = await snap.createTransaction({
                transaction_details: {
                    order_id: orderId,
                    gross_amount: product.harga_jual
                },
                item_details: [{
                    id: product.kode_produk,
                    name: product.nama.slice(0, 50),
                    price: product.harga_jual,
                    quantity: 1
                }],
                customer_details: {
                    email: recipient_email || "guest@nexshop.my.id"
                }
            });
        } catch (midtransErr) {
            console.log(midtransErr);
            await supabase.from("topup_orders").update({ status: "failed" }).eq("id", orderId);
            return res.status(500).json({ message: "Gagal membuat transaksi pembayaran" });
        }

        await supabase.from("topup_orders").update({ snap_token: transaction.token }).eq("id", orderId);

        notify("topup", `💎 Pesanan topup baru ${orderId}: ${product.nama} ke ${tujuan} senilai ${rupiahLog(product.harga_jual)}`);

        res.status(201).json({
            message: "Pesanan topup berhasil dibuat",
            orderId,
            snap_token: transaction.token
        });
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server Error" });
    }
};

exports.getMyOrders = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("topup_orders")
            .select("*")
            .eq("user_id", req.user.id)
            .order("created_at", { ascending: false });

        if (error) return res.status(500).json({ message: "Database Error" });
        res.json(data);
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

// ADMIN — semua order topup, buat dashboard
exports.getAllOrders = async (req, res) => {
    if (req.user.role !== "admin") {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    try {
        const { data, error } = await supabase
            .from("topup_orders")
            .select("*")
            .order("created_at", { ascending: false });

        if (error) return res.status(500).json({ message: "Database Error" });
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

// Fulfill: dipanggil setelah pembayaran Midtrans "paid" — eksekusi transaksi
// nyata ke TokoVoucher supaya diamond benar-benar terkirim
async function fulfillOrder(order) {
    try {
        const result = await tokovoucher.createTransaction({
            refId: order.id,
            kodeProduk: order.kode_produk,
            tujuan: order.tujuan,
            serverId: order.server_id
        });

        const statusMap = { sukses: "sukses", pending: "processing", gagal: "gagal" };
        await supabase.from("topup_orders").update({
            status: statusMap[result.status] || "processing",
            tv_ref_id: result.ref_id || order.id,
            tv_trx_id: result.trx_id || null,
            tv_sn: result.sn || null,
            tv_message: result.message || null,
            updated_at: new Date().toISOString()
        }).eq("id", order.id);
    } catch (err) {
        // Sesuai catatan TokoVoucher: HTTP error / timeout HARUS dianggap PENDING,
        // bukan gagal — jangan tandai gagal di sini, biarkan admin/webhook/polling
        // yang menentukan status final belakangan.
        console.log("TokoVoucher fulfill error (dianggap pending):", err.response?.data || err.message);
        await supabase.from("topup_orders").update({
            status: "processing",
            tv_message: "Menunggu konfirmasi TokoVoucher",
            updated_at: new Date().toISOString()
        }).eq("id", order.id);
    }
}

// ===========================================================
// WEBHOOK — notifikasi Midtrans (payment). SENGAJA tanpa authMiddleware,
// yang memanggil adalah server Midtrans, keasliannya diverifikasi via
// snap.transaction.notification().
// ===========================================================
exports.handleMidtransNotification = async (req, res) => {
    try {
        const snap = await getSnapClient();
        const notification = await snap.transaction.notification(req.body);

        const orderId = notification.order_id;
        const transactionStatus = notification.transaction_status;
        const fraudStatus = notification.fraud_status;

        const { data: order } = await supabase
            .from("topup_orders")
            .select("*")
            .eq("id", orderId)
            .maybeSingle();

        if (!order) {
            return res.status(404).json({ message: "Order topup tidak ditemukan" });
        }

        let status = order.status;
        let shouldFulfill = false;

        if (transactionStatus === "capture") {
            status = fraudStatus === "accept" ? "paid" : "challenge";
            shouldFulfill = fraudStatus === "accept";
        } else if (transactionStatus === "settlement") {
            status = "paid";
            shouldFulfill = true;
        } else if (transactionStatus === "pending") {
            status = "pending";
        } else if (["deny", "cancel", "expire", "failure"].includes(transactionStatus)) {
            status = "failed";
        }

        await supabase.from("topup_orders").update({
            status,
            payment_status: transactionStatus,
            updated_at: new Date().toISOString()
        }).eq("id", orderId);

        // baru eksekusi topup ke TokoVoucher KALAU pembayaran baru saja lunas
        // dan belum pernah diproses sebelumnya (idempotency check via tv_trx_id)
        if (shouldFulfill && !order.tv_trx_id) {
            await fulfillOrder({ ...order, status });
        }

        res.status(200).json({ message: "OK" });
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: err.message || "Server Error" });
    }
};

// ===========================================================
// WEBHOOK — laporan status final dari TokoVoucher sendiri (kalau transaksi
// sempat PENDING lalu statusnya berubah di sisi mereka). Divalidasi via
// header X-TokoVoucher-Authorization, BUKAN authMiddleware biasa.
// ===========================================================
exports.handleTokoVoucherWebhook = async (req, res) => {
    try {
        const body = req.body;
        const refId = body.ref_id;
        const headerSig = req.headers["x-tokovoucher-authorization"];

        const valid = await tokovoucher.verifyWebhookSignature(headerSig, refId);
        if (!valid) {
            return res.status(401).json({ message: "Signature tidak valid" });
        }

        const statusMap = { sukses: "sukses", gagal: "gagal", pending: "processing" };

        const { error } = await supabase.from("topup_orders").update({
            status: statusMap[body.status] || "processing",
            tv_trx_id: body.trx_id || null,
            tv_sn: body.sn || null,
            tv_message: body.message || null,
            updated_at: new Date().toISOString()
        }).eq("id", refId);

        if (error) {
            console.log(error);
            return res.status(500).json({ message: "Gagal update status" });
        }

        res.status(200).json({ message: "OK" });
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server Error" });
    }
};

// Cek status manual (admin retry / user polling) langsung ke TokoVoucher
exports.checkStatus = async (req, res) => {
    const { id } = req.params;
    try {
        const { data: order } = await supabase.from("topup_orders").select("*").eq("id", id).maybeSingle();
        if (!order) return res.status(404).json({ message: "Order tidak ditemukan" });

        const result = await tokovoucher.checkStatus(id);

        const statusMap = { sukses: "sukses", gagal: "gagal", pending: "processing" };
        await supabase.from("topup_orders").update({
            status: statusMap[result.status] || order.status,
            tv_trx_id: result.trx_id || order.tv_trx_id,
            tv_sn: result.sn || order.tv_sn,
            tv_message: result.message || order.tv_message,
            updated_at: new Date().toISOString()
        }).eq("id", id);

        res.json(result);
    } catch (err) {
        console.log(err.response?.data || err.message);
        res.status(500).json({ message: "Gagal cek status ke TokoVoucher" });
    }
};

// ADMIN — cek saldo akun TokoVoucher (dipakai di Settings/Topup dashboard)
exports.getBalance = async (req, res) => {
    if (req.user.role !== "admin") {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    try {
        const result = await tokovoucher.checkBalance();
        res.json(result);
    } catch (err) {
        console.log(err.response?.data || err.message);
        res.status(500).json({ message: "Gagal cek saldo TokoVoucher" });
    }
};
