const supabase = require("../config/db");
const bcrypt = require("bcrypt");
const { notify } = require("../config/notify");
const {
    getStoreSettings,
    updateStoreSettings,
    getApiKeys,
    updateApiKeys
} = require("../config/settings");

// ===========================================================
// STORE SETTINGS — nama toko, tagline, kontak, logo
// ===========================================================

// Publik — dipakai frontend toko buat nampilin nama/logo/kontak
exports.getStoreSettingsPublic = async (req, res) => {
    try {
        const data = await getStoreSettings();
        res.json(data);
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

// Admin only
exports.updateStoreSettingsAdmin = async (req, res) => {
    if (req.user.role !== "admin") {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    try {
        const { data, error } = await updateStoreSettings(req.body);
        if (error) {
            console.log(error);
            return res.status(500).json({ message: "Gagal update pengaturan toko" });
        }
        notify("settings", `⚙️ ${req.user.email} mengubah pengaturan toko`);
        res.json({ message: "Pengaturan toko berhasil disimpan", data });
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

// ===========================================================
// API KEYS — iPaymu + TokoVoucher (admin only, key sensitif di-mask)
// ===========================================================
function mask(value) {
    if (!value) return "";
    if (value.length <= 6) return "••••••";
    return value.slice(0, 4) + "••••••••" + value.slice(-4);
}

exports.getApiKeysAdmin = async (req, res) => {
    if (req.user.role !== "admin") {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    try {
        const keys = await getApiKeys({ fresh: true });
        res.json({
            ipaymu_va: keys.ipaymu_va, // VA bukan rahasia, gak perlu di-mask
            ipaymu_api_key: mask(keys.ipaymu_api_key),
            ipaymu_is_production: keys.ipaymu_is_production,
            tokovoucher_member_code: keys.tokovoucher_member_code,
            tokovoucher_secret: mask(keys.tokovoucher_secret),
            apigames_merchant_id: keys.apigames_merchant_id,
            apigames_secret_key: mask(keys.apigames_secret_key)
        });
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

exports.updateApiKeysAdmin = async (req, res) => {
    if (req.user.role !== "admin") {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    try {
        // kalau field dikirim kosong/masih berupa mask (mengandung "••••"),
        // jangan ditimpa — anggap admin gak berniat mengganti value itu
        const payload = { ...req.body };
        for (const key of Object.keys(payload)) {
            if (typeof payload[key] === "string" && payload[key].includes("••")) {
                delete payload[key];
            }
        }

        const { data, error } = await updateApiKeys(payload);
        if (error) {
            console.log(error);
            return res.status(500).json({ message: "Gagal update API keys" });
        }
        notify("settings", `🔑 ${req.user.email} mengubah API Keys`);
        res.json({ message: "API keys berhasil disimpan" });
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

// ===========================================================
// PROFIL ADMIN — lihat & ubah nama/email/password akun sendiri
// ===========================================================
exports.getMe = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("users")
            .select("id, fullname, email, role, created_at")
            .eq("id", req.user.id)
            .maybeSingle();

        if (error || !data) return res.status(404).json({ message: "User tidak ditemukan" });
        res.json(data);
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

exports.updateMe = async (req, res) => {
    const { fullname, email, current_password, new_password } = req.body;

    try {
        const { data: user, error: findErr } = await supabase
            .from("users")
            .select("*")
            .eq("id", req.user.id)
            .maybeSingle();

        if (findErr || !user) return res.status(404).json({ message: "User tidak ditemukan" });

        const payload = {};
        if (fullname) payload.fullname = fullname;

        if (email && email !== user.email) {
            // cek dulu email itu belum dipakai akun lain, biar errornya jelas
            // (bukan cuma "Gagal update profil" generik dari duplicate key constraint)
            const { data: existing } = await supabase
                .from("users")
                .select("id")
                .eq("email", email)
                .neq("id", req.user.id)
                .maybeSingle();

            if (existing) {
                return res.status(400).json({ message: "Email sudah dipakai akun lain" });
            }
            payload.email = email;
        }

        if (new_password) {
            if (!current_password) {
                return res.status(400).json({ message: "Masukkan password saat ini untuk mengganti password" });
            }
            const validPassword = await bcrypt.compare(current_password, user.password);
            if (!validPassword) {
                return res.status(401).json({ message: "Password saat ini salah" });
            }
            if (new_password.length < 4) {
                return res.status(400).json({ message: "Password baru minimal 4 karakter" });
            }
            payload.password = await bcrypt.hash(new_password, 10);
        }

        if (Object.keys(payload).length === 0) {
            return res.status(400).json({ message: "Tidak ada perubahan yang dikirim" });
        }

        const { data, error } = await supabase
            .from("users")
            .update(payload)
            .eq("id", req.user.id)
            .select("id, fullname, email, role")
            .maybeSingle();

        if (error) {
            // tampilkan pesan error asli dari Supabase (bukan generik) supaya
            // gampang di-diagnosis — misal RLS policy, kolom gak ada, dst.
            console.log("updateMe error:", error);
            return res.status(500).json({ message: `Gagal update profil: ${error.message}` });
        }

        if (!data) {
            // update "berhasil" (tanpa error) tapi gak ada baris yang match —
            // biasanya karena RLS policy nge-block row ini walau service key
            // dipakai, atau id di token gak cocok sama id di tabel users
            return res.status(500).json({
                message: "Gagal update profil: tidak ada baris yang ter-update. Cek apakah SUPABASE_SERVICE_KEY di .env server benar-benar Service Role Key (bukan anon key), dan apakah RLS di tabel users mengizinkan service role."
            });
        }

        res.json({ message: "Profil berhasil diperbarui", data });
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: err.message || "Server Error" });
    }
};
