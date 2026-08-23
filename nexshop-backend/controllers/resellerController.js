const crypto = require("crypto");
const axios = require("axios");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const supabase = require("../config/db");
const { notify } = require("../config/notify");
const { getTiers, getTier, getResellerContext, invalidateTierCache, isMissingTableError } = require("../services/resellerService");
const { hitungHargaReseller } = require("../utils/resellerPricing");
const { hitungMarkupWajar, cleanProductName } = require("../utils/topupHelpers");

// ===========================================================
// PROGRAM RESELLER & PARTNER PORTAL NEXSHOP
//
// Alurnya:
// 1. User login -> lengkapi data KYC KTP & usaha -> ajukan diri jadi reseller.
// 2. Admin meninjau data usaha & foto KTP di Admin Dashboard -> Setujui / Tolak.
// 3. Setelah disetujui (status: 'approved'), user mendapatkan:
//    - Potongan harga otomatis di seluruh etalase web saat login.
//    - Akses ke Partner Portal (/portal-reseller) untuk mengelola API Key,
//      Secret Key, IP Whitelist, Webhook Endpoint, dan daftar harga modal.
// ===========================================================

const BELUM_SETUP = "Fitur reseller belum di-setup. Jalankan migrations/008_create_reseller.sql dan 010_create_reseller_api_and_kyc.sql di Supabase dulu ya.";

function bersihkan(nilai, maksimal) {
    return String(nilai ?? "").trim().slice(0, maksimal);
}

function normalisasiWhatsApp(nomor) {
    const digit = String(nomor || "").replace(/\D/g, "");
    if (!/^(0|62)\d{8,14}$/.test(digit)) return null;
    return digit.startsWith("0") ? "62" + digit.slice(1) : digit;
}

function generateResellerApiKey() {
    return "nx_live_" + crypto.randomBytes(16).toString("hex");
}

function generateResellerSecretKey() {
    return "nx_sec_" + crypto.randomBytes(24).toString("hex");
}

function generateResellerWebhookSecret() {
    return "whsec_" + crypto.randomBytes(24).toString("hex");
}

function maskSecret(secret) {
    if (!secret || secret.length < 10) return "••••••••••••••••";
    return secret.slice(0, 7) + "••••••••••••••••" + secret.slice(-4);
}

// ===========================================================
// AUTENTIKASI KHUSUS MITRA RESELLER (REGISTER & LOGIN)
// ===========================================================

exports.resellerRegister = async (req, res) => {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "").trim();
    const fullname = bersihkan(req.body.fullname, 120);
    const whatsapp = normalisasiWhatsApp(req.body.whatsapp || req.body.phone);
    const nik = bersihkan(req.body.nik, 20);
    const storeName = bersihkan(req.body.store_name, 120);
    const channel = bersihkan(req.body.channel, 80);
    const monthlyEstimate = bersihkan(req.body.monthly_estimate, 60);
    const note = bersihkan(req.body.note, 500);
    const ktpUrl = bersihkan(req.body.ktp_url, 500);

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ message: "Format email tidak valid" });
    }
    if (!password || password.length < 6) {
        return res.status(400).json({ message: "Password minimal 6 karakter" });
    }
    if (fullname.length < 3) {
        return res.status(400).json({ message: "Nama lengkap wajib diisi (minimal 3 karakter)" });
    }
    if (!whatsapp) {
        return res.status(400).json({ message: "Nomor WhatsApp tidak valid (contoh: 08xxxxxxxxxx atau 628xxxxxxxxxx)" });
    }
    if (!nik || nik.length < 16) {
        return res.status(400).json({ message: "Nomor NIK KTP wajib 16 digit" });
    }
    if (!ktpUrl) {
        return res.status(400).json({ message: "Foto KTP (KYC) wajib diunggah untuk verifikasi kemitraan reseller." });
    }

    try {
        const { data: existingUser, error: findErr } = await supabase
            .from("users")
            .select("id, email, fullname, role, reseller_status, phone")
            .eq("email", email)
            .maybeSingle();

        if (findErr && !isMissingTableError(findErr)) {
            console.error("resellerRegister find user error:", findErr);
        }

        let userId;
        let userRole = "user";

        if (existingUser) {
            userId = existingUser.id;
            userRole = existingUser.role || "user";

            // Update user reseller_status & password menjadi data pendaftaran terbaru
            const hashedPassword = await bcrypt.hash(password, 10);
            const updatePayload = {
                password: hashedPassword,
                reseller_status: "pending",
                phone: whatsapp || existingUser.phone,
                fullname: fullname || existingUser.fullname
            };
            const { error: updErr } = await supabase.from("users").update(updatePayload).eq("id", userId);
            if (updErr && String(updErr.message || "").toLowerCase().includes("reseller_status")) {
                delete updatePayload.reseller_status;
                await supabase.from("users").update(updatePayload).eq("id", userId);
            }
        } else {
            const hashedPassword = await bcrypt.hash(password, 10);
            const insertUserPayload = {
                fullname,
                email,
                password: hashedPassword,
                phone: whatsapp,
                role: "user",
                email_verified: true,
                reseller_status: "pending"
            };

            let { data: newUser, error: insertUserErr } = await supabase
                .from("users")
                .insert([insertUserPayload])
                .select("id, email, fullname, role")
                .maybeSingle();

            // Fallback jika kolom reseller_status belum ada di tabel users
            if (insertUserErr && String(insertUserErr.message || "").toLowerCase().includes("reseller_status")) {
                delete insertUserPayload.reseller_status;
                const retry = await supabase
                    .from("users")
                    .insert([insertUserPayload])
                    .select("id, email, fullname, role")
                    .maybeSingle();
                newUser = retry.data;
                insertUserErr = retry.error;
            }

            if (insertUserErr) {
                console.error("resellerRegister insert user error:", insertUserErr);
                if (insertUserErr.code === "23505") {
                    // Jika email atau nomor telp sudah ada, ambil id user tersebut
                    const { data: fetchExisting } = await supabase.from("users").select("id, role, fullname").eq("email", email).maybeSingle();
                    if (fetchExisting) {
                        userId = fetchExisting.id;
                        userRole = fetchExisting.role || "user";
                    } else {
                        return res.status(400).json({ message: "Nomor WhatsApp atau Email sudah terdaftar pada akun lain." });
                    }
                } else {
                    return res.status(400).json({ message: "Gagal membuat akun user: " + (insertUserErr.message || "Periksa data Anda") });
                }
            }

            if (newUser) {
                userId = newUser.id;
                userRole = newUser.role || "user";
            }
        }

        if (!userId) {
            const { data: fallbackUser } = await supabase.from("users").select("id, role").eq("email", email).maybeSingle();
            if (fallbackUser) {
                userId = fallbackUser.id;
                userRole = fallbackUser.role || "user";
            } else {
                return res.status(500).json({ message: "Gagal memproses data akun pengguna." });
            }
        }

        // Simpan atau perbarui pengajuan ke reseller_applications
        const appPayload = {
            user_id: userId,
            fullname,
            whatsapp,
            store_name: storeName || null,
            channel: channel || null,
            monthly_estimate: monthlyEstimate || null,
            note: note || null,
            ktp_url: ktpUrl || null,
            nik: nik || null,
            status: "pending"
        };

        // Cek apakah user sudah punya pengajuan berstatus pending
        const { data: existingApp } = await supabase
            .from("reseller_applications")
            .select("id")
            .eq("user_id", userId)
            .eq("status", "pending")
            .maybeSingle();

        let appErr;
        if (existingApp) {
            // Update pengajuan pending yang sudah ada
            const updateAppRes = await supabase
                .from("reseller_applications")
                .update(appPayload)
                .eq("id", existingApp.id);
            appErr = updateAppRes.error;

            if (appErr && (String(appErr.message || "").toLowerCase().includes("ktp_url") || String(appErr.message || "").toLowerCase().includes("nik") || appErr.code === "42703")) {
                delete appPayload.ktp_url;
                delete appPayload.nik;
                const retryUpdate = await supabase.from("reseller_applications").update(appPayload).eq("id", existingApp.id);
                appErr = retryUpdate.error;
            }
        } else {
            // Insert pengajuan baru
            const insertAppRes = await supabase
                .from("reseller_applications")
                .insert([appPayload]);
            appErr = insertAppRes.error;

            // Fallback jika migrasi 010 (kolom ktp_url atau nik) belum di-apply
            if (appErr && (String(appErr.message || "").toLowerCase().includes("ktp_url") || String(appErr.message || "").toLowerCase().includes("nik") || appErr.code === "42703")) {
                delete appPayload.ktp_url;
                delete appPayload.nik;
                const retryApp = await supabase.from("reseller_applications").insert([appPayload]);
                appErr = retryApp.error;
            }

            // Jika terkena unique constraint idx_reseller_app_one_pending karena race condition, fallback update
            if (appErr && (appErr.code === "23505" || String(appErr.message || "").includes("idx_reseller_app_one_pending"))) {
                const fallbackUpdate = await supabase
                    .from("reseller_applications")
                    .update(appPayload)
                    .eq("user_id", userId)
                    .eq("status", "pending");
                appErr = fallbackUpdate.error;
            }
        }

        if (appErr) {
            console.error("resellerRegister application insert/update error:", appErr);
            if (isMissingTableError(appErr)) {
                return res.status(503).json({ message: BELUM_SETUP, code: "RESELLER_NOT_SETUP" });
            }
            return res.status(500).json({ message: "Gagal menyimpan pengajuan kemitraan: " + (appErr.message || "") });
        }

        try {
            if (typeof notify === "function") {
                notify("reseller", `🤝 Pengajuan reseller baru (+KYC KTP) dari ${fullname} (${email}) — WhatsApp: ${whatsapp}`).catch(() => {});
            }
        } catch (_) {}

        const token = jwt.sign(
            { id: userId, email, fullname, role: userRole, is_reseller: true, reseller_status: "pending" },
            process.env.JWT_SECRET,
            { expiresIn: "14d" }
        );

        return res.status(201).json({
            message: "Pendaftaran akun mitra reseller berhasil! Pengajuan identitas (KYC) Anda sedang diverifikasi admin (Maksimal 3x24 Jam kerja).",
            token,
            status: "pending",
            user: {
                id: userId,
                fullname,
                email,
                phone: whatsapp,
                store_name: storeName,
                reseller_status: "pending"
            }
        });
    } catch (err) {
        console.error("resellerRegister error:", err);
        return res.status(500).json({ message: "Terjadi kesalahan server saat mendaftar reseller: " + (err.message || "") });
    }
};

exports.resellerLogin = async (req, res) => {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "").trim();

    if (!email || !password) {
        return res.status(400).json({ message: "Email dan password wajib diisi" });
    }

    try {
        const { data: user, error: userErr } = await supabase
            .from("users")
            .select("id, fullname, email, password, role, reseller_status, phone, is_blacklisted")
            .eq("email", email)
            .maybeSingle();

        if (userErr && !isMissingTableError(userErr)) {
            console.error("resellerLogin error:", userErr);
            return res.status(500).json({ message: "Database Error" });
        }

        if (!user) {
            return res.status(401).json({ message: "Email atau password salah. Pastikan Anda sudah mendaftar pada tab 'Daftar Akun Baru & KYC'." });
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ message: "Email atau password salah." });
        }

        if (user.is_blacklisted) {
            return res.status(403).json({ message: "Akun Anda telah diblokir. Hubungi admin NexShop." });
        }

        // Tentukan status reseller: jika di users bernilai none, cek riwayat pengajuan di reseller_applications
        let status = user.reseller_status || "none";
        if (status === "none") {
            const { data: latestApp } = await supabase
                .from("reseller_applications")
                .select("status")
                .eq("user_id", user.id)
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle();
            if (latestApp && latestApp.status) {
                status = latestApp.status;
            }
        }

        const token = jwt.sign(
            { id: user.id, email: user.email, fullname: user.fullname, role: user.role, is_reseller: true, reseller_status: status },
            process.env.JWT_SECRET,
            { expiresIn: "14d" }
        );

        return res.json({
            message: status === "approved" 
                ? "Login Partner Portal berhasil" 
                : "Login berhasil. Akun Anda saat ini sedang dalam proses verifikasi identitas (KYC) oleh admin (Maksimal 3x24 Jam kerja).",
            token,
            status,
            user: {
                id: user.id,
                fullname: user.fullname,
                email: user.email,
                phone: user.phone,
                role: user.role,
                reseller_status: status
            }
        });
    } catch (err) {
        console.error("resellerLogin error:", err);
        return res.status(500).json({ message: "Terjadi kesalahan server saat login reseller" });
    }
};

// ===========================================================
// PUBLIK — daftar tier + persen diskonnya
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
            .select("id, status, tier_code, admin_note, created_at, reviewed_at, ktp_url, nik")
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
    const ktpUrl = bersihkan(req.body.ktp_url, 500);
    const nik = bersihkan(req.body.nik, 20);

    if (fullname.length < 3) return res.status(400).json({ message: "Nama lengkap wajib diisi (minimal 3 karakter)" });
    if (!whatsapp) return res.status(400).json({ message: "Nomor WhatsApp tidak valid (contoh: 08xxxxxxxxxx)" });
    if (!ktpUrl) return res.status(400).json({ message: "Foto KTP (KYC) wajib diunggah untuk verifikasi kemitraan reseller." });

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
        if (user.reseller_status === "approved") {
            return res.status(400).json({ message: "Akun kamu sudah terdaftar sebagai reseller aktif." });
        }
        if (user.reseller_status === "pending") {
            return res.status(400).json({ message: "Pengajuan kamu sedang ditinjau. Tunggu kabar dari admin ya." });
        }
        if (user.reseller_status === "suspended") {
            return res.status(403).json({ message: "Status reseller kamu sedang dibekukan. Hubungi Customer Service." });
        }

        const insertRow = {
            user_id: req.user.id,
            fullname,
            whatsapp,
            store_name: storeName || null,
            channel: channel || null,
            monthly_estimate: monthlyEstimate || null,
            note: note || null,
            ktp_url: ktpUrl || null,
            nik: nik || null,
            status: "pending"
        };

        const { data: inserted, error: insertErr } = await supabase
            .from("reseller_applications")
            .insert([insertRow])
            .select("id, created_at");

        if (insertErr) {
            if (isMissingTableError(insertErr)) return res.status(503).json({ message: BELUM_SETUP, code: "RESELLER_NOT_SETUP" });
            if (String(insertErr.code) === "23505") {
                return res.status(400).json({ message: "Pengajuan kamu sedang ditinjau. Tunggu kabar dari admin ya." });
            }
            throw insertErr;
        }

        await supabase.from("users").update({ reseller_status: "pending" }).eq("id", req.user.id);

        notify("reseller", `🤝 Pengajuan reseller baru (+KYC KTP) dari ${fullname} (${req.user.email}) — WhatsApp ${whatsapp}`);

        res.status(201).json({
            message: "Pengajuan & berkas KYC KTP berhasil terkirim! Admin akan meninjau maksimal 1x24 jam.",
            pengajuan: (inserted && inserted[0]) || null
        });
    } catch (err) {
        console.error("applyReseller:", err.message);
        res.status(500).json({ message: "Gagal mengirim pengajuan reseller" });
    }
};

// ===========================================================
// ADMIN — daftar pengajuan (dengan data KYC KTP)
// ===========================================================
exports.listApplications = async (req, res) => {
    const status = String(req.query.status || "").trim();
    try {
        let query = supabase
            .from("reseller_applications")
            .select("id, user_id, fullname, whatsapp, store_name, channel, monthly_estimate, note, status, tier_code, admin_note, reviewed_by, reviewed_at, created_at, ktp_url, nik")
            .order("created_at", { ascending: false })
            .limit(300);

        if (["pending", "approved", "rejected"].includes(status)) query = query.eq("status", status);

        const { data, error } = await query;
        if (error) {
            if (isMissingTableError(error)) return res.status(503).json({ message: BELUM_SETUP, code: "RESELLER_NOT_SETUP" });
            throw error;
        }

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
// ADMIN — approve / tolak pengajuan KYC
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
            .eq("status", "pending");
        if (updErr) throw updErr;

        const userPayload = action === "approve"
            ? { reseller_status: "approved", reseller_tier: tier.code, reseller_since: now }
            : { reseller_status: "rejected", reseller_tier: null };

        const { error: userErr } = await supabase.from("users").update(userPayload).eq("id", app.user_id);
        if (userErr) throw userErr;

        // Jika disetujui, pastikan pasangan API Key & Secret Key dibuat otomatis
        if (action === "approve") {
            try {
                const { data: existingKey } = await supabase
                    .from("reseller_api_keys")
                    .select("id")
                    .eq("user_id", app.user_id)
                    .maybeSingle();

                if (!existingKey) {
                    await supabase.from("reseller_api_keys").insert([{
                        user_id: app.user_id,
                        api_key: generateResellerApiKey(),
                        secret_key: generateResellerSecretKey(),
                        webhook_secret: generateResellerWebhookSecret(),
                        is_active: true
                    }]);
                }
            } catch (kErr) {
                console.log("[reseller] notice: skip provisioning api key:", kErr.message);
            }
        }

        notify(
            "reseller",
            action === "approve"
                ? `✅ ${req.user.email} menyetujui reseller ${app.fullname} (tier ${tier.name}, diskon ${tier.discount_percent}%)`
                : `❌ ${req.user.email} menolak pengajuan reseller ${app.fullname}`
        );

        res.json({
            message: action === "approve"
                ? `${app.fullname} sekarang reseller resmi ${tier.name} (diskon ${tier.discount_percent}%)`
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

        // Ambil info API Keys untuk daftar reseller
        const userIds = (data || []).map((u) => u.id);
        const apiKeyMap = new Map();
        if (userIds.length) {
            try {
                const { data: keys } = await supabase
                    .from("reseller_api_keys")
                    .select("user_id, api_key, ip_whitelist, is_active, total_requests, last_used_at")
                    .in("user_id", userIds);
                (keys || []).forEach((k) => apiKeyMap.set(String(k.user_id), k));
            } catch {
                /* table mungkin belum ada */
            }
        }

        res.json((data || []).map((u) => ({
            ...u,
            api_info: apiKeyMap.get(String(u.id)) || null
        })));
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

        invalidateTierCache();

        notify("reseller", `💸 ${req.user.email} mengubah tier ${data[0].name}: diskon ${data[0].discount_percent}%`);
        res.json({ message: `Tingkatan ${data[0].name} diperbarui`, data: data[0] });
    } catch (err) {
        console.error("updateTier:", err.message);
        res.status(500).json({ message: "Gagal memperbarui tingkatan reseller" });
    }
};

// ===========================================================
// PARTNER PORTAL — Endpoints Khusus Reseller Aktif
// ===========================================================

/**
 * Overview Kredensial, Status Tier & IP Whitelist Reseller
 */
exports.getPortalOverview = async (req, res) => {
    try {
        const { data: user, error: uErr } = await supabase
            .from("users")
            .select("id, email, fullname, reseller_status, reseller_tier, reseller_since")
            .eq("id", req.user.id)
            .maybeSingle();

        if (uErr) throw uErr;
        if (!user || user.reseller_status !== "approved") {
            return res.status(403).json({
                message: "Akses Partner Portal khusus akun reseller aktif.",
                reseller_status: user?.reseller_status || "none"
            });
        }

        const tier = await getTier(user.reseller_tier);

        // Ambil atau buat record API Key otomatis jika belum ada
        let apiKeyRow = null;
        try {
            const { data: keyData, error: keyErr } = await supabase
                .from("reseller_api_keys")
                .select("id, api_key, secret_key, ip_whitelist, webhook_url, webhook_secret, is_active, total_requests, last_used_at, created_at")
                .eq("user_id", user.id)
                .maybeSingle();

            if (keyErr && isMissingTableError(keyErr)) {
                return res.status(503).json({ message: BELUM_SETUP, code: "RESELLER_NOT_SETUP" });
            }

            if (!keyData) {
                const newKey = generateResellerApiKey();
                const newSec = generateResellerSecretKey();
                const newWhSec = generateResellerWebhookSecret();
                const { data: createdKey } = await supabase
                    .from("reseller_api_keys")
                    .insert([{
                        user_id: user.id,
                        api_key: newKey,
                        secret_key: newSec,
                        webhook_secret: newWhSec,
                        is_active: true
                    }])
                    .select()
                    .single();
                apiKeyRow = createdKey;
            } else {
                apiKeyRow = keyData;
            }
        } catch (err) {
            console.error("getPortalOverview key:", err.message);
        }

        res.json({
            user: {
                id: user.id,
                email: user.email,
                fullname: user.fullname,
                reseller_status: user.reseller_status,
                reseller_tier: tier ? { code: tier.code, name: tier.name, discount_percent: tier.discount_percent } : null,
                reseller_since: user.reseller_since
            },
            api_credentials: apiKeyRow ? {
                api_key: apiKeyRow.api_key,
                masked_secret: maskSecret(apiKeyRow.secret_key),
                ip_whitelist: apiKeyRow.ip_whitelist || "",
                webhook_url: apiKeyRow.webhook_url || "",
                webhook_secret: apiKeyRow.webhook_secret || "",
                is_active: apiKeyRow.is_active,
                total_requests: apiKeyRow.total_requests || 0,
                last_used_at: apiKeyRow.last_used_at,
                created_at: apiKeyRow.created_at
            } : null
        });
    } catch (err) {
        console.error("getPortalOverview:", err.message);
        res.status(500).json({ message: "Gagal memuat data portal reseller" });
    }
};

/**
 * Buka Kunci / Reveal Secret Key (Unmasked)
 */
exports.revealSecretKey = async (req, res) => {
    try {
        const { data: keyRecord, error } = await supabase
            .from("reseller_api_keys")
            .select("secret_key, webhook_secret")
            .eq("user_id", req.user.id)
            .maybeSingle();

        if (error || !keyRecord) {
            return res.status(404).json({ message: "Kredensial API tidak ditemukan" });
        }

        res.json({
            secret_key: keyRecord.secret_key,
            webhook_secret: keyRecord.webhook_secret
        });
    } catch (err) {
        console.error("revealSecretKey:", err.message);
        res.status(500).json({ message: "Gagal menampilkan Secret Key" });
    }
};

/**
 * Generate / Rotate API Key & Secret Key baru
 */
exports.generateOrRotateApiKey = async (req, res) => {
    try {
        const newApiKey = generateResellerApiKey();
        const newSecretKey = generateResellerSecretKey();
        const newWebhookSecret = generateResellerWebhookSecret();

        const { data, error } = await supabase
            .from("reseller_api_keys")
            .upsert({
                user_id: req.user.id,
                api_key: newApiKey,
                secret_key: newSecretKey,
                webhook_secret: newWebhookSecret,
                is_active: true,
                updated_at: new Date().toISOString()
            }, { onConflict: "user_id" })
            .select()
            .single();

        if (error) throw error;

        notify("reseller", `🔑 Reseller ${req.user.email} me-rotate API Key baru`);

        res.json({
            message: "API Key dan Secret Key baru berhasil dibuat. Simpan Secret Key di tempat aman!",
            api_key: data.api_key,
            secret_key: data.secret_key,
            webhook_secret: data.webhook_secret
        });
    } catch (err) {
        console.error("generateOrRotateApiKey:", err.message);
        res.status(500).json({ message: "Gagal membuat API Key baru" });
    }
};

/**
 * Update Pengaturan IP Whitelist & Webhook URL
 */
exports.updatePortalSettings = async (req, res) => {
    const rawIp = String(req.body.ip_whitelist || "").trim();
    const rawWebhook = String(req.body.webhook_url || "").trim();

    try {
        const payload = {
            ip_whitelist: rawIp || null,
            webhook_url: rawWebhook || null,
            updated_at: new Date().toISOString()
        };

        const { data, error } = await supabase
            .from("reseller_api_keys")
            .update(payload)
            .eq("user_id", req.user.id)
            .select("api_key, ip_whitelist, webhook_url, is_active")
            .single();

        if (error) throw error;

        res.json({
            message: "Pengaturan IP Whitelist & Webhook berhasil disimpan.",
            settings: data
        });
    } catch (err) {
        console.error("updatePortalSettings:", err.message);
        res.status(500).json({ message: "Gagal menyimpan pengaturan" });
    }
};

/**
 * Daftar Produk & Harga Modal Khusus Reseller untuk Portal
 */
exports.getPortalProducts = async (req, res) => {
    try {
        const konteksReseller = await getResellerContext(req.user.id);
        const searchQuery = String(req.query.q || "").toLowerCase().trim();
        const categoryFilter = String(req.query.kategori || "").trim();

        let query = supabase
            .from("topup_products")
            .select("id, nama, kode_produk, kategori, source_operator_name, harga_beli, harga_jual, butuh_server_id, is_active, operator_logo, item_icon")
            .eq("is_active", true)
            .order("kategori")
            .order("harga_jual")
            .limit(1000);

        if (categoryFilter && categoryFilter !== "all") {
            query = query.ilike("kategori", `%${categoryFilter}%`);
        }

        const { data: products, error } = await query;
        if (error) throw error;

        const results = (products || []).map((p) => {
            let hargaNormal = p.harga_jual;
            if (!hargaNormal || hargaNormal === 0) {
                hargaNormal = hitungMarkupWajar(p.harga_beli || 0, p.kategori, p.source_operator_name);
            }

            const rCalc = hitungHargaReseller(hargaNormal, p.harga_beli || 0, konteksReseller.discountPercent || 0);

            return {
                id: p.id,
                kode_produk: p.kode_produk,
                nama: cleanProductName(p.nama),
                kategori: p.kategori,
                operator: p.source_operator_name || p.kategori,
                harga_normal: rCalc.harga_normal,
                harga_modal_reseller: rCalc.harga,
                diskon_persen: konteksReseller.discountPercent,
                butuh_server_id: !!p.butuh_server_id,
                status: "tersedia",
                operator_logo: p.operator_logo,
                item_icon: p.item_icon
            };
        });

        // Client search filter
        const filtered = searchQuery
            ? results.filter(
                  (p) =>
                      p.kode_produk.toLowerCase().includes(searchQuery) ||
                      p.nama.toLowerCase().includes(searchQuery) ||
                      p.operator.toLowerCase().includes(searchQuery)
              )
            : results;

        res.json({
            tier: konteksReseller.tierName || "Reseller",
            discount_percent: konteksReseller.discountPercent || 0,
            total_products: filtered.length,
            products: filtered
        });
    } catch (err) {
        console.error("getPortalProducts:", err.message);
        res.status(500).json({ message: "Gagal memuat katalog produk portal reseller" });
    }
};

/**
 * Riwayat Transaksi Reseller
 */
exports.getPortalOrders = async (req, res) => {
    try {
        const { data: orders, error } = await supabase
            .from("topup_orders")
            .select("id, ref_id, produk, tujuan, server_id, total, status, sn, message, payment_method, created_at, updated_at")
            .eq("user_id", req.user.id)
            .order("created_at", { ascending: false })
            .limit(100);

        if (error) throw error;

        res.json(orders || []);
    } catch (err) {
        console.error("getPortalOrders:", err.message);
        res.status(500).json({ message: "Gagal memuat riwayat transaksi" });
    }
};

/**
 * Tes Kirim Webhook ke URL Reseller
 */
exports.testPortalWebhook = async (req, res) => {
    try {
        const { data: keyRecord, error } = await supabase
            .from("reseller_api_keys")
            .select("webhook_url, webhook_secret")
            .eq("user_id", req.user.id)
            .maybeSingle();

        if (error || !keyRecord || !keyRecord.webhook_url) {
            return res.status(400).json({ message: "URL Webhook belum diatur. Masukkan URL endpoint callback Anda terlebih dahulu." });
        }

        const targetUrl = keyRecord.webhook_url;
        const secret = keyRecord.webhook_secret || "whsec_test";
        const timestamp = Math.floor(Date.now() / 1000).toString();

        const testPayload = {
            source: "nexshop_gateway",
            relayed_by: "nexshop",
            event: "nexshop.test",
            received_at: new Date().toISOString(),
            data: {
                ref_id: "TEST-TRX-" + Date.now(),
                trx_id: "NX-TEST-998811",
                produk: "ML86",
                tujuan: "12345678",
                server_id: "2123",
                status: 1,
                status_message: "sukses",
                sn: "TEST_SN_NEXSHOP_2026",
                message: "Tes Callback Webhook Reseller Berhasil",
                saldo_terpotong: 18500
            }
        };

        const rawBody = JSON.stringify(testPayload);
        const signature = "sha256=" + crypto.createHmac("sha256", secret).update(timestamp + "." + rawBody).digest("hex");

        const startTime = Date.now();
        let responseStatus = 0;
        let responseSnippet = "";

        try {
            const resp = await axios.post(targetUrl, rawBody, {
                headers: {
                    "Content-Type": "application/json",
                    "User-Agent": "NexShop-Webhook-Relay/1.0",
                    "X-NexShop-Event": "nexshop.test",
                    "X-NexShop-Delivery": "test-delivery-" + Date.now(),
                    "X-NexShop-Timestamp": timestamp,
                    "X-NexShop-Attempt": "1",
                    "X-NexShop-Signature": signature
                },
                timeout: 8000
            });
            responseStatus = resp.status;
            responseSnippet = typeof resp.data === "object" ? JSON.stringify(resp.data).slice(0, 300) : String(resp.data).slice(0, 300);
        } catch (postErr) {
            responseStatus = postErr.response ? postErr.response.status : 0;
            responseSnippet = postErr.response?.data ? (typeof postErr.response.data === "object" ? JSON.stringify(postErr.response.data).slice(0, 300) : String(postErr.response.data).slice(0, 300)) : postErr.message;
        }

        const durationMs = Date.now() - startTime;
        const isSuccess = responseStatus >= 200 && responseStatus < 300;

        res.json({
            success: isSuccess,
            status_code: responseStatus,
            duration_ms: durationMs,
            target_url: targetUrl,
            response_body: responseSnippet || "(kosong)",
            message: isSuccess
                ? "Tes webhook BERHASIL! Server Anda merespons HTTP " + responseStatus
                : "Tes webhook GAGAL. Server Anda merespons HTTP " + (responseStatus || "Timeout/Connection Error")
        });
    } catch (err) {
        console.error("testPortalWebhook:", err.message);
        res.status(500).json({ message: "Gagal mengirim tes webhook: " + err.message });
    }
};

exports._internal = { normalisasiWhatsApp };
