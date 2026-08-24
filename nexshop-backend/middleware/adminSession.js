const supabase = require("../config/db");

// ===========================================================
// GERBANG AKSES ADMIN — dipakai bareng adminMiddleware (admin+staff) dan
// superAdminMiddleware (admin saja).
//
// Dua hal yang DULU gak dijaga dan sekarang dijaga di sini:
//
// 1) ROLE DIAMBIL ULANG DARI DATABASE, bukan cuma percaya isi JWT.
//    Role nempel di token pas login, jadi kalau seseorang diturunin dari
//    admin jadi user biasa (atau di-blacklist), token lamanya MASIH bilang
//    "admin" sampai token itu kedaluwarsa sendiri. Di sini role dicek ulang
//    ke tabel users (di-cache sebentar biar gak nembak DB tiap request),
//    jadi pencabutan akses langsung berlaku.
//
// 2) SESI ADMIN MATI SENDIRI SETELAH IDLE. Timer di browser doang gampang
//    dilewatin (tinggal gak jalanin JS-nya), makanya batas idle-nya juga
//    dipaksa di server: kalau gak ada aktivitas admin selama
//    ADMIN_IDLE_LIMIT_MS, request berikutnya ditolak 401 dan admin harus
//    login lagi.
//
//    Polling latar (notifikasi tiap 30 detik, status sync, dst) TIDAK
//    dihitung sebagai aktivitas -- kalau dihitung, sesi bakal hidup terus
//    selamanya walaupun orangnya udah ninggalin komputer. Frontend nandain
//    request semacam itu dengan header X-Admin-Background: 1.
//
// Catatan: penyimpanannya di memori proses. Backend ini jalan single
// instance (lihat ecosystem.config.js, instances: 1), jadi cukup. Kalau
// nanti di-scale ke banyak worker, pindahin dua Map di bawah ke Redis/DB.
// ===========================================================

const ADMIN_IDLE_LIMIT_MS = Number(process.env.ADMIN_IDLE_LIMIT_MS || 15 * 60 * 1000);
const ROLE_CACHE_TTL_MS = 60 * 1000;

const roleCache = new Map(); // userId -> { role, blacklisted, at }
const lastActivity = new Map(); // userId -> timestamp aktivitas admin terakhir

// Buang entri yang udah basi biar Map-nya gak numpuk terus seumur proses.
function pruneStale(now) {
    const batasan = ADMIN_IDLE_LIMIT_MS * 12;
    for (const [id, ts] of lastActivity.entries()) {
        if (now - ts > batasan) lastActivity.delete(id);
    }
    for (const [id, entry] of roleCache.entries()) {
        if (now - entry.at > ROLE_CACHE_TTL_MS * 30) roleCache.delete(id);
    }
}

async function resolveLiveRole(userId) {
    const cached = roleCache.get(userId);
    const now = Date.now();
    if (cached && now - cached.at < ROLE_CACHE_TTL_MS) return cached;

    let { data, error } = await supabase
        .from("users")
        .select("role, is_blacklisted")
        .eq("id", userId)
        .maybeSingle();

    // Kolom is_blacklisted belum ada di skema (deployment lama)? Coba lagi
    // dengan kolom role saja, jangan langsung nolak semua request admin.
    if (error) {
        const ulang = await supabase.from("users").select("role").eq("id", userId).maybeSingle();
        if (!ulang.error) {
            data = ulang.data ? { role: ulang.data.role, is_blacklisted: false } : null;
            error = null;
        }
    }

    // Gagal membaca role live harus fail-closed. Memakai role lama yang
    // tertanam di JWT akan menghidupkan kembali akses admin yang sudah
    // dicabut persis ketika database sedang bermasalah.
    if (error) {
        const failure = new Error("Status akses admin tidak dapat diverifikasi");
        failure.code = "ADMIN_AUTH_UNAVAILABLE";
        failure.cause = error;
        throw failure;
    }

    if (!data) return { role: null, blacklisted: false, at: now };

    const entry = { role: data.role || null, blacklisted: !!data.is_blacklisted, at: now };
    roleCache.set(userId, entry);
    return entry;
}

// Dipanggil setelah login sukses supaya sesi lama yang udah kedaluwarsa
// karena idle gak langsung nolak token yang baru dibuat.
function resetAdminSession(userId) {
    if (!userId) return;
    lastActivity.delete(userId);
    roleCache.delete(userId);
}

// deniedCode dibedain per guard: "ADMIN_ACCESS_REVOKED" artinya akun ini
// memang gak berhak masuk dashboard sama sekali (frontend langsung logout),
// sedangkan "SUPERADMIN_REQUIRED" cuma berarti fitur itu khusus Super Admin
// -- staff yang kena ini TIDAK boleh ikut ke-logout.
function buildAdminGuard(allowedRoles, deniedMessage, deniedCode = "ADMIN_ACCESS_REVOKED") {
    return async function adminGuard(req, res, next) {
        if (!req.user || !req.user.id) {
            return res.status(401).json({ success: false, message: "Token tidak valid" });
        }

        let live;
        try {
            live = await resolveLiveRole(req.user.id);
        } catch (err) {
            console.error("adminSession:", err.message, err.cause?.message || "");
            return res.status(503).json({
                success: false,
                message: "Status akses admin sedang tidak dapat diverifikasi. Coba lagi sebentar.",
                code: "ADMIN_AUTH_UNAVAILABLE"
            });
        }

        if (live.blacklisted || !allowedRoles.includes(live.role)) {
            roleCache.delete(req.user.id);
            return res.status(403).json({ success: false, message: deniedMessage, code: deniedCode });
        }

        // Role terbaru dipakai controller di bawahnya (bukan role dari JWT)
        req.user.role = live.role;

        const now = Date.now();
        const background = String(req.get("X-Admin-Background") || "") === "1";
        const last = lastActivity.get(req.user.id);

        if (last && now - last > ADMIN_IDLE_LIMIT_MS) {
            lastActivity.delete(req.user.id);
            return res.status(401).json({
                success: false,
                message: `Sesi admin berakhir otomatis karena tidak ada aktivitas selama ${Math.round(
                    ADMIN_IDLE_LIMIT_MS / 60000
                )} menit. Silakan login kembali.`,
                code: "ADMIN_IDLE_TIMEOUT"
            });
        }

        // Polling latar cuma boleh MEMPERTAHANKAN sesi yang belum tercatat,
        // bukan nge-reset hitungan idle.
        if (!background || !last) lastActivity.set(req.user.id, now);

        pruneStale(now);
        next();
    };
}

module.exports = {
    ADMIN_IDLE_LIMIT_MS,
    buildAdminGuard,
    resetAdminSession
};
