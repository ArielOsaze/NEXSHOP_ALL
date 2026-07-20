const supabase = require("../config/db");

exports.list = async (req, res) => {
    if (req.user.role !== "admin") {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    try {
        const { data, error } = await supabase
            .from("admin_notifications")
            .select("*")
            .order("created_at", { ascending: false })
            .limit(30);

        if (error) return res.status(500).json({ message: "Database Error" });

        const unreadCount = (data || []).filter(n => !n.is_read).length;
        res.json({ notifications: data || [], unreadCount });
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

exports.markAllRead = async (req, res) => {
    if (req.user.role !== "admin") {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    try {
        const { error } = await supabase
            .from("admin_notifications")
            .update({ is_read: true })
            .eq("is_read", false);

        if (error) return res.status(500).json({ message: "Gagal update notifikasi" });
        res.json({ message: "OK" });
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};
