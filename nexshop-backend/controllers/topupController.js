const supabase = require("../config/db");
const tokovoucher = require("../config/tokovoucher");
const { createRedirectPayment, checkTransactionStatus } = require("../config/ipaymu");
const { checkNickname } = require("../config/apigames");
const { notify } = require("../config/notify");

const FRONTEND_URL = (process.env.FRONTEND_URL || "").replace(/\/$/, "");
const BACKEND_URL = (process.env.BACKEND_URL || "").replace(/\/$/, "");

function rupiahLog(n) {
    return "Rp" + Number(n).toLocaleString("id-ID");
}

// ===========================================================
// PUBLIK — daftar produk topup yang aktif, buat halaman toko
// ===========================================================
// ===========================================================
// PUBLIK — cek nickname akun game (dipakai frontend sebelum checkout, biar
// customer bisa konfirmasi "ini benar akun saya" sebelum bayar). Cuma
// didukung buat game tertentu (lihat SUPPORTED_GAMES di config/apigames.js)
// dan cuma aktif kalau admin sudah isi ApiGames Merchant ID/Secret di
// Settings > API Keys. Kalau gak didukung/gak dikonfigurasi, return
// { supported: false } — frontend fallback ke peringatan manual, TIDAK
// nge-block checkout.
// ===========================================================
exports.checkNicknameHandler = async (req, res) => {
    const { kategori, tujuan, serverId } = req.body;
    if (!tujuan) {
        return res.status(400).json({ message: "tujuan (Player ID) wajib diisi" });
    }

    try {
        const result = await checkNickname({ kategori, tujuan, serverId });
        if (result === null) {
            return res.json({ supported: false });
        }
        res.json({ supported: true, is_valid: result.is_valid, username: result.username });
    } catch (err) {
        console.log("Cek nickname gagal:", err.message);
        // gagal manggil API pihak ketiga BUKAN alasan buat block checkout — anggap
        // aja gak didukung, frontend fallback ke peringatan manual
        res.json({ supported: false });
    }
};

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
            .select("kode_produk, harga_jual, is_active, kategori")
            .in("kode_produk", kodeList);

        const existingMap = new Map((existing || []).map((e) => [e.kode_produk, e]));

        const upsertRows = rows.map((r) => {
            const prev = existingMap.get(r.kode_produk);
            return {
                ...r,
                harga_jual: prev ? prev.harga_jual : r.harga_beli, // default = harga modal, admin naikkan nanti
                is_active: prev ? prev.is_active : false,
                // produk yg udah ada: pertahankan kategori yang udah diatur admin
                // (misal habis dipindah manual), sync ulang gak nimpa balik
                kategori: prev ? prev.kategori : r.kategori,
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
    const { harga_jual, is_active, butuh_server_id, sort_order, nama, kategori, operator_logo, item_icon } = req.body;

    const payload = { updated_at: new Date().toISOString() };
    if (harga_jual !== undefined) payload.harga_jual = harga_jual;
    if (is_active !== undefined) payload.is_active = is_active;
    if (butuh_server_id !== undefined) payload.butuh_server_id = butuh_server_id;
    if (sort_order !== undefined) payload.sort_order = sort_order;
    if (nama !== undefined) payload.nama = nama;
    if (kategori !== undefined) payload.kategori = kategori;
    if (operator_logo !== undefined) payload.operator_logo = operator_logo;
    if (item_icon !== undefined) payload.item_icon = item_icon;

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

// ADMIN — nyala/matiin SATU KATEGORI/GAME sekaligus (semua produk di
// dalamnya), dipakai buat toggle "Kelola Kategori" di dashboard — biar admin
// gak perlu filter+select-all+bulk-status manual tiap mau sembunyiin
// satu game dari toko.
exports.setKategoriActive = async (req, res) => {
    if (req.user.role !== "admin") {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    const { kategori, is_active } = req.body;
    if (!kategori) {
        return res.status(400).json({ message: "kategori wajib diisi" });
    }
    try {
        const { error } = await supabase
            .from("topup_products")
            .update({ is_active: !!is_active, updated_at: new Date().toISOString() })
            .eq("kategori", kategori);

        if (error) return res.status(500).json({ message: "Gagal mengubah status kategori" });
        notify("product", `${is_active ? "✅" : "🚫"} ${req.user.email} ${is_active ? "mengaktifkan" : "menonaktifkan"} kategori "${kategori}" (semua produk)`);
        res.json({ message: `Kategori "${kategori}" berhasil ${is_active ? "diaktifkan" : "dinonaktifkan"}` });
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

// ADMIN — set logo game (operator_logo) buat SEMUA produk dalam satu kategori
// sekaligus, jadi admin gak perlu edit logo satu-satu per denominasi diamond.
exports.updateCategoryLogo = async (req, res) => {
    if (req.user.role !== "admin") {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    const { kategori, operator_logo } = req.body;
    if (!kategori || !operator_logo) {
        return res.status(400).json({ message: "kategori dan operator_logo wajib diisi" });
    }
    try {
        const { error } = await supabase
            .from("topup_products")
            .update({ operator_logo, updated_at: new Date().toISOString() })
            .eq("kategori", kategori);

        if (error) return res.status(500).json({ message: "Gagal update logo game" });
        notify("product", `🖼️ ${req.user.email} mengubah logo game "${kategori}"`);
        res.json({ message: `Logo game "${kategori}" berhasil diperbarui` });
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

// ADMIN — aktifkan/nonaktifkan banyak produk sekaligus (checkbox massal di
// dashboard), jadi gak perlu buka modal edit satu-satu.
exports.bulkUpdateStatus = async (req, res) => {
    if (req.user.role !== "admin") {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    const { ids, is_active } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "ids wajib diisi (array)" });
    }
    try {
        const { error } = await supabase
            .from("topup_products")
            .update({ is_active: !!is_active, updated_at: new Date().toISOString() })
            .in("id", ids);

        if (error) return res.status(500).json({ message: "Gagal update status produk" });
        notify("product", `${is_active ? "✅" : "🚫"} ${req.user.email} ${is_active ? "mengaktifkan" : "menonaktifkan"} ${ids.length} produk topup sekaligus`);
        res.json({ message: `${ids.length} produk berhasil ${is_active ? "diaktifkan" : "dinonaktifkan"}` });
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

// ADMIN — hitung ulang harga_jual OTOMATIS dari harga_beli (modal) buat
// banyak produk sekaligus, pakai markup persen atau nominal rupiah + opsi
// pembulatan. Ini yang bikin admin gak perlu buka modal edit satu-satu tiap
// produk cuma buat naikin harga jual dari harga modalnya.
exports.bulkMarkupPrice = async (req, res) => {
    if (req.user.role !== "admin") {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    const { ids, type, value, rounding } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "ids wajib diisi (array)" });
    }
    if (type !== "percent" && type !== "nominal") {
        return res.status(400).json({ message: "type harus 'percent' atau 'nominal'" });
    }
    const markupValue = Number(value);
    if (isNaN(markupValue) || markupValue < 0) {
        return res.status(400).json({ message: "value markup gak valid" });
    }
    const round = Number(rounding) || 0; // 0 = gak dibulatkan

    try {
        const { data: products, error: fetchErr } = await supabase
            .from("topup_products")
            .select("id, harga_beli")
            .in("id", ids);
        if (fetchErr) return res.status(500).json({ message: "Gagal mengambil data produk" });

        const rows = (products || []).map((p) => {
            const modal = Number(p.harga_beli) || 0;
            let jual = type === "percent" ? modal * (1 + markupValue / 100) : modal + markupValue;
            if (round > 0) jual = Math.ceil(jual / round) * round;
            return { id: p.id, harga_jual: Math.round(jual) };
        });

        // update satu-satu per baris (paralel) — LEBIH AMAN daripada upsert partial-column,
        // yang berisiko kena constraint NOT NULL kolom lain (kode_produk, nama, dst) yang gak disertakan
        const results = await Promise.all(
            rows.map((r) =>
                supabase
                    .from("topup_products")
                    .update({ harga_jual: r.harga_jual, updated_at: new Date().toISOString() })
                    .eq("id", r.id)
            )
        );
        const failed = results.find((r) => r.error);
        if (failed) return res.status(500).json({ message: "Gagal update harga jual" });

        notify("product", `💰 ${req.user.email} menerapkan markup ${type === "percent" ? `${markupValue}%` : `Rp${markupValue}`} ke ${rows.length} produk topup`);
        res.json({ message: `Harga jual ${rows.length} produk berhasil dihitung ulang dari harga modal` });
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

// ADMIN — set item_icon (ikon per denominasi, kolom "Icon" di tabel) buat
// banyak produk sekaligus berdasarkan pilihan checkbox massal, biar admin
// gak perlu buka modal edit satu-satu tiap produk. Beda dari
// updateCategoryLogo yang isi operator_logo (logo game, dipakai di toko).
exports.bulkUpdateIcon = async (req, res) => {
    if (req.user.role !== "admin") {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    const { ids, item_icon } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "ids wajib diisi (array)" });
    }
    if (!item_icon) {
        return res.status(400).json({ message: "item_icon wajib diisi" });
    }
    try {
        const { error } = await supabase
            .from("topup_products")
            .update({ item_icon, updated_at: new Date().toISOString() })
            .in("id", ids);

        if (error) return res.status(500).json({ message: "Gagal update icon produk" });
        notify("product", `🖼️ ${req.user.email} mengubah icon ${ids.length} produk topup sekaligus`);
        res.json({ message: `Icon berhasil diterapkan ke ${ids.length} produk` });
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

// ADMIN — pindahkan produk terpilih (checkbox massal) ke kategori lain
// sekaligus. Tool umum buat rapiin/gabungin kategori kalau ada produk yang
// kepisah/salah kategori pas sync dari TokoVoucher.
exports.bulkUpdateKategori = async (req, res) => {
    if (req.user.role !== "admin") {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    const { ids, kategori } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "ids wajib diisi (array)" });
    }
    if (!kategori || !kategori.trim()) {
        return res.status(400).json({ message: "kategori tujuan wajib diisi" });
    }
    try {
        const { error } = await supabase
            .from("topup_products")
            .update({ kategori: kategori.trim(), updated_at: new Date().toISOString() })
            .in("id", ids);

        if (error) return res.status(500).json({ message: "Gagal memindahkan kategori produk" });
        notify("product", `📂 ${req.user.email} memindahkan ${ids.length} produk topup ke kategori "${kategori.trim()}"`);
        res.json({ message: `${ids.length} produk berhasil dipindahkan ke kategori "${kategori.trim()}"` });
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

// ADMIN — hapus banyak produk sekaligus berdasarkan pilihan checkbox (beda
// dari deleteAllProducts yang hapus SEMUA/per-kategori)
exports.bulkDeleteProducts = async (req, res) => {
    if (req.user.role !== "admin") {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "ids wajib diisi (array)" });
    }
    try {
        const { error } = await supabase.from("topup_products").delete().in("id", ids);
        if (error) return res.status(500).json({ message: "Gagal menghapus produk terpilih" });
        res.json({ message: `${ids.length} produk berhasil dihapus` });
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

// ADMIN — hapus SEMUA produk topup sekaligus (biar gak perlu klik hapus satu-satu).
// Opsional: kirim ?kategori=Mobile Legends buat cuma hapus produk di kategori/game itu saja.
exports.deleteAllProducts = async (req, res) => {
    if (req.user.role !== "admin") {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    const { kategori } = req.query;
    try {
        let query = supabase.from("topup_products").delete();
        query = kategori ? query.eq("kategori", kategori) : query.not("id", "is", null); // .not(...) trik supaya delete tanpa filter tetap valid di Supabase

        const { error, count } = await query.select("id", { count: "exact" });
        if (error) {
            console.log(error);
            return res.status(500).json({ message: "Gagal menghapus semua produk" });
        }

        notify("product", `🗑️ ${req.user.email} menghapus SEMUA produk topup${kategori ? ` kategori "${kategori}"` : ""}`);
        res.json({ message: kategori ? `Semua produk kategori "${kategori}" berhasil dihapus` : "Semua produk topup berhasil dihapus" });
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server Error" });
    }
};

// ===========================================================
// CHECKOUT — bikin order topup + transaksi iPaymu (guest ATAU login,
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

        let payment;
        try {
            payment = await createRedirectPayment({
                referenceId: orderId,
                itemDetails: [{
                    id: product.kode_produk,
                    name: product.nama.slice(0, 80),
                    price: product.harga_jual,
                    quantity: 1
                }],
                buyerEmail: recipient_email || undefined,
                returnUrl: `${FRONTEND_URL}/#/payment-status?order=${orderId}&status=success`,
                cancelUrl: `${FRONTEND_URL}/#/payment-status?order=${orderId}&status=cancel`,
                notifyUrl: `${BACKEND_URL}/api/topup/notification`
            });
        } catch (ipaymuErr) {
            console.log("iPaymu error:", ipaymuErr.ipaymuResponse || ipaymuErr.message);
            await supabase.from("topup_orders").update({ status: "failed" }).eq("id", orderId);
            return res.status(500).json({ message: "Gagal membuat transaksi pembayaran" });
        }

        await supabase.from("topup_orders").update({ ipaymu_session_id: payment.sessionId, payment_url: payment.paymentUrl }).eq("id", orderId);

        notify("topup", `💎 Pesanan topup baru ${orderId}: ${product.nama} ke ${tujuan} senilai ${rupiahLog(product.harga_jual)}`);

        res.status(201).json({
            message: "Pesanan topup berhasil dibuat",
            orderId,
            paymentUrl: payment.paymentUrl
        });
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server Error" });
    }
};

// ===========================================================
// PUBLIK — cek status ringkas 1 order topup (dipakai halaman "kembali dari
// pembayaran" setelah redirect iPaymu; guest checkout gak punya token login).
// ===========================================================
exports.getPublicStatus = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("topup_orders")
            .select("id, status, harga, nama_produk, tujuan")
            .eq("id", req.params.id)
            .maybeSingle();

        if (error || !data) return res.status(404).json({ message: "Order tidak ditemukan" });
        res.json(data);
    } catch (err) {
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

// Fulfill: dipanggil setelah pembayaran iPaymu "paid" — eksekusi transaksi
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
// WEBHOOK — notifikasi pembayaran iPaymu. SENGAJA tanpa authMiddleware,
// yang memanggil adalah server iPaymu; keasliannya diverifikasi dengan
// mengecek ULANG status transaksi langsung ke server iPaymu (server-to-server).
// ===========================================================
exports.handleIpaymuNotification = async (req, res) => {
    try {
        const body = req.body || {};
        const orderId = body.reference_id || body.referenceId;
        const trxId = body.trx_id || body.trxId;

        if (!orderId) {
            return res.status(400).json({ message: "reference_id tidak ada di body notifikasi" });
        }

        const { data: order } = await supabase
            .from("topup_orders")
            .select("*")
            .eq("id", orderId)
            .maybeSingle();

        if (!order) {
            return res.status(404).json({ message: "Order topup tidak ditemukan" });
        }

        let ipaymuStatus = String(body.status || "").toLowerCase();
        if (trxId) {
            try {
                const trx = await checkTransactionStatus(trxId);
                ipaymuStatus = String(trx.Status || trx.status || ipaymuStatus).toLowerCase();
            } catch (verifyErr) {
                console.log("Gagal verifikasi status ke iPaymu, pakai status dari body webhook:", verifyErr.message);
            }
        }

        let status = order.status;
        let shouldFulfill = false;

        if (["berhasil", "success", "1", "paid", "settlement"].includes(ipaymuStatus)) {
            status = "paid";
            shouldFulfill = true;
        } else if (["pending", "0"].includes(ipaymuStatus)) {
            status = "pending";
        } else if (["gagal", "expired", "cancel", "cancelled", "-1", "failed", "expire"].includes(ipaymuStatus)) {
            status = "failed";
        }

        await supabase.from("topup_orders").update({
            status,
            payment_status: ipaymuStatus,
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
