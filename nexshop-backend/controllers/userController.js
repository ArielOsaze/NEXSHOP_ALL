const supabase = require("../config/db");
const { sendOtpEmail } = require("../config/mailer");
const { notify } = require("../config/notify");
const { generateOtp, OTP_EXPIRY_MINUTES } = require("./authController");
const { normalizePhoneNumber } = require("../utils/phoneNumber");

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
        if (!["user", "staff", "admin"].includes(role)) {
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
    if (!["admin", "staff"].includes(req.user.role)) {
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

// ===========================================================
// OTP AKTIF (admin only) — daftar akun yang masih menunggu verifikasi OTP.
// Kode OTP TIDAK ditampilkan ke admin (keamanan). Admin hanya bisa lihat
// status dan klik "Kirim Ulang" jika pengiriman asli gagal.
// ===========================================================
exports.getPendingOtp = async (req, res) => {
    if (!["admin", "staff"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak, butuh izin admin/staff" });
    }

    try {
        const { data, error } = await supabase
            .from("users")
            .select("id, fullname, email, otp_expires_at, email_verified")
            .eq("email_verified", false)
            .not("otp_expires_at", "is", null)
            .order("otp_expires_at", { ascending: false });

        if (error) {
            console.log(error);
            return res.status(500).json({ message: "Database Error" });
        }

        const now = new Date();
        const list = (data || []).map(u => ({
            id: u.id,
            name: u.fullname,
            email: u.email,
            has_otp: true,
            otp_expires_at: u.otp_expires_at,
            is_expired: !u.otp_expires_at || new Date(u.otp_expires_at) < now
        }));

        res.json(list);
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server Error" });
    }
};

// Admin generate + kirim ulang kode OTP baru buat 1 user tertentu — dipakai
// pas email OTP asli gagal terkirim (misal Brevo key belum/salah diisi) dan
// user gak bisa minta kirim ulang sendiri (mis. dari CS/WhatsApp).
exports.adminResendOtp = async (req, res) => {
    if (!["admin", "staff"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }

    const { id } = req.params;
    const crypto = require("crypto");

    try {
        const { data: user, error } = await supabase
            .from("users")
            .select("id, email, email_verified, phone")
            .eq("id", id)
            .maybeSingle();

        if (error) {
            console.log(error);
            return res.status(500).json({ message: "Database Error" });
        }
        if (!user) {
            return res.status(404).json({ message: "User tidak ditemukan" });
        }
        if (user.email_verified) {
            return res.status(400).json({ message: "Akun ini sudah terverifikasi, gak perlu OTP lagi" });
        }

        const otp = generateOtp();
        const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");
        const otpExpiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString();

        const { error: updateErr } = await supabase
            .from("users")
            .update({ otp_code: hashedOtp, otp_expires_at: otpExpiresAt })
            .eq("id", user.id);

        if (updateErr) {
            console.log(updateErr);
            return res.status(500).json({ message: "Gagal membuat kode OTP baru" });
        }

        let deliverySent = false;
        let deliveryChannel = "email";

        try {
            // Coba kirim via WA jika user punya nomor, kalau gagal fallback email
            if (user.phone) {
                const { sendUserWhatsApp } = require("../services/userWhatsAppService");
                const resWA = await sendUserWhatsApp(user.phone, "otp", { otp });
                if (resWA.success) {
                    deliverySent = true;
                    deliveryChannel = "whatsapp";
                }
            }
            if (!deliverySent) {
                await sendOtpEmail(user.email, otp);
                deliverySent = true;
                deliveryChannel = "email";
            }
        } catch (mailErr) {
            console.log("Admin resend OTP - gagal kirim:", mailErr.message);
            deliverySent = false;
        }

        if (!deliverySent) {
            return res.json({
                message: "Kode OTP baru dibuat, tapi gagal terkirim. Minta user klik 'Kirim Ulang OTP' dari halaman verifikasi.",
                deliverySent: false,
                deliveryChannel
            });
        }

        res.json({
            message: `Kode OTP baru berhasil dikirim ke ${deliveryChannel === "whatsapp" ? "WhatsApp" : "email"} ${user.email}`,
            deliverySent: true,
            deliveryChannel
        });
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server Error" });
    }
};

// ===========================================================
// HAPUS USER (admin only) — hapus akun beserta seluruh riwayat pesanan
// (order produk biasa + topup diamond). Ini PERMANEN, gak bisa di-undo.
// ===========================================================
exports.deleteUser = async (req, res) => {
    if (req.user.role !== "admin") {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }

    const { id } = req.params;

    if (String(req.user.id) === String(id)) {
        return res.status(400).json({ message: "Gak bisa menghapus akun sendiri" });
    }

    try {
        const { data: user, error: findErr } = await supabase
            .from("users")
            .select("id, email, role")
            .eq("id", id)
            .maybeSingle();

        if (findErr) {
            console.log(findErr);
            return res.status(500).json({ message: "Database Error" });
        }
        if (!user) {
            return res.status(404).json({ message: "User tidak ditemukan" });
        }

        // hapus riwayat dulu (order produk biasa + topup diamond) baru
        // akunnya sendiri, supaya gak ada data nyangkut nunjuk ke user_id
        // yang udah gak ada
        const [ordersDel, topupDel] = await Promise.all([
            supabase.from("orders").delete().eq("user_id", id),
            supabase.from("topup_orders").delete().eq("user_id", id)
        ]);

        if (ordersDel.error) {
            console.log(ordersDel.error);
            return res.status(500).json({ message: "Gagal menghapus riwayat order user" });
        }
        if (topupDel.error) {
            console.log(topupDel.error);
            return res.status(500).json({ message: "Gagal menghapus riwayat topup user" });
        }

        const { error: userDelErr } = await supabase
            .from("users")
            .delete()
            .eq("id", id);

        if (userDelErr) {
            console.log(userDelErr);
            return res.status(500).json({ message: "Gagal menghapus akun user" });
        }

        notify("users", `🗑️ ${req.user.email} menghapus akun user ${user.email} beserta seluruh riwayat pesanannya`);
        res.json({ message: "User beserta riwayat pesanannya berhasil dihapus" });
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server Error" });
    }
};

exports.updateOwnAvatar = async (req, res) => {
    const { avatar_url } = req.body;
    let cleanAvatarUrl = "";
    try {
        if (typeof avatar_url !== "string" || avatar_url.length > 2048 || /[\u0000-\u001f\u007f]/.test(avatar_url)) throw new Error();
        const parsed = new URL(avatar_url.trim());
        if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error();
        cleanAvatarUrl = parsed.toString();
    } catch (_) {
        return res.status(400).json({ message: "avatar_url tidak valid" });
    }
    try {
        const { data, error } = await supabase
            .from("users")
            .update({ avatar_url: cleanAvatarUrl })
            .eq("id", req.user.id)
            .select("id, avatar_url");
            
        if (error) {
            console.error(error);
            return res.status(500).json({ message: "Gagal update foto profil" });
        }
        res.json({ message: "Foto profil diperbarui", avatar_url: data[0].avatar_url });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server Error" });
    }
};

exports.updateOwnPhone = async (req, res) => {
    let { phone } = req.body;
    if (!phone || typeof phone !== "string") {
        return res.status(400).json({ message: "Nomor WhatsApp tidak valid" });
    }
    
    phone = normalizePhoneNumber(phone);
    if (!phone || phone.length < 9) {
        return res.status(400).json({ message: "Nomor WhatsApp tidak valid" });
    }

    try {
        const { data: existing, error: findErr } = await supabase
            .from("users")
            .select("id")
            .eq("phone", phone)
            .neq("id", req.user.id)
            .maybeSingle();

        if (findErr) {
            console.error(findErr);
            return res.status(500).json({ message: "Database Error" });
        }

        if (existing) {
            return res.status(400).json({ message: "Nomor WhatsApp tersebut sudah terdaftar pada akun lain." });
        }

        const { data, error } = await supabase
            .from("users")
            .update({ phone })
            .eq("id", req.user.id)
            .select("id, phone");
            
        if (error) {
            console.error(error);
            if (error.code === '23505' && error.message && error.message.includes('users_phone_key')) {
                return res.status(400).json({ message: "Nomor WhatsApp tersebut sudah terdaftar pada akun lain." });
            }
            return res.status(500).json({ message: "Gagal update nomor telepon" });
        }
        res.json({ message: "Nomor telepon diperbarui", phone: data[0].phone });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server Error" });
    }
};
