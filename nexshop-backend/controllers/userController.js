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
