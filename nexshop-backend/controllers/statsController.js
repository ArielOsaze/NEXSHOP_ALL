const supabase = require("../config/db");
const { getStoreSettings } = require("../config/settings");

// Status yang dianggap "sukses/terbayar" di masing-masing tabel — dipakai
// buat hitung omzet asli (bukan sekadar jumlah order yang dibuat).
const SUCCESS_ORDER_STATUS = "paid";
const SUCCESS_TOPUP_STATUS = "sukses";

function dayKey(dateStr) {
    return new Date(dateStr).toISOString().slice(0, 10);
}
function monthKey(dateStr) {
    return new Date(dateStr).toISOString().slice(0, 7);
}

// ADMIN — ringkasan statistik penjualan gabungan (produk biasa + topup diamond):
// total omzet, jumlah order, tren harian/bulanan, produk & kategori topup terlaris.
exports.getOverview = async (req, res) => {
    if (req.user.role !== "admin") {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }

    try {
        const [ordersRes, topupRes, topupProductsRes] = await Promise.all([
            supabase.from("orders").select("id, total, status, items, created_at"),
            supabase.from("topup_orders").select("id, harga, status, kode_produk, nama_produk, created_at"),
            supabase.from("topup_products").select("kode_produk, kategori")
        ]);

        if (ordersRes.error || topupRes.error || topupProductsRes.error) {
            return res.status(500).json({ message: "Gagal mengambil data statistik" });
        }

        const orders = ordersRes.data || [];
        const topupOrders = topupRes.data || [];
        const kodeToKategori = new Map((topupProductsRes.data || []).map(p => [p.kode_produk, p.kategori || "Lainnya"]));

        const paidOrders = orders.filter(o => o.status === SUCCESS_ORDER_STATUS);
        const paidTopups = topupOrders.filter(t => t.status === SUCCESS_TOPUP_STATUS);

        const revenueRegular = paidOrders.reduce((s, o) => s + Number(o.total || 0), 0);
        const revenueTopup = paidTopups.reduce((s, t) => s + Number(t.harga || 0), 0);

        // breakdown status gabungan (buat tahu berapa banyak yang masih pending/gagal)
        const statusBreakdown = {};
        orders.forEach(o => { statusBreakdown[o.status || "pending"] = (statusBreakdown[o.status || "pending"] || 0) + 1; });
        topupOrders.forEach(t => { statusBreakdown[t.status || "pending"] = (statusBreakdown[t.status || "pending"] || 0) + 1; });

        // tren omzet 30 hari & 12 bulan terakhir
        const dayMap = new Map();
        const monthMap = new Map();
        function addRevenue(dateStr, amount) {
            const dk = dayKey(dateStr), mk = monthKey(dateStr);
            dayMap.set(dk, (dayMap.get(dk) || 0) + amount);
            monthMap.set(mk, (monthMap.get(mk) || 0) + amount);
        }
        paidOrders.forEach(o => addRevenue(o.created_at, Number(o.total || 0)));
        paidTopups.forEach(t => addRevenue(t.created_at, Number(t.harga || 0)));

        const today = new Date();
        const revenueByDay = [];
        for (let i = 29; i >= 0; i--) {
            const d = new Date(today); d.setDate(d.getDate() - i);
            const key = d.toISOString().slice(0, 10);
            revenueByDay.push({ date: key, revenue: dayMap.get(key) || 0 });
        }
        const revenueByMonth = [];
        for (let i = 11; i >= 0; i--) {
            const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
            const key = d.toISOString().slice(0, 7);
            revenueByMonth.push({ month: key, revenue: monthMap.get(key) || 0 });
        }

        // produk biasa terlaris (dari items jsonb tiap order yang sudah paid)
        const productMap = new Map();
        paidOrders.forEach(o => {
            (o.items || []).forEach(item => {
                const key = String(item.id);
                if (!productMap.has(key)) productMap.set(key, { id: key, name: item.name || key, qty: 0, revenue: 0 });
                const entry = productMap.get(key);
                const qty = Number(item.qty || item.quantity || 0);
                entry.qty += qty;
                entry.revenue += Number(item.price || 0) * qty;
            });
        });
        const topProducts = [...productMap.values()].sort((a, b) => b.qty - a.qty).slice(0, 10);

        // kategori/game topup terlaris
        const kategoriMap = new Map();
        paidTopups.forEach(t => {
            const kategori = kodeToKategori.get(t.kode_produk) || "Lainnya";
            if (!kategoriMap.has(kategori)) kategoriMap.set(kategori, { kategori, count: 0, revenue: 0 });
            const entry = kategoriMap.get(kategori);
            entry.count += 1;
            entry.revenue += Number(t.harga || 0);
        });
        const topTopupCategories = [...kategoriMap.values()].sort((a, b) => b.revenue - a.revenue);

        res.json({
            total_revenue: revenueRegular + revenueTopup,
            revenue_regular: revenueRegular,
            revenue_topup: revenueTopup,
            total_orders: orders.length + topupOrders.length,
            total_paid_orders: paidOrders.length + paidTopups.length,
            status_breakdown: statusBreakdown,
            revenue_by_day: revenueByDay,
            revenue_by_month: revenueByMonth,
            top_products: topProducts,
            top_topup_categories: topTopupCategories
        });
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server Error" });
    }
};

// PUBLIK — ringkasan ringan buat trust bar di halaman utama toko (jumlah
// transaksi sukses, jumlah game/kategori aktif, dst). SENGAJA cuma hitungan
// (count), TIDAK ada omzet/revenue — data itu tetap rahasia admin lewat
// /overview di atas.
exports.getPublicOverview = async (req, res) => {
    try {
        const [regularPaidRes, topupPaidRes, activeKategoriRes] = await Promise.all([
            supabase.from("orders").select("id", { count: "exact", head: true }).eq("status", SUCCESS_ORDER_STATUS),
            supabase.from("topup_orders").select("id", { count: "exact", head: true }).eq("status", SUCCESS_TOPUP_STATUS),
            supabase.from("topup_products").select("kategori").eq("is_active", true)
        ]);

        if (regularPaidRes.error || topupPaidRes.error || activeKategoriRes.error) {
            return res.status(500).json({ message: "Gagal mengambil statistik publik" });
        }

        const totalGame = new Set((activeKategoriRes.data || []).map((p) => p.kategori || "Lainnya")).size;

        // admin bisa nambahin "boost" manual di Settings (mis. pas baru buka toko biar
        // gak nampilin 0) — angka final tetap terus naik seiring transaksi asli masuk,
        // bukan angka statis yang harus diupdate manual tiap saat.
        const settings = await getStoreSettings();
        const ordersOffset = Number(settings.trust_bar_orders_offset) || 0;
        const gamesOffset = Number(settings.trust_bar_games_offset) || 0;

        res.json({
            total_transaksi_sukses: (regularPaidRes.count || 0) + (topupPaidRes.count || 0) + ordersOffset,
            total_game: totalGame + gamesOffset
        });
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server Error" });
    }
};
