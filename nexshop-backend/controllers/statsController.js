const supabase = require("../config/db");
const { getStoreSettings, getApiKeys, DEFAULT_GEMINI_MODEL, callGeminiWithFallback } = require("../config/settings");
const axios = require("axios");
const { fetchAllRows } = require("../utils/supabasePaginate");

// Status yang dianggap "sukses/terbayar" di masing-masing tabel — dipakai
// buat hitung omzet asli (bukan sekadar jumlah order yang dibuat).
const SUCCESS_ORDER_STATUS = "paid";
const SUCCESS_TOPUP_STATUS = "sukses";

// ===========================================================
// ZONA WAKTU — toko ini jualan di Indonesia, jadi "hari" di grafik omzet
// HARUS hari WIB (UTC+7), bukan hari UTC. Sebelumnya semua bucket dihitung
// pakai toISOString() yang selalu UTC: order yang masuk jam 00:00–06:59
// WIB kecatat sebagai omzet HARI KEMARIN, dan omzet "hari ini" selalu
// kelihatan lebih kecil dari yang sebenarnya sampai lewat jam 7 pagi.
// ===========================================================
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

// Geser timestamp ke "jam dinding WIB" lalu ambil bagian tanggalnya, jadi
// slice(0,10) menghasilkan tanggal WIB, bukan tanggal UTC.
function toWibParts(dateStr) {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return null;
    return new Date(d.getTime() + WIB_OFFSET_MS).toISOString();
}

function dayKey(dateStr) {
    const wib = toWibParts(dateStr);
    return wib ? wib.slice(0, 10) : null;
}
function monthKey(dateStr) {
    const wib = toWibParts(dateStr);
    return wib ? wib.slice(0, 7) : null;
}

// "Sekarang" dalam jam dinding WIB — dipakai buat bikin deret 30 hari /
// 12 bulan terakhir supaya label sumbu-X-nya sinkron sama dayKey di atas
// (dan gak ikut-ikutan geser kalau server-nya di-deploy di zona lain).
function nowInWib() {
    return new Date(Date.now() + WIB_OFFSET_MS);
}

// ADMIN — ringkasan statistik penjualan gabungan (produk biasa + topup diamond):
// total omzet, jumlah order, tren harian/bulanan, produk & kategori topup terlaris.
exports.getOverview = async (req, res) => {
    if (!["admin", "staff"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }

    try {
        // Paginasi WAJIB di sini: Supabase motong SELECT di 1000 baris tanpa
        // error. Tanpa ini, begitu order lewat 1000 omzetnya diam-diam salah,
        // dan peta kode->kategori cuma kebaca 1000 dari 11.000+ produk (jadi
        // hampir semua order topup jatuh ke kategori "Lainnya").
        const [orders, topupOrders, topupProducts] = await Promise.all([
            fetchAllRows((from, to) =>
                supabase.from("orders").select("id, total, status, items, created_at").range(from, to)
            ),
            fetchAllRows((from, to) =>
                supabase.from("topup_orders").select("id, harga, status, kode_produk, nama_produk, created_at").range(from, to)
            ),
            fetchAllRows((from, to) =>
                supabase.from("topup_products").select("kode_produk, kategori").range(from, to)
            )
        ]);

        const kodeToKategori = new Map(topupProducts.map(p => [p.kode_produk, p.kategori || "Lainnya"]));

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
            if (!dk || !mk) return; // created_at kosong/rusak — jangan bikin bucket "Invalid Date"
            dayMap.set(dk, (dayMap.get(dk) || 0) + amount);
            monthMap.set(mk, (monthMap.get(mk) || 0) + amount);
        }
        paidOrders.forEach(o => addRevenue(o.created_at, Number(o.total || 0)));
        paidTopups.forEach(t => addRevenue(t.created_at, Number(t.harga || 0)));

        // Deret tanggal dibangun pakai getUTC* dari objek yang udah digeser ke
        // WIB, jadi hasilnya konsisten sama dayKey/monthKey di atas apa pun
        // zona waktu server-nya.
        const todayWib = nowInWib();
        const revenueByDay = [];
        for (let i = 29; i >= 0; i--) {
            const d = new Date(todayWib);
            d.setUTCDate(d.getUTCDate() - i);
            const key = d.toISOString().slice(0, 10);
            revenueByDay.push({ date: key, revenue: dayMap.get(key) || 0 });
        }
        const revenueByMonth = [];
        for (let i = 11; i >= 0; i--) {
            const d = new Date(Date.UTC(todayWib.getUTCFullYear(), todayWib.getUTCMonth() - i, 1));
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
    if (!["admin", "staff"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }

    try {
        // Paginasi supaya laporan CSV gak diam-diam kepotong di 1000 baris.
        const [ordersData, topupData] = await Promise.all([
            fetchAllRows((from, to) =>
                supabase.from("orders")
                    .select("id, recipient_name, recipient_email, total, status, items, created_at")
                    .order("created_at", { ascending: false })
                    .range(from, to)
            ),
            fetchAllRows((from, to) =>
                supabase.from("topup_orders")
                    .select("id, recipient_email, harga, status, nama_produk, tujuan, server_id, created_at")
                    .order("created_at", { ascending: false })
                    .range(from, to)
            )
        ]);

        const rows = [
            ["ID Transaksi", "Jenis", "Tanggal", "Nama Pembeli", "Email", "Item / Game", "Total (IDR)", "Status"]
        ];

        ordersData.forEach(o => {
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

        topupData.forEach(t => {
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
    if (!["admin", "staff"].includes(req.user.role)) {
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
    if (!["admin", "staff"].includes(req.user.role)) {
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

// PUBLIK — Leaderboard Top Spenders
exports.getLeaderboard = async (req, res) => {
    try {
        const [ordersRes, topupRes, manualRes] = await Promise.all([
            supabase.from("orders").select("user_id, recipient_email, recipient_name, total, status").eq("status", SUCCESS_ORDER_STATUS),
            supabase.from("topup_orders").select("user_id, recipient_email, harga, status").eq("status", SUCCESS_TOPUP_STATUS),
            supabase.from("top_spenders").select("*").eq("is_active", true)
        ]);

        if (manualRes.error) {
            console.warn("getLeaderboard: gagal ambil top_spenders:", manualRes.error.message || manualRes.error);
        }

        const manualSpenders = (manualRes.data || [])
            // Baris tanpa display_name (mis. diinsert manual lewat SQL Editor,
            // bukan lewat endpoint addTopSpender yang mewajibkan field ini)
            // dulu bikin m.name.toLowerCase() di bawah throw TypeError dan
            // menjatuhkan seluruh request -- sekarang di-skip dengan aman.
            .filter(m => typeof m.display_name === "string" && m.display_name.trim() !== "")
            .map(m => ({
                id: 'manual_' + m.id,
                name: m.display_name,
                total_spent: Number(m.total_spending || 0),
                avatar_url: m.avatar_url,
                badge: m.badge,
                rank: Number.isFinite(Number(m.rank)) ? Number(m.rank) : 99,
                is_manual: true
            }));

        const spenders = new Map();
        function addSpend(id, email, name, amount) {
            const key = id || email || "Guest";
            if (!spenders.has(key)) {
                spenders.set(key, { 
                    id: key, 
                    name: name || (email ? email.split('@')[0] : "Guest"), 
                    email: email,
                    total_spent: 0,
                    rank: 99, // default rank for dynamic
                    is_manual: false
                });
            }
            spenders.get(key).total_spent += Number(amount || 0);
        }

        if (!ordersRes.error) {
            (ordersRes.data || []).forEach(o => addSpend(o.user_id, o.recipient_email, o.recipient_name, o.total));
        }
        if (!topupRes.error) {
            (topupRes.data || []).forEach(t => addSpend(t.user_id, t.recipient_email, null, t.harga));
        }

        // Filter out Guest
        const dynamicSpenders = [...spenders.values()]
            .filter(u => u.id !== "Guest")
            .map(u => ({
                id: u.id,
                name: (u.name.length > 3 ? u.name.substring(0, 3) + "***" : u.name + "***"), // Mask name for dynamic
                total_spent: u.total_spent,
                avatar_url: null,
                badge: null,
                rank: 99,
                is_manual: false
            }));

        // Merge manual and dynamic. Manual entries override dynamic if names roughly match, but let's just keep both and sort.
        // To avoid duplicates, if an admin injects a name that already exists, we prefer the manual one.
        const manualNames = new Set(manualSpenders.map(m => m.name.toLowerCase()));
        const filteredDynamic = dynamicSpenders.filter(d => !manualNames.has(d.name.toLowerCase().replace('***','')));

        let leaderboard = [...manualSpenders, ...filteredDynamic];

        // Sort by rank first (ascending), then total_spent (descending)
        leaderboard.sort((a, b) => {
            if (a.rank !== b.rank) {
                return a.rank - b.rank;
            }
            return b.total_spent - a.total_spent;
        });

        res.json(leaderboard.slice(0, 10));
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server Error" });
    }
};

// ADMIN — Get all Top Spenders (Manual)
exports.getAdminLeaderboard = async (req, res) => {
    try {
        const { data, error } = await supabase.from("top_spenders").select("*").order("rank", { ascending: true }).order("created_at", { ascending: false });
        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Gagal mengambil data top spenders" });
    }
};

// ADMIN — Add Top Spender
exports.addTopSpender = async (req, res) => {
    try {
        const { display_name, total_spending, avatar_url, badge, rank, is_active } = req.body;
        if (!display_name || total_spending === undefined) {
            return res.status(400).json({ message: "Display Name dan Total Spending wajib diisi" });
        }
        
        const { data, error } = await supabase.from("top_spenders").insert([{
            display_name,
            total_spending: Number(total_spending),
            avatar_url: avatar_url || null,
            badge: badge || null,
            rank: Number(rank) || 99,
            is_active: is_active !== undefined ? is_active : true,
            source: 'manual'
        }]).select().single();

        if (error) throw error;
        res.json({ message: "Top Spender berhasil ditambahkan", data });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Gagal menambah Top Spender" });
    }
};

// ADMIN — Update Top Spender
exports.updateTopSpender = async (req, res) => {
    try {
        const { id } = req.params;
        const { display_name, total_spending, avatar_url, badge, rank, is_active } = req.body;
        
        const updates = {};
        if (display_name !== undefined) updates.display_name = display_name;
        if (total_spending !== undefined) updates.total_spending = Number(total_spending);
        if (avatar_url !== undefined) updates.avatar_url = avatar_url || null;
        if (badge !== undefined) updates.badge = badge || null;
        if (rank !== undefined) updates.rank = Number(rank);
        if (is_active !== undefined) updates.is_active = is_active;
        updates.updated_at = new Date().toISOString();

        const { data, error } = await supabase.from("top_spenders").update(updates).eq("id", id).select().single();

        if (error) throw error;
        res.json({ message: "Top Spender berhasil diupdate", data });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Gagal mengupdate Top Spender" });
    }
};

// ADMIN — Delete Top Spender
exports.deleteTopSpender = async (req, res) => {
    try {
        const { id } = req.params;
        const { error } = await supabase.from("top_spenders").delete().eq("id", id);
        if (error) throw error;
        res.json({ message: "Top Spender berhasil dihapus" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Gagal menghapus Top Spender" });
    }
};
