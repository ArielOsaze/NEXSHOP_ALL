const supabase = require("../config/db");
const { notify } = require("../config/notify");

function computeDiscount(promo, subtotal) {
    let discount = 0;
    if (promo.discount_type === "percent") {
        discount = (subtotal * Number(promo.discount_value)) / 100;
        if (promo.max_discount) {
            discount = Math.min(discount, Number(promo.max_discount));
        }
    } else {
        discount = Number(promo.discount_value);
    }
    // gak boleh sampai bikin total negatif
    return Math.min(discount, subtotal);
}

// Dipakai internal (checkout) DAN publik (tombol "Terapkan" di halaman toko)
async function validatePromoCode(code, subtotal) {
    if (!code) return { valid: false, message: "Kode promo wajib diisi" };

    const { data: promo, error } = await supabase
        .from("promo_codes")
        .select("*")
        .eq("code", code.toUpperCase().trim())
        .maybeSingle();

    if (error || !promo) {
        return { valid: false, message: "Kode promo tidak ditemukan" };
    }
    if (!promo.is_active) {
        return { valid: false, message: "Kode promo sudah tidak aktif" };
    }
    if (promo.expires_at && new Date(promo.expires_at) < new Date()) {
        return { valid: false, message: "Kode promo sudah kedaluwarsa" };
    }
    if (promo.max_uses !== null && promo.used_count >= promo.max_uses) {
        return { valid: false, message: "Kode promo sudah mencapai batas pemakaian" };
    }
    if (subtotal < Number(promo.min_purchase || 0)) {
        return {
            valid: false,
            message: `Minimal belanja ${rupiahServer(promo.min_purchase)} untuk pakai kode ini`
        };
    }

    const discount = computeDiscount(promo, subtotal);
    return { valid: true, promo, discount };
}

function rupiahServer(n) {
    return "Rp" + Number(n).toLocaleString("id-ID");
}

// ===========================================================
// PUBLIK — validasi kode dari halaman toko (dipanggil pas klik "Terapkan")
// ===========================================================
exports.validate = async (req, res) => {
    const { code, subtotal } = req.body;

    if (!subtotal || subtotal <= 0) {
        return res.status(400).json({ valid: false, message: "Subtotal tidak valid" });
    }

    const result = await validatePromoCode(code, Number(subtotal));
    if (!result.valid) {
        return res.status(400).json(result);
    }

    res.json({
        valid: true,
        code: result.promo.code,
        discount: result.discount,
        discount_type: result.promo.discount_type,
        discount_value: result.promo.discount_value,
        description: result.promo.description
    });
};

// ===========================================================
// ADMIN — CRUD kode promo
// ===========================================================
exports.getAll = async (req, res) => {
    if (req.user.role !== "admin") {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    try {
        const { data, error } = await supabase
            .from("promo_codes")
            .select("*")
            .order("created_at", { ascending: false });

        if (error) return res.status(500).json({ message: "Database Error" });
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

exports.create = async (req, res) => {
    if (req.user.role !== "admin") {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }

    const { code, description, discount_type, discount_value, max_discount, min_purchase, max_uses, is_active, expires_at } = req.body;

    if (!code || !discount_value) {
        return res.status(400).json({ message: "Kode dan nilai diskon wajib diisi" });
    }
    if (!["percent", "fixed"].includes(discount_type)) {
        return res.status(400).json({ message: "Tipe diskon tidak valid" });
    }

    try {
        const { data, error } = await supabase
            .from("promo_codes")
            .insert([{
                code: code.toUpperCase().trim(),
                description,
                discount_type,
                discount_value: Number(discount_value),
                max_discount: max_discount ? Number(max_discount) : null,
                min_purchase: Number(min_purchase || 0),
                max_uses: max_uses ? Number(max_uses) : null,
                is_active: is_active !== undefined ? !!is_active : true,
                expires_at: expires_at || null
            }])
            .select();

        if (error) {
            if (error.code === "23505") {
                return res.status(400).json({ message: "Kode promo ini sudah ada" });
            }
            console.log(error);
            return res.status(500).json({ message: "Gagal membuat kode promo" });
        }

        notify("promo_code", `🎟️ ${req.user.email} membuat kode promo "${data[0].code}"`);
        res.status(201).json({ message: "Kode promo berhasil dibuat", data: data[0] });
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server Error" });
    }
};

exports.update = async (req, res) => {
    if (req.user.role !== "admin") {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }

    const { id } = req.params;
    const { description, discount_type, discount_value, max_discount, min_purchase, max_uses, is_active, expires_at } = req.body;

    const payload = { updated_at: new Date().toISOString() };
    if (description !== undefined) payload.description = description;
    if (discount_type !== undefined) payload.discount_type = discount_type;
    if (discount_value !== undefined) payload.discount_value = Number(discount_value);
    if (max_discount !== undefined) payload.max_discount = max_discount ? Number(max_discount) : null;
    if (min_purchase !== undefined) payload.min_purchase = Number(min_purchase);
    if (max_uses !== undefined) payload.max_uses = max_uses ? Number(max_uses) : null;
    if (is_active !== undefined) payload.is_active = !!is_active;
    if (expires_at !== undefined) payload.expires_at = expires_at || null;

    try {
        const { data, error } = await supabase
            .from("promo_codes")
            .update(payload)
            .eq("id", id)
            .select();

        if (error) return res.status(500).json({ message: "Gagal update kode promo" });
        if (!data.length) return res.status(404).json({ message: "Kode promo tidak ditemukan" });

        notify("promo_code", `🎟️ ${req.user.email} mengubah kode promo "${data[0].code}"`);
        res.json({ message: "Kode promo berhasil diperbarui", data: data[0] });
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

exports.remove = async (req, res) => {
    if (req.user.role !== "admin") {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    const { id } = req.params;
    try {
        const { error } = await supabase.from("promo_codes").delete().eq("id", id);
        if (error) return res.status(500).json({ message: "Gagal menghapus kode promo" });
        notify("promo_code", `🗑️ ${req.user.email} menghapus kode promo (id ${id})`);
        res.json({ message: "Kode promo berhasil dihapus" });
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

// dipakai controller lain (orderController) buat validasi ulang di server
// pas checkout — JANGAN PERNAH percaya angka diskon yang dikirim frontend
exports.validatePromoCode = validatePromoCode;

// dipakai orderController buat naikkan pemakaian setelah pembayaran sukses,
// idempotent-safe karena dipanggil cuma sekali per transisi ke "paid"
exports.incrementUsage = async (code) => {
    if (!code) return;
    try {
        const { data: promo } = await supabase
            .from("promo_codes")
            .select("id, used_count")
            .eq("code", code.toUpperCase().trim())
            .maybeSingle();

        if (promo) {
            await supabase
                .from("promo_codes")
                .update({ used_count: (promo.used_count || 0) + 1 })
                .eq("id", promo.id);
        }
    } catch (err) {
        console.log("Gagal increment usage kode promo:", err.message);
    }
};
