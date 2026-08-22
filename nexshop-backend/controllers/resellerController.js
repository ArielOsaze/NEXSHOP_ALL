const supabase = require("../config/db");
const { notify } = require("../config/notify");
const { getTiers, getTier, getResellerContext, invalidateTierCache, isMissingTableError } = require("../services/resellerService");

// ===========================================================
// PROGRAM RESELLER
//
// Alurnya: user login -> ajukan diri jadi reseller -> admin approve sambil
// milih tier -> user dapat potongan harga otomatis di seluruh katalog
// (topup & marketplace). Persen diskon per tier diatur admin dari
// dashboard; harganya sendiri gak pernah disimpan per produk, selalu
// dihitung ulang di server (lihat utils/resellerPricing.js).
//
// Tabelnya dibikin lewat migrations/008_create_reseller.sql yang HARUS
// dijalankan manual. Selama belum dijalankan, endpoint di sini balas pesan
// "belum di-setup" yang ramah, bukan error 500 mentah.
// ===========================================================

const BELUM_SETUP = "Fitur reseller belum di-setup. Jalankan migrations/008_create_reseller.sql di Supabase dulu ya.";

function bersihkan(nilai, maksimal) {
    return String(nilai ?? "").trim().slice(0, maksimal);
}

// Nomor WhatsApp Indonesia: 08xx / 628xx / +628xx -> disimpan apa adanya
// setelah dirapikan jadi digit saja.
function normalisasiWhatsApp(nomor) {
    const digit = String(nomor || "").replace(/\D/g, "");
    if (!/^(0|62)\d{8,14}$/.test(digit)) return null;
    return digit.startsWith("0") ? "62" + digit.slice(1) : digit;
}

// ===========================================================
// PUBLIK — daftar tier + persen diskonnya, buat halaman info reseller
// ===========================================================
exports.getPublicTiers = async (req, res) => {
    try {
        const tiers = await getTiers({ activeOnly: true });
        res.json(
            tiers.map((t) => ({
                code: t.code,
                name: t.name,
                discount_percent: t.discount_percent,
                description: t.description || null
            }))
        );
    } catch (err) {
        console.error("getPublicTiers:", err.message);
        res.status(500).json({ message: "Gagal memuat tingkatan reseller" });
    }
};

// ===========================================================
// USER — status reseller & pengajuan miliknya sendiri
// ===========================================================
exports.getMyResellerStatus = async (req, res) => {
    try {
        const { data: user, error } = await supabase
            .from("users")
            .select("reseller_status, reseller_tier, reseller_since, fullname, phone")
            .eq("id", req.user.id)
            .maybeSingle();

        if (error) {
            if (isMissingTableError(error)) return res.status(503).json({ message: BELUM_SETUP, code: "RESELLER_NOT_SETUP" });
            throw error;
        }

        const { data: pengajuan } = await supabase
            .from("reseller_applications")
            .select("id, status, tier_code, admin_note, created_at, reviewed_at")
            .eq("user_id", req.user.id)
            .order("created_at", { ascending: false })
            .limit(1);

        const status = user?.reseller_status || "none";
        const tier = status === "approved" ? await getTier(user.reseller_tier) : null;

        res.json({
            status,
            tier: tier ? { code: tier.code, name: tier.name, discount_percent: tier.discount_percent } : null,
            since: user?.reseller_since || null,
            profil: { fullname: user?.fullname || "", phone: user?.phone || "" },
            pengajuan_terakhir: (pengajuan && pengajuan[0]) || null
        });
    } catch (err) {
        console.error("getMyResellerStatus:", err.message);
        res.status(500).json({ message: "Gagal memuat status reseller" });
    }
};

exports.applyReseller = async (req, res) => {
    const fullname = bersihkan(req.body.fullname, 120);
    const whatsapp = normalisasiWhatsApp(req.body.whatsapp);
    const storeName = bersihkan(req.body.store_name, 120);
    const channel = bersihkan(req.body.channel, 80);
    const monthlyEstimate = bersihkan(req.body.monthly_estimate, 60);
    const note = bersihkan(req.body.note, 500);

    if (fullname.length < 3) return res.status(400).json({ message: "Nama lengkap wajib diisi (minimal 3 karakter)" });
    if (!whatsapp) return res.status(400).json({ message: "Nomor WhatsApp tidak valid (contoh: 08xxxxxxxxxx)" });

    try {
        const { data: user, error: userErr } = await supabase
            .from("users")
            .select("reseller_status, email_verified")
            .eq("id", req.user.id)
            .maybeSingle();

        if (userErr) {
            if (isMissingTableError(userErr)) return res.status(503).json({ message: BELUM_SETUP, code: "RESELLER_NOT_SETUP" });
            throw userErr;
        }
        if (!user) return res.status(404).json({ message: "Akun tidak ditemukan" });

        // Email belum terverifikasi = kita belum bisa memastikan kontaknya
        // benar. Reseller dapat harga khusus, jadi verifikasinya gak boleh
        // dilewat.
        if (!user.email_verified) {
            return res.status(403).json({ message: "Verifikasi email kamu dulu sebelum mendaftar jadi reseller." });
        }
        if (user.reseller_status === "approved") {
            return res.status(400).json({ message: "Akun kamu sudah terdaftar sebagai reseller." });
        }
        if (user.reseller_status === "pending") {
            return res.status(400).json({ message: "Pengajuan kamu sedang ditinjau. Tunggu kabar dari admin ya." });
        }
        if (user.reseller_status === "suspended") {
            return res.status(403).json({ message: "Status reseller kamu sedang dibekukan. Hubungi Customer Service." });
        }

        const { data: inserted, error: insertErr } = await supabase
            .from("reseller_applications")
            .insert([{
                user_id: req.user.id,
                fullname,
                whatsapp,
                store_name: storeName || null,
                channel: channel || null,
                monthly_estimate: monthlyEstimate || null,
                note: note || null,
                status: "pending"
            }])
            .select("id, created_at");

        if (insertErr) {
            if (isMissingTableError(insertErr)) return res.status(503).json({ message: BELUM_SETUP, code: "RESELLER_NOT_SETUP" });
            // Unique index "satu pengajuan pending per user" (lihat migration
            // 008) -- bisa kena kalau dua request masuk hampir barengan.
            if (String(insertErr.code) === "23505") {
                return res.status(400).json({ message: "Pengajuan kamu sedang ditinjau. Tunggu kabar dari admin ya." });
            }
            throw insertErr;
        }

        await supabase.from("users").update({ reseller_status: "pending" }).eq("id", req.user.id);

        notify("reseller", `🤝 Pengajuan reseller baru dari ${fullname} (${req.user.email}) — WhatsApp ${whatsapp}`);

        res.status(201).json({
            message: "Pengajuan terkirim! Admin bakal ninjau maksimal 1x24 jam dan menghubungi kamu lewat WhatsApp.",
            pengajuan: (inserted && inserted[0]) || null
        });
    } catch (err) {
        console.error("applyReseller:", err.message);
        res.status(500).json({ message: "Gagal mengirim pengajuan reseller" });
    }
};

// ===========================================================
// ADMIN — daftar pengajuan
// ===========================================================
exports.listApplications = async (req, res) => {
    const status = String(req.query.status || "").trim();
    try {
        let query = supabase
            .from("reseller_applications")
            .select("id, user_id, fullname, whatsapp, store_name, channel, monthly_estimate, note, status, tier_code, admin_note, reviewed_by, reviewed_at, created_at")
            .order("created_at", { ascending: false })
            .limit(300);

        if (["pending", "approved", "rejected"].includes(status)) query = query.eq("status", status);

        const { data, error } = await query;
        if (error) {
            if (isMissingTableError(error)) return res.status(503).json({ message: BELUM_SETUP, code: "RESELLER_NOT_SETUP" });
            throw error;
        }

        // Email user diambil terpisah biar gak perlu foreign-table select
        // (skema Supabase di sini gak selalu punya relasi yang ke-expose).
        const userIds = [...new Set((data || []).map((a) => a.user_id))];
        const emailById = new Map();
        if (userIds.length) {
            const { data: users } = await supabase.from("users").select("id, email, reseller_status, reseller_tier").in("id", userIds);
            (users || []).forEach((u) => emailById.set(String(u.id), u));
        }

        res.json(
            (data || []).map((a) => {
                const u = emailById.get(String(a.user_id));
                return { ...a, email: u?.email || null, current_status: u?.reseller_status || null, current_tier: u?.reseller_tier || null };
            })
        );
    } catch (err) {
        console.error("listApplications:", err.message);
        res.status(500).json({ message: "Gagal memuat pengajuan reseller" });
    }
};

// ===========================================================
// ADMIN — approve / tolak pengajuan
// ===========================================================
exports.decideApplication = async (req, res) => {
    const { id } = req.params;
    const action = String(req.body.action || "").trim();
    const tierCode = String(req.body.tier_code || "").trim();
    const adminNote = bersihkan(req.body.admin_note, 300);

    if (!["approve", "reject"].includes(action)) {
        return res.status(400).json({ message: "Aksi harus 'approve' atau 'reject'" });
    }

    try {
        const { data: app, error } = await supabase
            .from("reseller_applications")
            .select("id, user_id, fullname, whatsapp, status")
            .eq("id", id)
            .maybeSingle();

        if (error) {
            if (isMissingTableError(error)) return res.status(503).json({ message: BELUM_SETUP, code: "RESELLER_NOT_SETUP" });
            throw error;
        }
        if (!app) return res.status(404).json({ message: "Pengajuan tidak ditemukan" });
        if (app.status !== "pending") {
            return res.status(400).json({ message: `Pengajuan ini sudah ${app.status === "approved" ? "disetujui" : "ditolak"} sebelumnya` });
        }

        let tier = null;
        if (action === "approve") {
            tier = await getTier(tierCode);
            if (!tier) return res.status(400).json({ message: "Pilih tingkatan reseller yang valid" });
            if (!tier.is_active) return res.status(400).json({ message: `Tingkatan "${tier.name}" sedang nonaktif` });
        }

        const now = new Date().toISOString();
        const { error: updErr } = await supabase
            .from("reseller_applications")
            .update({
                status: action === "approve" ? "approved" : "rejected",
                tier_code: tier ? tier.code : null,
                admin_note: adminNote || null,
                reviewed_by: req.user.email,
                reviewed_at: now
            })
            .eq("id", id)
            .eq("status", "pending"); // jaga-jaga kalau ada admin lain barengan
        if (updErr) throw updErr;

        const userPayload = action === "approve"
            ? { reseller_status: "approved", reseller_tier: tier.code, reseller_since: now }
            : { reseller_status: "rejected", reseller_tier: null };

        const { error: userErr } = await supabase.from("users").update(userPayload).eq("id", app.user_id);
        if (userErr) throw userErr;

        notify(
            "reseller",
            action === "approve"
                ? `✅ ${req.user.email} menyetujui reseller ${app.fullname} (tier ${tier.name}, diskon ${tier.discount_percent}%)`
                : `❌ ${req.user.email} menolak pengajuan reseller ${app.fullname}`
        );

        res.json({
            message: action === "approve"
                ? `${app.fullname} sekarang reseller ${tier.name} (diskon ${tier.discount_percent}%)`
                : `Pengajuan ${app.fullname} ditolak`
        });
    } catch (err) {
        console.error("decideApplication:", err.message);
        res.status(500).json({ message: "Gagal memproses pengajuan reseller" });
    }
};

// ===========================================================
// ADMIN — daftar reseller aktif + ubah tier / bekukan
// ===========================================================
exports.listResellers = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("users")
            .select("id, fullname, email, phone, reseller_status, reseller_tier, reseller_since")
            .in("reseller_status", ["approved", "suspended"])
            .order("reseller_since", { ascending: false })
            .limit(500);

        if (error) {
            if (isMissingTableError(error)) return res.status(503).json({ message: BELUM_SETUP, code: "RESELLER_NOT_SETUP" });
            throw error;
        }
        res.json(data || []);
    } catch (err) {
        console.error("listResellers:", err.message);
        res.status(500).json({ message: "Gagal memuat daftar reseller" });
    }
};

exports.updateResellerUser = async (req, res) => {
    const { id } = req.params;
    const status = String(req.body.status || "").trim();
    const tierCode = String(req.body.tier_code || "").trim();

    if (status && !["approved", "suspended", "none"].includes(status)) {
        return res.status(400).json({ message: "Status reseller tidak valid" });
    }

    try {
        const payload = {};
        if (status === "none") {
            payload.reseller_status = "none";
            payload.reseller_tier = null;
            payload.reseller_since = null;
        } else if (status) {
            payload.reseller_status = status;
        }

        if (tierCode) {
            const tier = await getTier(tierCode);
            if (!tier) return res.status(400).json({ message: "Tingkatan reseller tidak dikenal" });
            payload.reseller_tier = tier.code;
        }

        if (Object.keys(payload).length === 0) {
            return res.status(400).json({ message: "Tidak ada perubahan yang dikirim" });
        }

        const { data, error } = await supabase.from("users").update(payload).eq("id", id).select("id, fullname, reseller_status, reseller_tier");
        if (error) {
            if (isMissingTableError(error)) return res.status(503).json({ message: BELUM_SETUP, code: "RESELLER_NOT_SETUP" });
            throw error;
        }
        if (!data || !data.length) return res.status(404).json({ message: "User tidak ditemukan" });

        notify("reseller", `🔧 ${req.user.email} mengubah reseller ${data[0].fullname}: status ${data[0].reseller_status}, tier ${data[0].reseller_tier || "-"}`);
        res.json({ message: "Data reseller diperbarui", data: data[0] });
    } catch (err) {
        console.error("updateResellerUser:", err.message);
        res.status(500).json({ message: "Gagal memperbarui data reseller" });
    }
};

// ===========================================================
// ADMIN — atur tingkatan & persen diskon
// ===========================================================
exports.listTiersAdmin = async (req, res) => {
    try {
        const tiers = await getTiers({ activeOnly: false });
        if (!tiers.length) return res.status(503).json({ message: BELUM_SETUP, code: "RESELLER_NOT_SETUP" });

        // Jumlah reseller per tier, biar admin tahu dampak perubahan persen
        const { data: users } = await supabase
            .from("users")
            .select("reseller_tier")
            .eq("reseller_status", "approved");
        const jumlah = {};
        (users || []).forEach((u) => {
            if (u.reseller_tier) jumlah[u.reseller_tier] = (jumlah[u.reseller_tier] || 0) + 1;
        });

        res.json(tiers.map((t) => ({ ...t, jumlah_reseller: jumlah[t.code] || 0 })));
    } catch (err) {
        console.error("listTiersAdmin:", err.message);
        res.status(500).json({ message: "Gagal memuat tingkatan reseller" });
    }
};

exports.updateTier = async (req, res) => {
    const { code } = req.params;
    const payload = {};

    if (req.body.discount_percent !== undefined) {
        const persen = Number(req.body.discount_percent);
        // Batas atas 30% sama dengan CHECK constraint di migration -- ditolak
        // di sini duluan supaya pesannya jelas, bukan error database mentah.
        if (!Number.isFinite(persen) || persen < 0 || persen > 30) {
            return res.status(400).json({ message: "Diskon harus angka 0-30 persen" });
        }
        payload.discount_percent = Number(persen.toFixed(2));
    }
    if (req.body.name !== undefined) payload.name = bersihkan(req.body.name, 60) || null;
    if (req.body.description !== undefined) payload.description = bersihkan(req.body.description, 200) || null;
    if (req.body.is_active !== undefined) payload.is_active = !!req.body.is_active;

    if (Object.keys(payload).length === 0) {
        return res.status(400).json({ message: "Tidak ada perubahan yang dikirim" });
    }
    payload.updated_at = new Date().toISOString();

    try {
        const { data, error } = await supabase.from("reseller_tiers").update(payload).eq("code", code).select();
        if (error) {
            if (isMissingTableError(error)) return res.status(503).json({ message: BELUM_SETUP, code: "RESELLER_NOT_SETUP" });
            throw error;
        }
        if (!data || !data.length) return res.status(404).json({ message: "Tingkatan tidak ditemukan" });

        // Cache tier dibuang supaya harga di katalog & checkout langsung
        // ikut persen yang baru, gak nunggu TTL habis.
        invalidateTierCache();

        notify("reseller", `💸 ${req.user.email} mengubah tier ${data[0].name}: diskon ${data[0].discount_percent}%`);
        res.json({ message: `Tingkatan ${data[0].name} diperbarui`, data: data[0] });
    } catch (err) {
        console.error("updateTier:", err.message);
        res.status(500).json({ message: "Gagal memperbarui tingkatan reseller" });
    }
};

exports._internal = { normalisasiWhatsApp };
