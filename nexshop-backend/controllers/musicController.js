const fs = require("fs");
const path = require("path");
const supabase = require("../config/db");

const PUBLIC_MUSIC_CACHE_TTL_MS = 60 * 1000;
const PUBLIC_MUSIC_STALE_CACHE_MAX_AGE_MS = PUBLIC_MUSIC_CACHE_TTL_MS * 10;
const PUBLIC_MUSIC_QUERY_TIMEOUT_MS = 3500;
const PUBLIC_MUSIC_CACHE_FILE = path.join(__dirname, "../.runtime-cache/public-music.json");

function loadPersistedPublicMusicCache() {
    try {
        const record = JSON.parse(fs.readFileSync(PUBLIC_MUSIC_CACHE_FILE, "utf8"));
        if (!record || !record.payload || !Number.isFinite(Number(record.cachedAt))) return { payload: null, cachedAt: 0 };
        return { payload: record.payload, cachedAt: Number(record.cachedAt) };
    } catch (_) {
        return { payload: null, cachedAt: 0 };
    }
}

let publicMusicCache = loadPersistedPublicMusicCache();

function persistPublicMusicCache() {
    try {
        fs.mkdirSync(path.dirname(PUBLIC_MUSIC_CACHE_FILE), { recursive: true });
        const temporaryFile = `${PUBLIC_MUSIC_CACHE_FILE}.tmp`;
        fs.writeFileSync(temporaryFile, JSON.stringify(publicMusicCache), { encoding: "utf8", mode: 0o600 });
        fs.renameSync(temporaryFile, PUBLIC_MUSIC_CACHE_FILE);
    } catch (error) {
        console.warn("Gagal menyimpan cache musik publik:", error.message);
    }
}

function setPublicMusicCache(payload) {
    publicMusicCache = { payload, cachedAt: Date.now() };
    persistPublicMusicCache();
}

function timeoutError(label, timeoutMs) {
    const error = new Error(`${label} timeout setelah ${timeoutMs}ms`);
    error.code = "UPSTREAM_TIMEOUT";
    return error;
}

function withTimeout(promise, timeoutMs, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(timeoutError(label, timeoutMs)), timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function serveCachedPublicMusic(res, { stale = false } = {}) {
    if (!publicMusicCache.payload) return false;
    if (stale && Date.now() - publicMusicCache.cachedAt > PUBLIC_MUSIC_STALE_CACHE_MAX_AGE_MS) return false;
    res.setHeader("X-NexShop-Config-Source", stale ? "stale-cache" : "memory-cache");
    res.json(publicMusicCache.payload);
    return true;
}

// Ambil konfigurasi public (Hanya yang aktif)
exports.getPublicMusic = async (req, res) => {
    try {
        if (publicMusicCache.payload && Date.now() - publicMusicCache.cachedAt < PUBLIC_MUSIC_CACHE_TTL_MS) {
            if (serveCachedPublicMusic(res)) return;
        }
        // Cek master toggle dari store_settings
        const { data: settings, error: settingsError } = await withTimeout(
            supabase
                .from("store_settings")
                .select("music_player_enabled")
                .eq("id", 1)
                .maybeSingle(),
            PUBLIC_MUSIC_QUERY_TIMEOUT_MS,
            "store_settings"
        );

        if (settingsError) {
            console.error("Error fetching store_settings:", settingsError);
            if (serveCachedPublicMusic(res, { stale: true })) return;
            return res.status(503).json({ message: "Konfigurasi musik sedang tidak tersedia" });
        }

        if (!settings || !settings.music_player_enabled) {
            const payload = { enabled: false, music: null };
            setPublicMusicCache(payload);
            return res.json(payload);
        }

        // Ambil lagu yang aktif
        const { data: music, error: musicError } = await withTimeout(
            supabase
                .from("music_player")
                .select("id, title, audio_url, cover_url")
                .eq("is_active", true)
                .maybeSingle(),
            PUBLIC_MUSIC_QUERY_TIMEOUT_MS,
            "music_player"
        );

        if (musicError) {
            console.error("Error fetching active music:", musicError);
            if (serveCachedPublicMusic(res, { stale: true })) return;
            return res.status(503).json({ message: "Lagu aktif sedang tidak tersedia" });
        }

        const payload = {
            enabled: true,
            music: music || null
        };
        setPublicMusicCache(payload);
        res.json(payload);
    } catch (err) {
        console.error("getPublicMusic error:", err);
        if (serveCachedPublicMusic(res, { stale: true })) return;
        res.status(503).json({ message: "Layanan musik sedang tidak tersedia" });
    }
};

// Ambil semua daftar lagu (Admin)
exports.getAdminMusic = async (req, res) => {
    if (!["admin", "staff"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak" });
    }

    try {
        const { data: settings } = await supabase
            .from("store_settings")
            .select("music_player_enabled")
            .eq("id", 1)
            .maybeSingle();

        const { data: musicList, error } = await supabase
            .from("music_player")
            .select("*")
            .order("created_at", { ascending: false });

        if (error) {
            console.error("Error fetching admin music:", error);
            return res.status(500).json({ message: "Gagal mengambil daftar lagu" });
        }

        res.json({
            enabled: settings ? settings.music_player_enabled : true,
            musicList: musicList || []
        });
    } catch (err) {
        console.error("getAdminMusic error:", err);
        res.status(500).json({ message: "Server Error" });
    }
};

// Tambah lagu baru (Admin)
exports.addMusic = async (req, res) => {
    if (!["admin", "staff"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak" });
    }

    const { title, audio_url, cover_url } = req.body;

    if (!title || !audio_url || !cover_url) {
        return res.status(400).json({ message: "Judul, Audio URL, dan Cover URL wajib diisi" });
    }

    try {
        const { data, error } = await supabase
            .from("music_player")
            .insert([{
                title,
                audio_url,
                cover_url,
                is_active: false // Default inactive, admin harus set aktif manual
            }])
            .select()
            .single();

        if (error) {
            console.error("Error adding music:", error);
            return res.status(500).json({ message: "Gagal menyimpan data lagu" });
        }

        res.status(201).json({ message: "Lagu berhasil ditambahkan", data });
    } catch (err) {
        console.error("addMusic error:", err);
        res.status(500).json({ message: "Server Error" });
    }
};

// Edit lagu (Admin)
exports.updateMusic = async (req, res) => {
    if (!["admin", "staff"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak" });
    }

    const { id } = req.params;
    const { title, audio_url, cover_url } = req.body;

    if (!title || !audio_url || !cover_url) {
        return res.status(400).json({ message: "Judul, Audio URL, dan Cover URL wajib diisi" });
    }

    try {
        const { data, error } = await supabase
            .from("music_player")
            .update({
                title,
                audio_url,
                cover_url,
                updated_at: new Date()
            })
            .eq("id", id)
            .select()
            .single();

        if (error) {
            console.error("Error updating music:", error);
            return res.status(500).json({ message: "Gagal mengupdate data lagu" });
        }

        res.json({ message: "Lagu berhasil diupdate", data });
    } catch (err) {
        console.error("updateMusic error:", err);
        res.status(500).json({ message: "Server Error" });
    }
};

// Set lagu menjadi aktif (Admin)
exports.setActiveMusic = async (req, res) => {
    if (!["admin", "staff"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak" });
    }

    const { id } = req.params;

    try {
        // 1. Matikan semua lagu yang aktif saat ini (id != param)
        const { error: resetError } = await supabase
            .from("music_player")
            .update({ is_active: false })
            .neq("id", id)
            .eq("is_active", true);

        if (resetError) {
            console.error("Error resetting active music:", resetError);
            return res.status(500).json({ message: "Gagal me-reset lagu aktif" });
        }

        // 2. Aktifkan lagu yang dipilih
        const { data, error: updateError } = await supabase
            .from("music_player")
            .update({ is_active: true })
            .eq("id", id)
            .select()
            .single();

        if (updateError) {
            console.error("Error setting active music:", updateError);
            return res.status(500).json({ message: "Gagal mengaktifkan lagu" });
        }

        res.json({ message: "Lagu berhasil diaktifkan", data });
    } catch (err) {
        console.error("setActiveMusic error:", err);
        res.status(500).json({ message: "Server Error" });
    }
};

// Hapus lagu (Admin)
exports.deleteMusic = async (req, res) => {
    if (!["admin", "staff"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak" });
    }

    const { id } = req.params;

    try {
        // Jangan hapus lagu jika sedang aktif, admin harus pilih lagu lain atau matikan player
        const { data: music } = await supabase
            .from("music_player")
            .select("is_active")
            .eq("id", id)
            .single();
            
        if (music && music.is_active) {
             return res.status(400).json({ message: "Tidak dapat menghapus lagu yang sedang aktif. Silakan aktifkan lagu lain atau matikan Music Player terlebih dahulu." });
        }

        const { error } = await supabase
            .from("music_player")
            .delete()
            .eq("id", id);

        if (error) {
            console.error("Error deleting music:", error);
            return res.status(500).json({ message: "Gagal menghapus lagu dari database" });
        }

        res.json({ message: "Lagu berhasil dihapus" });
    } catch (err) {
        console.error("deleteMusic error:", err);
        res.status(500).json({ message: "Server Error" });
    }
};

// Toggle Music Player ON/OFF (Admin)
exports.toggleMusicPlayer = async (req, res) => {
    if (!["admin", "staff"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak" });
    }

    const { enabled } = req.body;

    if (typeof enabled !== "boolean") {
        return res.status(400).json({ message: "Format enabled tidak valid" });
    }

    try {
        const { error } = await supabase
            .from("store_settings")
            .update({ music_player_enabled: enabled })
            .eq("id", 1);

        if (error) {
            console.error("Error toggling music player:", error);
            return res.status(500).json({ message: "Gagal mengubah status Music Player" });
        }

        res.json({ message: `Music Player berhasil di-${enabled ? "aktifkan" : "nonaktifkan"}` });
    } catch (err) {
        console.error("toggleMusicPlayer error:", err);
        res.status(500).json({ message: "Server Error" });
    }
};
