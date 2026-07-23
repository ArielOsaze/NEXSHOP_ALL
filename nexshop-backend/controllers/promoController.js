const supabase = require("../config/db");
const { notify } = require("../config/notify");

const PROMO_BUCKET = "promo";

// Upload buffer file (dari multer memoryStorage) ke Supabase Storage,
// balikin public URL-nya. Dipakai saat admin upload gambar banner langsung
// dari dashboard (bukan nempel URL manual lagi).
async function uploadBannerFile(file) {
    const ext = file.originalname.split(".").pop();
    const fileName = Date.now() + "-" + Math.random().toString(36).substring(2, 8) + "." + ext;

    const { error } = await supabase.storage
        .from(PROMO_BUCKET)
        .upload(fileName, file.buffer, { contentType: file.mimetype, upsert: false });

    if (error) throw error;

    const { data } = supabase.storage.from(PROMO_BUCKET).getPublicUrl(fileName);
    return data.publicUrl;
}

// Publik — dipanggil dari halaman toko buat nampilin carousel
exports.getSlides = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("promo_slides")
            .select("*")
            .eq("is_active", true)
            .order("sort_order", { ascending: true })
            .order("created_at", { ascending: false });

        if (error) {
            console.log(error);
            return res.status(500).json({ message: "Database Error" });
        }

        res.json(data || []);
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server Error" });
    }
};

// Admin only — semua slide termasuk yang nonaktif, buat ditampilin di dashboard
exports.getAllSlidesAdmin = async (req, res) => {
    if (req.user.role !== "admin") {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }

    try {
        const { data, error } = await supabase
            .from("promo_slides")
            .select("*")
            .order("sort_order", { ascending: true })
            .order("created_at", { ascending: false });

        if (error) {
            console.log(error);
            return res.status(500).json({ message: "Database Error" });
        }

        res.json(data || []);
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server Error" });
    }
};

exports.createSlide = async (req, res) => {
    if (req.user.role !== "admin") {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }

    const { type, badge_text, title, description, cta_text, cta_link, is_active, sort_order, full_image } = req.body;
    let { image_url, mobile_image_url } = req.body;

    if (!title) {
        return res.status(400).json({ message: "Judul wajib diisi" });
    }

    try {
        // kalau admin upload file gambar, itu diprioritaskan dibanding image_url manual
        const files = req.files || {};
        if (files.image && files.image[0]) {
            image_url = await uploadBannerFile(files.image[0]);
        }
        if (files.mobile_image && files.mobile_image[0]) {
            mobile_image_url = await uploadBannerFile(files.mobile_image[0]);
        }

        const { data, error } = await supabase
            .from("promo_slides")
            .insert([{
                type: type || "promo",
                badge_text, title, description, cta_text, cta_link, image_url, mobile_image_url,
                full_image: full_image === "true" || full_image === true,
                is_active: is_active !== undefined ? is_active === "true" || is_active === true : true,
                sort_order: sort_order ? Number(sort_order) : 0
            }])
            .select();

        if (error) {
            console.log(error);
            return res.status(500).json({ message: "Gagal membuat slide" });
        }

        notify("promo", `🖼️ ${req.user.email} membuat slide promo baru "${title}"`);
        res.status(201).json({ message: "Slide berhasil dibuat", data: data[0] });
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: err.message || "Server Error" });
    }
};

exports.updateSlide = async (req, res) => {
    if (req.user.role !== "admin") {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }

    const { id } = req.params;
    const { type, badge_text, title, description, cta_text, cta_link, is_active, sort_order, full_image } = req.body;
    let { image_url, mobile_image_url } = req.body;

    try {
        const files = req.files || {};
        if (files.image && files.image[0]) {
            image_url = await uploadBannerFile(files.image[0]);
        }
        if (files.mobile_image && files.mobile_image[0]) {
            mobile_image_url = await uploadBannerFile(files.mobile_image[0]);
        }

        const payload = { type, badge_text, title, description, cta_text, cta_link };
        if (image_url !== undefined) payload.image_url = image_url;
        if (mobile_image_url !== undefined) payload.mobile_image_url = mobile_image_url;
        if (full_image !== undefined) payload.full_image = full_image === "true" || full_image === true;
        if (is_active !== undefined) payload.is_active = is_active === "true" || is_active === true;
        if (sort_order !== undefined) payload.sort_order = Number(sort_order);

        const { data, error } = await supabase
            .from("promo_slides")
            .update(payload)
            .eq("id", id)
            .select();

        if (error) {
            console.log(error);
            return res.status(500).json({ message: "Gagal update slide" });
        }

        if (!data.length) {
            return res.status(404).json({ message: "Slide tidak ditemukan" });
        }

        notify("promo", `🖼️ ${req.user.email} mengubah slide promo "${data[0].title}"`);
        res.json({ message: "Slide berhasil diperbarui", data: data[0] });
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: err.message || "Server Error" });
    }
};

exports.deleteSlide = async (req, res) => {
    if (req.user.role !== "admin") {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }

    const { id } = req.params;

    try {
        const { error } = await supabase
            .from("promo_slides")
            .delete()
            .eq("id", id);

        if (error) {
            console.log(error);
            return res.status(500).json({ message: "Gagal menghapus slide" });
        }

        notify("promo", `🗑️ ${req.user.email} menghapus slide promo (id ${id})`);
        res.json({ message: "Slide berhasil dihapus" });
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server Error" });
    }
};
