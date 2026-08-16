const supabase = require("../config/db");

// ============================================================================
// Helper: sembunyikan nama asli pembeli untuk tampilan publik (testimoni).
// "Budi Santoso" -> "Budi S." ; nama satu kata dibiarkan apa adanya (sudah
// cukup umum/tidak identifiable sendirian). Tidak pernah menampilkan nomor
// HP/email/Order ID di testimoni publik.
// ============================================================================
function maskPublicName(fullName) {
    const name = String(fullName || "").trim();
    if (!name) return null;
    const parts = name.split(/\s+/);
    if (parts.length === 1) return parts[0];
    return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

// ============================================================================
// Helper: bersihkan nama produk buat konteks testimoni publik. Nama produk
// di katalog internal (tabel `products`) sering ditulis lengkap dengan
// rincian bonus buat ditampilkan di halaman produk, misal
// "5 Diamonds (5 + 0 Bonus)" -- bagus buat listing produk, tapi berantakan
// kalau ditampilkan di kartu testimoni ("Erick — 5 Diamonds (5 + 0 Bonus)").
// Buang bagian kurung di akhir nama supaya jadi "5 Diamonds" saja, konsisten
// sama testimoni topup yang sudah rapi (topup_orders.nama_produk dari
// TokoVoucher, misal "874 Diamond MLBB").
// ============================================================================
function cleanProductContextName(name) {
    const raw = String(name || "").trim();
    if (!raw) return null;
    return raw.replace(/\s*\([^)]*\)\s*$/, "").trim() || raw;
}

// ============================================================================
// Helper: whitelist nama untuk mode "tampilkan nama apa adanya" (show_name).
// Beda sama maskPublicName -- ini dipakai buat mem-verifikasi nama SEBELUM
// ditampilkan mentah ke publik, karena sumbernya tidak selalu terpercaya:
// - topup_ratings.display_name: diketik BEBAS oleh pembeli sendiri saat
//   submit rating, bisa saja (sengaja/tidak sengaja) diisi nomor HP, email,
//   link promo/spam, atau teks aneh -- bukan cuma nama.
// - orders.recipient_name: diisi saat checkout, juga tidak divalidasi
//   sebagai "nama orang" secara ketat.
// Kalau show_name=true tapi nilainya gagal whitelist ini, backend TIDAK
// meloloskannya ke publik -- fallback paksa ke maskPublicName() seolah-olah
// pembeli tidak mencentang show_name. Whitelist: huruf (termasuk aksen),
// spasi, apostrof, tanda hubung, titik saja -- tolak kalau ada angka, "@",
// atau pola link (http/www).
// ============================================================================
function sanitizePublicName(rawName) {
    const name = String(rawName || "").trim();
    if (!name) return null;
    if (name.length > 60) return null;
    if (/\d/.test(name)) return null;                 // nomor HP/PIN dll
    if (/@/.test(name)) return null;                   // email
    if (/(https?:\/\/|www\.)/i.test(name)) return null; // link/spam
    if (!/^[\p{L}\p{M}\s.'-]+$/u.test(name)) return null; // whitelist karakter
    return name;
}

exports.checkEligibility = async (req, res) => {
    try {
        const { orderId } = req.params;
        if (!orderId) {
            return res.status(400).json({ message: "Order ID wajib diisi." });
        }

        // 1. Ambil order
        const { data: order, error: orderErr } = await supabase
            .from("orders")
            .select("id, status, user_id")
            .eq("id", orderId)
            .maybeSingle();

        if (orderErr) {
            return res.status(500).json({ message: "Gagal memverifikasi pesanan." });
        }
        
        // 2. Jika tidak ada
        if (!order) {
            return res.status(404).json({ message: "Pesanan tidak ditemukan." });
        }

        // 3. Status harus paid
        if (order.status !== "paid") {
            return res.json({ eligible: false, reason: "order_not_paid" });
        }

        // 4. Otorisasi
        if (order.user_id !== null) {
            if (!req.user) {
                return res.status(401).json({
                    message: "Silakan login untuk memberi rating pada pesanan ini."
                });
            }
            if (String(req.user.id) !== String(order.user_id)) {
                return res.status(403).json({
                    message: "Kamu tidak berhak memberi rating untuk pesanan ini."
                });
            }
        }

        // 5. Cek rating existing
        const { data: existingRating, error: ratingErr } = await supabase
            .from("order_ratings")
            .select("id")
            .eq("order_id", order.id)
            .maybeSingle();

        if (ratingErr) {
            return res.status(500).json({ message: "Gagal memverifikasi status rating." });
        }

        if (existingRating) {
            return res.json({ eligible: false, reason: "already_rated" });
        }

        return res.json({ eligible: true, reason: null });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ message: "Terjadi kesalahan server." });
    }
};

exports.submitRating = async (req, res) => {
    try {
        const { order_id, score, comment } = req.body;
        if (!order_id) return res.status(400).json({ message: "Order ID wajib diisi." });

        if (!Number.isInteger(score) || score < 1 || score > 5) {
            return res.status(400).json({ message: "Score harus berupa angka 1 sampai 5." });
        }

        let finalComment = null;
        if (typeof comment === "string") {
            finalComment = comment.trim();
            if (finalComment.length > 500) {
                return res.status(400).json({ message: "Komentar maksimal 500 karakter." });
            }
            if (finalComment === "") finalComment = null;
        }

        // Preferensi pembeli: tampilkan nama asli apa adanya di testimoni
        // publik (true) atau tetap disamarkan lewat maskPublicName (false,
        // default). Default false supaya privasi tetap aman kalau frontend
        // lupa mengirim field ini.
        const finalShowName = req.body.show_name === true;

        // 1. Ambil order
        const { data: order, error: orderErr } = await supabase
            .from("orders")
            .select("id, status, user_id")
            .eq("id", order_id)
            .maybeSingle();

        if (orderErr) return res.status(500).json({ message: "Gagal memverifikasi pesanan." });
        
        // 2. Jika tidak ada
        if (!order) return res.status(404).json({ message: "Pesanan tidak ditemukan." });

        // 3. Status harus paid
        if (order.status !== "paid") {
            return res.status(400).json({ message: "Hanya pesanan berstatus sukses/lunas yang dapat dinilai." });
        }

        // 4. Otorisasi
        if (order.user_id !== null) {
            if (!req.user) {
                return res.status(401).json({
                    message: "Silakan login untuk memberi rating pada pesanan ini."
                });
            }
            if (String(req.user.id) !== String(order.user_id)) {
                return res.status(403).json({
                    message: "Kamu tidak berhak memberi rating untuk pesanan ini."
                });
            }
        }

        // Insert
        const { error: insertErr } = await supabase
            .from("order_ratings")
            .insert([{
                order_id: order.id,
                user_id: order.user_id,
                score,
                comment: finalComment,
                show_name: finalShowName
            }]);

        if (insertErr) {
            // Error code 23505 adalah unique_violation di PostgreSQL (Supabase)
            if (insertErr.code === "23505") {
                return res.status(409).json({ message: "Rating untuk order ini sudah pernah dikirim." });
            }
            console.error(insertErr);
            return res.status(500).json({ message: "Gagal menyimpan rating." });
        }

        return res.status(201).json({ message: "Terima kasih atas penilaian Anda!" });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ message: "Terjadi kesalahan server." });
    }
};

exports.getAdminRatings = async (req, res) => {
    try {
        const { page = "1", limit = "10", score, buyer_type, search, date_from, date_to } = req.query;
        
        let pageNum = parseInt(page, 10);
        let limitNum = parseInt(limit, 10);

        if (isNaN(pageNum) || pageNum < 1) pageNum = 1;
        if (isNaN(limitNum) || limitNum < 1) limitNum = 10;
        if (limitNum > 100) limitNum = 100;

        const offset = (pageNum - 1) * limitNum;

        let query = supabase
            .from("order_ratings")
            .select(`
                id,
                score,
                comment,
                created_at,
                order_id,
                user_id,
                orders ( recipient_name, total )
            `, { count: "exact" });

        if (score && ["1","2","3","4","5"].includes(score)) {
            query = query.eq("score", parseInt(score, 10));
        }

        if (buyer_type === "login") {
            query = query.not("user_id", "is", null);
        } else if (buyer_type === "guest") {
            query = query.is("user_id", null);
        }

        if (date_from) {
            const fromDate = new Date(`${date_from}T00:00:00+07:00`);
            if (!isNaN(fromDate)) query = query.gte("created_at", fromDate.toISOString());
        }

        if (date_to) {
            const toDate = new Date(`${date_to}T23:59:59.999+07:00`);
            if (!isNaN(toDate)) query = query.lte("created_at", toDate.toISOString());
        }

        if (search && search.trim() !== "") {
            const safeSearch = search.trim();
            const { data: searchOrders } = await supabase
                .from("orders")
                .select("id")
                .or(`id.ilike.%${safeSearch}%,recipient_name.ilike.%${safeSearch}%`);
            
            let orderIdsFilter = [safeSearch];
            if (searchOrders && searchOrders.length > 0) {
                orderIdsFilter = searchOrders.map(o => o.id);
            }
            query = query.in("order_id", orderIdsFilter);
        }

        query = query
            .order("created_at", { ascending: false })
            .range(offset, offset + limitNum - 1);

        const { data, count, error } = await query;
        if (error) {
            console.error(error);
            return res.status(500).json({ message: "Gagal mengambil data rating." });
        }

        const totalPages = Math.ceil((count || 0) / limitNum);

        const formattedData = data.map(d => ({
            id: d.id,
            order_id: d.order_id,
            score: d.score,
            comment: d.comment,
            created_at: d.created_at,
            buyer_name: d.orders?.recipient_name || "Unknown",
            total: d.orders?.total || 0,
            is_guest: d.user_id === null
        }));

        res.json({
            data: formattedData,
            meta: {
                page: pageNum,
                limit: limitNum,
                total: count || 0,
                totalPages
            }
        });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ message: "Terjadi kesalahan server." });
    }
};

exports.getAdminRatingSummary = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("order_ratings")
            .select("score, created_at");

        if (error) {
            console.error(error);
            return res.status(500).json({ message: "Gagal mengambil data agregat rating." });
        }

        if (!data || data.length === 0) {
            return res.json({
                average: 0,
                total: 0,
                positive_percentage: 0,
                today_count: 0,
                distribution: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 }
            });
        }

        let totalScore = 0;
        let positiveCount = 0;
        let todayCount = 0;
        const dist = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };

        // Dapatkan string YYYY-MM-DD hari ini dalam Asia/Jakarta
        const nowInJakarta = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }));
        const year = nowInJakarta.getFullYear();
        const month = String(nowInJakarta.getMonth() + 1).padStart(2, '0');
        const day = String(nowInJakarta.getDate()).padStart(2, '0');
        const todayStr = `${year}-${month}-${day}`;

        for (const r of data) {
            totalScore += r.score;
            if (r.score >= 4) positiveCount++;
            dist[String(r.score)] = (dist[String(r.score)] || 0) + 1;

            const ratingDateInJakarta = new Date(new Date(r.created_at).toLocaleString("en-US", { timeZone: "Asia/Jakarta" }));
            const rYear = ratingDateInJakarta.getFullYear();
            const rMonth = String(ratingDateInJakarta.getMonth() + 1).padStart(2, '0');
            const rDay = String(ratingDateInJakarta.getDate()).padStart(2, '0');
            const rTodayStr = `${rYear}-${rMonth}-${rDay}`;
            
            if (rTodayStr === todayStr) {
                todayCount++;
            }
        }

        const average = data.length > 0 ? (totalScore / data.length).toFixed(1) : 0;
        const positivePercentage = data.length > 0 ? Math.round((positiveCount / data.length) * 100) : 0;

        res.json({
            average: parseFloat(average),
            total: data.length,
            positive_percentage: positivePercentage,
            today_count: todayCount,
            distribution: dist
        });

    } catch (e) {
        console.error(e);
        return res.status(500).json({ message: "Terjadi kesalahan server." });
    }
};

// ============================================================================
// FEATURE: Rating untuk topup (Agustus 2026) — sebelumnya cuma order produk
// yang bisa dirating (order_ratings ber-FK ke tabel `orders`). Topup dapat
// tabel terpisah `topup_ratings` (lihat migrations/002_create_topup_ratings.sql)
// supaya tidak perlu ubah constraint tabel order_ratings yang sudah ada.
// Logic-nya sengaja dibuat mirip persis checkEligibility/submitRating di atas
// (paritas fitur), bedanya: cek ke topup_orders (status "sukses", bukan
// "paid") dan terima display_name opsional (topup checkout tidak pernah
// mengumpulkan nama pembeli sama sekali).
// ============================================================================

exports.checkTopupEligibility = async (req, res) => {
    try {
        const { orderId } = req.params;
        if (!orderId) {
            return res.status(400).json({ message: "Order ID wajib diisi." });
        }

        const { data: order, error: orderErr } = await supabase
            .from("topup_orders")
            .select("id, status, user_id")
            .eq("id", orderId)
            .maybeSingle();

        if (orderErr) {
            return res.status(500).json({ message: "Gagal memverifikasi pesanan." });
        }
        if (!order) {
            return res.status(404).json({ message: "Pesanan tidak ditemukan." });
        }
        if (order.status !== "sukses") {
            return res.json({ eligible: false, reason: "order_not_paid" });
        }

        if (order.user_id !== null) {
            if (!req.user) {
                return res.status(401).json({
                    message: "Silakan login untuk memberi rating pada pesanan ini."
                });
            }
            if (String(req.user.id) !== String(order.user_id)) {
                return res.status(403).json({
                    message: "Kamu tidak berhak memberi rating untuk pesanan ini."
                });
            }
        }

        const { data: existingRating, error: ratingErr } = await supabase
            .from("topup_ratings")
            .select("id")
            .eq("order_id", order.id)
            .maybeSingle();

        if (ratingErr) {
            // Kode 42P01 = tabel belum ada (migration belum dijalankan).
            // Beri pesan yang jelas ketimbang 500 generik.
            if (ratingErr.code === "42P01") {
                return res.status(500).json({
                    message: "Fitur rating topup belum di-setup di database (tabel topup_ratings belum ada)."
                });
            }
            return res.status(500).json({ message: "Gagal memverifikasi status rating." });
        }

        if (existingRating) {
            return res.json({ eligible: false, reason: "already_rated" });
        }

        return res.json({ eligible: true, reason: null });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ message: "Terjadi kesalahan server." });
    }
};

exports.submitTopupRating = async (req, res) => {
    try {
        const { order_id, score, comment, display_name } = req.body;
        if (!order_id) return res.status(400).json({ message: "Order ID wajib diisi." });

        if (!Number.isInteger(score) || score < 1 || score > 5) {
            return res.status(400).json({ message: "Score harus berupa angka 1 sampai 5." });
        }

        let finalComment = null;
        if (typeof comment === "string") {
            finalComment = comment.trim();
            if (finalComment.length > 500) {
                return res.status(400).json({ message: "Komentar maksimal 500 karakter." });
            }
            if (finalComment === "") finalComment = null;
        }

        let finalDisplayName = null;
        if (typeof display_name === "string") {
            finalDisplayName = display_name.trim().slice(0, 60);
            if (finalDisplayName === "") finalDisplayName = null;
        }

        // Sama seperti submitRating: preferensi pembeli tampilkan nama asli
        // atau disamarkan (default false = disamarkan).
        const finalShowName = req.body.show_name === true;

        // Kalau pembeli minta nama ditampilkan apa adanya, validasi di titik
        // input juga (bukan cuma di getPublicTestimonials) -- supaya dapat
        // pesan error yang jelas kalau ternyata isiannya bukan nama (nomor
        // HP/email/link), bukan diam-diam disensor tanpa mereka sadari.
        if (finalShowName && finalDisplayName && !sanitizePublicName(finalDisplayName)) {
            return res.status(400).json({
                message: "Nama tidak valid untuk ditampilkan publik (hanya huruf, spasi, tanda hubung/apostrof). Jangan isi nomor HP, email, atau link."
            });
        }

        const { data: order, error: orderErr } = await supabase
            .from("topup_orders")
            .select("id, status, user_id")
            .eq("id", order_id)
            .maybeSingle();

        if (orderErr) return res.status(500).json({ message: "Gagal memverifikasi pesanan." });
        if (!order) return res.status(404).json({ message: "Pesanan tidak ditemukan." });

        if (order.status !== "sukses") {
            return res.status(400).json({ message: "Hanya pesanan berstatus sukses yang dapat dinilai." });
        }

        if (order.user_id !== null) {
            if (!req.user) {
                return res.status(401).json({
                    message: "Silakan login untuk memberi rating pada pesanan ini."
                });
            }
            if (String(req.user.id) !== String(order.user_id)) {
                return res.status(403).json({
                    message: "Kamu tidak berhak memberi rating untuk pesanan ini."
                });
            }
        }

        const { error: insertErr } = await supabase
            .from("topup_ratings")
            .insert([{
                order_id: order.id,
                user_id: order.user_id,
                score,
                comment: finalComment,
                display_name: finalDisplayName,
                show_name: finalShowName
            }]);

        if (insertErr) {
            if (insertErr.code === "23505") {
                return res.status(409).json({ message: "Rating untuk order ini sudah pernah dikirim." });
            }
            if (insertErr.code === "42P01") {
                return res.status(500).json({
                    message: "Fitur rating topup belum di-setup di database (tabel topup_ratings belum ada)."
                });
            }
            console.error(insertErr);
            return res.status(500).json({ message: "Gagal menyimpan rating." });
        }

        return res.status(201).json({ message: "Terima kasih atas penilaian Anda!" });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ message: "Terjadi kesalahan server." });
    }
};

// ============================================================================
// FEATURE: Testimoni publik ("Apa Kata Mereka") — dipakai section homepage,
// TIDAK butuh login (publik). Gabungan rating produk (order_ratings) + rating
// topup (topup_ratings), cuma yang score tinggi (>=4) DAN ada komentar teks
// (rating tanpa komentar tidak berguna sebagai testimoni). Nama pembeli
// disamarkan (lihat maskPublicName) -- tidak pernah expose nama lengkap,
// email, no. HP, atau Order ID ke publik.
//
// CATATAN MODERASI (penting dibaca sebelum production): endpoint ini
// otomatis mempublikasikan SEMUA rating skor>=4 berkomentar begitu masuk --
// TIDAK ada tahap approval admin. Kalau nanti butuh kontrol kurasi (misal
// ada komentar yang tidak pantas meski skornya tinggi), tambahkan kolom
// `is_featured boolean default false` di kedua tabel rating + UI toggle di
// admin dashboard, lalu tambahkan `.eq("is_featured", true)` di query bawah.
// Saya sengaja TIDAK membangun itu sekarang karena butuh UI admin baru
// (di luar cakupan yang diminta) -- tapi ini limitasi nyata yang perlu tim
// tahu, bukan cuma catatan implementasi.
// ============================================================================
exports.getPublicTestimonials = async (req, res) => {
    try {
        // Testimoni ini sering berubah (admin nambah/edit testimoni kustom
        // kapan aja dari dashboard) -- header di bawah maksa browser DAN
        // CDN/proxy di depan server (Cloudflare, dsb) supaya SELALU ambil
        // response fresh dari server ini, gak pernah nyimpen/nyajiin versi
        // lama dari cache. Tanpa ini, testimoni yang baru diedit/dihapus di
        // admin bisa tetap keliatan versi lama di homepage sampai cache-nya
        // expired sendiri atau di-purge manual.
        res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
        res.set("Pragma", "no-cache");
        res.set("Expires", "0");
        res.set("Surrogate-Control", "no-store"); // dihormati sebagian besar CDN (termasuk Cloudflare) sebagai sinyal "jangan cache ini di edge"

        const limitParam = parseInt(req.query.limit, 10);
        const limit = Number.isInteger(limitParam) && limitParam > 0 && limitParam <= 50 ? limitParam : 20;

        // Testimoni kustom (diatur manual dari admin dashboard) -- ambil
        // duluan supaya bisa digabung sama rating asli di bawah. Kalau
        // tabelnya belum di-migrate (42P01), skip aja, jangan gagalkan
        // seluruh endpoint.
        const { data: customTestimonials, error: customErr } = await supabase
            .from("custom_testimonials")
            .select("id, name, avatar_url, score, product_name, comment, display_order, created_at")
            .eq("is_active", true)
            .order("display_order", { ascending: true })
            .order("created_at", { ascending: false })
            .limit(limit);

        if (customErr && customErr.code !== "42P01") {
            console.error("[Testimonials] custom_testimonials query gagal:", customErr);
        }

        const { data: orderRatings, error: orderRatingsErr } = await supabase
            .from("order_ratings")
            .select("id, score, comment, created_at, show_name, orders ( recipient_name, items )")
            .gte("score", 4)
            .not("comment", "is", null)
            .order("created_at", { ascending: false })
            .limit(limit);

        if (orderRatingsErr) {
            console.error("[Testimonials] order_ratings query gagal:", orderRatingsErr);
        }

        const { data: topupRatings, error: topupRatingsErr } = await supabase
            .from("topup_ratings")
            .select("id, score, comment, display_name, show_name, created_at, topup_orders ( nama_produk )")
            .gte("score", 4)
            .not("comment", "is", null)
            .order("created_at", { ascending: false })
            .limit(limit);

        if (topupRatingsErr && topupRatingsErr.code !== "42P01") {
            // 42P01 = tabel topup_ratings belum di-migrate. Jangan gagalkan
            // seluruh testimoni cuma karena itu -- cukup skip bagian topup,
            // testimoni order tetap tampil.
            console.error("[Testimonials] topup_ratings query gagal:", topupRatingsErr);
        }

        const orderList = orderRatings || [];
        const firstProductIds = orderList
            .map(r => (Array.isArray(r.orders?.items) ? r.orders.items[0]?.id : null))
            .filter(Boolean);

        let productNameMap = {};
        if (firstProductIds.length) {
            const { data: products } = await supabase
                .from("products")
                .select("id, name")
                .in("id", firstProductIds);
            (products || []).forEach(p => { productNameMap[String(p.id)] = p.name; });
        }

        const combined = [
            // Testimoni kustom dulu -- ini yang sengaja dikurasi/dibuat admin,
            // jadi diprioritaskan tampil duluan (sort di bawah pakai flag
            // _pinned supaya urutannya tetap di depan sebelum rating asli).
            ...(customTestimonials || []).map(r => ({
                score: r.score,
                comment: r.comment,
                // Testimoni kustom diinput manual oleh admin -- nama admin
                // yang ketik dianggap sudah sengaja dan tidak disamarkan.
                // Nama produk tetap dilewatkan cleanProductContextName()
                // supaya konsisten kalau admin menempel nama mentah dari
                // katalog internal (mis. "5 Diamonds (5 + 0 Bonus)").
                name: r.name || "Pembeli NexShop",
                context: cleanProductContextName(r.product_name) || "Produk NexShop",
                avatar: r.avatar_url || null,
                created_at: r.created_at,
                _pinned: true,
                _order: r.display_order ?? 0
            })),
            ...orderList.map(r => {
                const firstItemId = Array.isArray(r.orders?.items) ? r.orders.items[0]?.id : null;
                return {
                    score: r.score,
                    comment: r.comment,
                    // show_name: pilihan eksplisit pembeli saat submit rating.
                    // true = tampilkan nama asli apa adanya, TAPI harus lolos
                    // sanitizePublicName() dulu -- kalau tidak lolos (mis.
                    // ternyata isinya nomor HP), backend paksa fallback ke
                    // versi disamarkan, bukan meloloskannya ke publik.
                    name: (r.show_name && sanitizePublicName(r.orders?.recipient_name))
                        || maskPublicName(r.orders?.recipient_name)
                        || "Pembeli NexShop",
                    context: firstItemId ? (cleanProductContextName(productNameMap[String(firstItemId)]) || "Produk NexShop") : "Produk NexShop",
                    avatar: null,
                    created_at: r.created_at,
                    _pinned: false
                };
            }),
            ...(topupRatings || []).map(r => ({
                score: r.score,
                comment: r.comment,
                name: (r.show_name && sanitizePublicName(r.display_name))
                    || maskPublicName(r.display_name)
                    || "Pembeli Topup",
                context: cleanProductContextName(r.topup_orders?.nama_produk) || "Topup Game",
                avatar: null,
                created_at: r.created_at,
                _pinned: false
            }))
        ]
            .filter(r => r.comment && r.comment.trim().length > 0)
            .sort((a, b) => {
                if (a._pinned !== b._pinned) return a._pinned ? -1 : 1;
                if (a._pinned && b._pinned) return (a._order ?? 0) - (b._order ?? 0);
                return new Date(b.created_at) - new Date(a.created_at);
            })
            .slice(0, limit)
            .map(({ _pinned, _order, ...rest }) => rest);

        res.json(combined);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: "Gagal mengambil testimoni." });
    }
};

// ============================================================================
// FEATURE: CRUD Testimoni Kustom (Admin Dashboard) -- lihat komentar &
// migrations/003_create_custom_testimonials.sql. Admin bisa bikin testimoni
// "Apa Kata Mereka" secara manual: nama, rating bintang, foto profil (avatar_url
// diisi hasil upload lewat POST /api/upload?type=avatar yang sudah ada), dan
// nama produk yang dibeli. Dipakai untuk mengisi/mengkurasi section testimoni
// homepage tanpa bergantung sepenuhnya pada rating asli dari pembeli.
// ============================================================================

function validateCustomTestimonialBody(body, { partial = false } = {}) {
    const out = {};
    const errors = [];

    if (!partial || body.name !== undefined) {
        const name = String(body.name || "").trim();
        if (!name) errors.push("Nama wajib diisi.");
        else if (name.length > 80) errors.push("Nama maksimal 80 karakter.");
        out.name = name;
    }

    if (!partial || body.score !== undefined) {
        const score = parseInt(body.score, 10);
        if (!Number.isInteger(score) || score < 1 || score > 5) errors.push("Rating harus angka 1 sampai 5.");
        out.score = score;
    }

    if (!partial || body.comment !== undefined) {
        const comment = String(body.comment || "").trim();
        if (!comment) errors.push("Isi testimoni wajib diisi.");
        else if (comment.length > 300) errors.push("Isi testimoni maksimal 300 karakter.");
        out.comment = comment;
    }

    if (!partial || body.product_name !== undefined) {
        out.product_name = String(body.product_name || "").trim().slice(0, 100) || null;
    }

    if (!partial || body.avatar_url !== undefined) {
        const avatarUrl = String(body.avatar_url || "").trim();
        out.avatar_url = avatarUrl || null;
    }

    if (!partial || body.is_active !== undefined) {
        out.is_active = body.is_active === undefined ? true : Boolean(body.is_active);
    }

    if (!partial || body.display_order !== undefined) {
        const order = parseInt(body.display_order, 10);
        out.display_order = Number.isInteger(order) ? order : 0;
    }

    return { out, errors };
}

exports.getAdminCustomTestimonials = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("custom_testimonials")
            .select("*")
            .order("display_order", { ascending: true })
            .order("created_at", { ascending: false });

        if (error) {
            if (error.code === "42P01") {
                return res.status(500).json({
                    message: "Fitur testimoni kustom belum di-setup di database (tabel custom_testimonials belum ada). Jalankan migrations/003_create_custom_testimonials.sql."
                });
            }
            console.error(error);
            return res.status(500).json({ message: "Gagal mengambil data testimoni kustom." });
        }

        res.json(data || []);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: "Terjadi kesalahan server." });
    }
};

exports.createCustomTestimonial = async (req, res) => {
    try {
        const { out, errors } = validateCustomTestimonialBody(req.body, { partial: false });
        if (errors.length) return res.status(400).json({ message: errors[0] });

        const { data, error } = await supabase
            .from("custom_testimonials")
            .insert([out])
            .select()
            .single();

        if (error) {
            if (error.code === "42P01") {
                return res.status(500).json({
                    message: "Fitur testimoni kustom belum di-setup di database (tabel custom_testimonials belum ada). Jalankan migrations/003_create_custom_testimonials.sql."
                });
            }
            console.error(error);
            return res.status(500).json({ message: "Gagal menyimpan testimoni." });
        }

        res.status(201).json(data);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: "Terjadi kesalahan server." });
    }
};

exports.updateCustomTestimonial = async (req, res) => {
    try {
        const { id } = req.params;
        const { out, errors } = validateCustomTestimonialBody(req.body, { partial: true });
        if (errors.length) return res.status(400).json({ message: errors[0] });

        if (Object.keys(out).length === 0) {
            return res.status(400).json({ message: "Tidak ada perubahan untuk disimpan." });
        }
        out.updated_at = new Date().toISOString();

        const { data, error } = await supabase
            .from("custom_testimonials")
            .update(out)
            .eq("id", id)
            .select()
            .maybeSingle();

        if (error) {
            console.error(error);
            return res.status(500).json({ message: "Gagal mengupdate testimoni." });
        }
        if (!data) return res.status(404).json({ message: "Testimoni tidak ditemukan." });

        res.json(data);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: "Terjadi kesalahan server." });
    }
};

exports.deleteCustomTestimonial = async (req, res) => {
    try {
        const { id } = req.params;
        const { error } = await supabase
            .from("custom_testimonials")
            .delete()
            .eq("id", id);

        if (error) {
            console.error(error);
            return res.status(500).json({ message: "Gagal menghapus testimoni." });
        }

        res.json({ message: "Testimoni berhasil dihapus." });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: "Terjadi kesalahan server." });
    }
};
