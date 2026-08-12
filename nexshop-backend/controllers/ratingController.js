const supabase = require("../config/db");

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
                comment: finalComment
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
