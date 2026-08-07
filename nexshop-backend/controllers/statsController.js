const supabase = require("../config/db");
const { getStoreSettings, getApiKeys, DEFAULT_GEMINI_MODEL, callGeminiWithFallback } = require("../config/settings");
const axios = require("axios");

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

// ADMIN — Ekspor data transaksi ke format CSV untuk laporan keuangan/sales report
exports.exportOrders = async (req, res) => {
    if (req.user.role !== "admin") {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }

    try {
        const [ordersRes, topupRes] = await Promise.all([
            supabase.from("orders").select("id, recipient_name, recipient_email, total, status, items, created_at").order("created_at", { ascending: false }),
            supabase.from("topup_orders").select("id, recipient_email, harga, status, nama_produk, tujuan, server_id, created_at").order("created_at", { ascending: false })
        ]);

        if (ordersRes.error || topupRes.error) {
            console.error("Export orders query error:", ordersRes.error || topupRes.error);
            return res.status(500).json({ message: "Gagal mengekspor data pesanan" });
        }

        const rows = [
            ["ID Transaksi", "Jenis", "Tanggal", "Nama Pembeli", "Email", "Item / Game", "Total (IDR)", "Status"]
        ];

        (ordersRes.data || []).forEach(o => {
            const itemNames = (o.items || []).map(i => `${i.name || 'Produk'} (x${i.qty || 1})`).join("; ");
            rows.push([
                `ORD-${o.id}`,
                "Produk Digital",
                new Date(o.created_at).toLocaleString("id-ID"),
                o.recipient_name || "-",
                o.recipient_email || "-",
                itemNames || "-",
                o.total || 0,
                o.status || "pending"
            ]);
        });

        (topupRes.data || []).forEach(t => {
            const userTarget = t.tujuan + (t.server_id ? ` (${t.server_id})` : "");
            rows.push([
                `TOP-${t.id}`,
                "Topup Game",
                new Date(t.created_at).toLocaleString("id-ID"),
                userTarget || "-",
                t.recipient_email || "-",
                t.nama_produk || "Topup",
                t.harga || 0,
                t.status || "pending"
            ]);
        });

        const csvString = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");

        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="laporan_penjualan_nexshop_${new Date().toISOString().slice(0, 10)}.csv"`);
        res.status(200).send("\uFEFF" + csvString);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server Error" });
    }
};

// ADMIN — System Health & Performance Status
exports.getSystemHealth = async (req, res) => {
    if (req.user.role !== "admin") {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    try {
        const mem = process.memoryUsage();
        const uptimeSec = Math.floor(process.uptime());
        
        const dbStart = Date.now();
        const { error } = await supabase.from("products").select("id", { count: "exact", head: true });
        const dbLatencyMs = Date.now() - dbStart;

        res.json({
            status: "online",
            uptime_seconds: uptimeSec,
            node_version: process.version,
            memory: {
                rss_mb: Math.round(mem.rss / 1024 / 1024),
                heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
                heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024)
            },
            database: {
                status: error ? "error" : "healthy",
                latency_ms: dbLatencyMs,
                error_message: error ? error.message : null
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Gagal memeriksa kesehatan sistem" });
    }
};

// ADMIN — Google Gemini AI Sales Advisor & Insights
exports.getAiInsights = async (req, res) => {
    if (req.user.role !== "admin") {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }

    try {
        const apiKeys = await getApiKeys();
        const apiKey = apiKeys.gemini_api_key || process.env.GEMINI_API_KEY || "";
        const model = apiKeys.gemini_news_model || DEFAULT_GEMINI_MODEL;

        const [ordersRes, topupRes, productsRes] = await Promise.all([
            supabase.from("orders").select("total, status, items, created_at").order("created_at", { ascending: false }).limit(100),
            supabase.from("topup_orders").select("harga, status, nama_produk, created_at").order("created_at", { ascending: false }).limit(100),
            supabase.from("products").select("name, price, sold, is_flash_sale")
        ]);

        const paidOrders = (ordersRes.data || []).filter(o => o.status === "paid");
        const paidTopups = (topupRes.data || []).filter(t => t.status === "sukses");

        const totalRevenue = paidOrders.reduce((s, o) => s + Number(o.total || 0), 0) + paidTopups.reduce((s, t) => s + Number(t.harga || 0), 0);
        const topProducts = (productsRes.data || []).sort((a, b) => (b.sold || 0) - (a.sold || 0)).slice(0, 5);

        const summaryText = `Total Omzet: Rp${totalRevenue.toLocaleString("id-ID")}, Paid Regular Orders: ${paidOrders.length}, Paid Topup Orders: ${paidTopups.length}. Top Products: ${topProducts.map(p => `${p.name} (${p.sold || 0} terjual)`).join(", ")}.`;

        if (apiKey) {
            const geminiRes = await callGeminiWithFallback({
                apiKey,
                preferredModel: model,
                contents: [{
                    parts: [{
                        text: `Kamu adalah Senior E-Commerce Growth Consultant & Data Analyst. Analisis data toko berikut dan berikan 3-4 poin saran taktis konkret untuk meningkatkan penjualan (penetapan harga, promo, stok, waktu jualan): ${summaryText}. Jawab singkat, padat, dan profesional dalam bahasa Indonesia.`
                    }]
                }],
                generationConfig: { temperature: 0.3, maxOutputTokens: 800 },
                timeoutMs: 8000
            });

            if (geminiRes.success && geminiRes.reply) {
                return res.json({ source: "gemini", model: geminiRes.activeModel, advice: geminiRes.reply, summary: summaryText });
            }
        }

        // Fallback AI Engine jika API Key belum diisi atau kuota habis
        const fallbackAdvice = `💡 **Rekomendasi AI Growth Advisor (Default Engine)**:\n\n` +
            `1. **Tingkatkan Promosi Top Products**: Produk terlaris Anda (${topProducts[0]?.name || "Voucher Game"}) menunjukkan minat tinggi. Pertimbangkan menambahkan varian nominal hemat.\n` +
            `2. **Optimasi Flash Sale**: Aktifkan fitur Flash Sale pada produk dengan konversi tinggi di jam ramai (19:00 - 22:00 WIB).\n` +
            `3. **Pengingat Stok & Varian**: Tambahkan lebih banyak ragam voucher atau nominal terjangkau untuk menarik lebih banyak transaksi pertama.`;

        res.json({ source: "fallback", model: "internal-growth-engine", advice: fallbackAdvice, summary: summaryText });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Gagal memproses AI Insights" });
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
