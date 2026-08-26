const supabase = require("../config/db");

exports.list = async (req, res) => {
    if (!["admin", "staff"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    try {
        const { data, error } = await supabase
            .from("admin_notifications")
            .select("*")
            .order("created_at", { ascending: false })
            .limit(30);

        if (error) return res.status(500).json({ message: "Database Error" });

        const visibleNotifications = req.user.role === "admin"
            ? (data || [])
            : (data || []).filter((notification) => !notification.recipient_role || ["admin_staff", "staff"].includes(notification.recipient_role));
        const unreadCount = visibleNotifications.filter(n => !n.is_read).length;
        res.json({ notifications: visibleNotifications, unreadCount });
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

exports.markAllRead = async (req, res) => {
    if (!["admin", "staff"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    try {
        let query = supabase
            .from("admin_notifications")
            .select("id, recipient_role")
            .eq("is_read", false);
        const { data: unread, error: readError } = await query;
        if (readError) return res.status(500).json({ message: "Gagal membaca notifikasi" });
        const ids = (unread || [])
            .filter((notification) => req.user.role === "admin" || !notification.recipient_role || ["admin_staff", "staff"].includes(notification.recipient_role))
            .map((notification) => notification.id);
        if (ids.length) {
            const { error } = await supabase
                .from("admin_notifications")
                .update({ is_read: true })
                .in("id", ids);
            if (error) return res.status(500).json({ message: "Gagal update notifikasi" });
        }
        res.json({ message: "OK" });
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};
