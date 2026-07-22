const supabase = require("../config/db");

// ===========================
// GET SEMUA USER (untuk admin dashboard)
// select("*") lalu di-map manual: ini SENGAJA supaya kolom password
// (walau sudah di-hash bcrypt) tidak pernah ikut terkirim ke frontend,
// apapun kolom yang ada di tabel `users`.
// ===========================
exports.getUsers = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("users")
            .select("*")
            .order("id", { ascending: true });

        if (error) {
            console.log(error);
            return res.status(500).json({ message: "Database Error" });
        }

        const users = data.map(u => ({
            id: u.id,
            name: u.fullname,        // kolom di DB namanya fullname, di-alias jadi "name"
            email: u.email,
            role: u.role || "user",
            is_blacklisted: u.is_blacklisted || false,
            created_at: u.created_at || null
        }));

        res.json(users);
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server Error" });
    }
};

// ===========================
// UPDATE ROLE / BLACKLIST USER (admin only)
// ===========================
exports.updateUser = async (req, res) => {
    if (req.user.role !== "admin") {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }

    const { id } = req.params;
    const { role, is_blacklisted } = req.body;

    // admin gak boleh nge-blacklist atau nurunin role dirinya sendiri —
    // biar gak ada kejadian semua admin ke-lock out gak sengaja
    if (String(req.user.id) === String(id)) {
        return res.status(400).json({ message: "Gak bisa mengubah akun sendiri lewat sini" });
    }

    const updatePayload = {};
    if (role !== undefined) {
        if (!["user", "admin"].includes(role)) {
            return res.status(400).json({ message: "Role tidak valid" });
        }
        updatePayload.role = role;
    }
    if (is_blacklisted !== undefined) {
        updatePayload.is_blacklisted = !!is_blacklisted;
    }

    if (Object.keys(updatePayload).length === 0) {
        return res.status(400).json({ message: "Tidak ada perubahan yang dikirim" });
    }

    try {
        const { data, error } = await supabase
            .from("users")
            .update(updatePayload)
            .eq("id", id)
            .select();

        if (error) {
            console.log(error);
            return res.status(500).json({ message: "Gagal update user" });
        }

        if (!data.length) {
            return res.status(404).json({ message: "User tidak ditemukan" });
        }

        res.json({ message: "User berhasil diperbarui", data: data[0] });
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server Error" });
    }
};

// ===========================
// RIWAYAT & STATISTIK BELANJA 1 PELANGGAN (admin only) — gabungan order
// produk biasa + topup diamond, buat lihat customer value per orang.
// ===========================
exports.getUserDetail = async (req, res) => {
    if (req.user.role !== "admin") {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }

    const { id } = req.params;

    try {
        const { data: user, error: userErr } = await supabase
            .from("users")
            .select("id, fullname, email, role, is_blacklisted, created_at")
            .eq("id", id)
            .maybeSingle();

        if (userErr) {
            console.log(userErr);
            return res.status(500).json({ message: "Database Error" });
        }
        if (!user) {
            return res.status(404).json({ message: "User tidak ditemukan" });
        }

        const [ordersRes, topupRes] = await Promise.all([
            supabase.from("orders")
                .select("id, total, status, items, created_at")
                .eq("user_id", id)
                .order("created_at", { ascending: false }),
            supabase.from("topup_orders")
                .select("id, harga, status, kode_produk, nama_produk, tujuan, created_at")
                .eq("user_id", id)
                .order("created_at", { ascending: false })
        ]);

        if (ordersRes.error || topupRes.error) {
            return res.status(500).json({ message: "Gagal mengambil riwayat order" });
        }

        const regularHistory = (ordersRes.data || []).map(o => ({
            type: "regular",
            id: o.id,
            title: (o.items || []).map(i => i.name).filter(Boolean).join(", ") || "Order",
            amount: Number(o.total || 0),
            status: o.status || "pending",
            created_at: o.created_at
        }));

        const topupHistory = (topupRes.data || []).map(t => ({
            type: "topup",
            id: t.id,
            title: t.nama_produk || t.kode_produk,
            amount: Number(t.harga || 0),
            status: t.status || "pending",
            created_at: t.created_at
        }));

        const history = [...regularHistory, ...topupHistory]
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        const paidHistory = history.filter(h => h.status === "paid" || h.status === "sukses");
        const totalSpent = paidHistory.reduce((s, h) => s + h.amount, 0);

        res.json({
            user: {
                id: user.id,
                name: user.fullname,
                email: user.email,
                role: user.role || "user",
                is_blacklisted: user.is_blacklisted || false,
                created_at: user.created_at
            },
            stats: {
                total_orders: history.length,
                total_paid_orders: paidHistory.length,
                total_spent: totalSpent,
                avg_order_value: paidHistory.length ? Math.round(totalSpent / paidHistory.length) : 0,
                last_order_at: history.length ? history[0].created_at : null
            },
            history
        });
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server Error" });
    }
};
