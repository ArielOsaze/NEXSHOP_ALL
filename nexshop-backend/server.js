const path = require("path");
const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

dotenv.config();

const PORT = process.env.PORT || 3000;

// Validasi ini harus mendahului require route/controller karena beberapa di
// antaranya membuat klien Supabase saat modul dimuat.
if (process.env.NODE_ENV === "production") {
    const requiredEnvironment = ["JWT_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_KEY", "FRONTEND_URL", "BACKEND_URL"];
    const missingEnvironment = requiredEnvironment.filter((name) => !process.env[name]);
    if (missingEnvironment.length) {
        throw new Error(`Environment production belum lengkap: ${missingEnvironment.join(", ")}`);
    }
}

require("./config/db");

const authRoutes = require("./routes/authRoutes");
const orderRoutes = require("./routes/orderRoutes");
const productRoutes = require("./routes/productRoutes");
const userRoutes = require("./routes/userRoutes");
const promoRoutes = require("./routes/promoRoutes");
const authMiddleware = require("./middleware/authMiddleware");
const uploadRoutes = require("./routes/uploadRoutes");
const topupRoutes = require("./routes/topupRoutes");
const settingsRoutes = require("./routes/settingsRoutes");
const promoCodeRoutes = require("./routes/promoCodeRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const statsRoutes = require("./routes/statsRoutes");
const newsRoutes = require("./routes/newsRoutes");
const aiRoutes = require("./routes/aiRoutes");
const ratingRoutes = require("./routes/ratingRoutes");
const musicRoutes = require("./routes/musicRoutes");
const sitemapController = require("./controllers/sitemapController");
const ssrController = require("./controllers/ssrController");
const { startTopupStatusPoller } = require("./jobs/topupStatusPoller");
const { startRetryPoller } = require("./jobs/notificationRetryPoller");
const { startScheduledPublishPoller } = require("./jobs/scheduledPublishPoller");
const { startCatalogSyncPoller } = require("./jobs/catalogSyncPoller");

const app = express();

// Backend ini jalan di belakang Nginx (reverse proxy) yang nge-set header
// X-Forwarded-For dengan IP asli client (lihat nginx-nexshop.conf). Tanpa
// baris ini, Express nganggep SEMUA request datengnya dari Nginx sendiri
// (127.0.0.1) -- itu bikin rate limiter di bawah salah sasaran (nge-batesin
// SEMUA orang bareng-bareng kayak 1 IP tunggal), dan express-rate-limit
// versi baru malah bakal nolak request sama sekali (validation error) kalau
// dia liat ada X-Forwarded-For tapi trust proxy belum di-set. "1" artinya:
// percaya IP dari PERSIS 1 lapis proxy di depan app ini (si Nginx itu).
app.set("trust proxy", 1);

// =========================
// Config
// =========================
// =========================
// Middleware
// =========================
app.disable("x-powered-by");

app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    if (process.env.NODE_ENV === "production") {
        res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
});

const allowedOrigins = [
    "https://nexshop.cloud",
    "https://www.nexshop.cloud",
    "http://127.0.0.1:5500",
    "http://localhost:5500"
];
if (process.env.FRONTEND_URL) {
    const cleanFrontendUrl = process.env.FRONTEND_URL.replace(/\/$/, "");
    if (!allowedOrigins.includes(cleanFrontendUrl)) {
        allowedOrigins.push(cleanFrontendUrl);
    }
}

app.use(cors({
    origin: allowedOrigins,
    credentials: true,
    exposedHeaders: ["X-Admin-Pin-Error"]
}));

app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "100kb" }));

// Batas 300/15 menit kekecilan buat dashboard admin: satu sesi kerja di tab
// Topup aja (polling status sync tiap 3 detik + muat ulang tabel tiap habis
// aksi massal) gampang nembus 300 request, dan begitu kena limit SEMUA
// panel dashboard serempak nampilin "gagal mengambil data" -- kelihatan
// kayak backend-nya rusak padahal cuma kena rate limit sendiri.
//
// Endpoint /api/admin/* dikasih jatah sendiri yang lebih longgar; endpoint
// publik tetap 300 seperti semula.
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Terlalu banyak permintaan. Coba lagi beberapa menit." },
    // Hanya webhook provider yang dikecualikan. Pengecekan substring lama
    // membuat setiap endpoint dengan kata "notification" ikut melewati limit.
    // Rute admin juga dilewat di sini karena udah dijaga adminApiLimiter --
    // kalau enggak, request dashboard kehitung DUA KALI (di limiter admin
    // DAN di limiter publik) dan tetap mentok di 300.
    skip: (req) =>
        WEBHOOK_PATHS.includes(req.path) || isAdminApiPath(req.path)
});

const WEBHOOK_PATHS = ["/orders/notification", "/topup/notification", "/topup/tokovoucher-webhook"];

// Dicek relatif terhadap mount point "/api" (req.path di dalam middleware
// yang dipasang di app.use("/api", ...) udah dipotong prefix-nya).
const ADMIN_API_PREFIXES = ["/admin", "/topup/admin", "/stats/overview", "/stats/export-orders", "/stats/system-health", "/settings"];

function isAdminApiPath(path) {
    return ADMIN_API_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix + "/"));
}

const adminApiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 2000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Terlalu banyak permintaan dari dashboard. Tunggu sebentar lalu muat ulang." }
});
// Limiter admin dipasang duluan; limiter publik di bawahnya sengaja
// nge-skip rute yang sama supaya gak dobel hitung.
app.use("/api", (req, res, next) => (isAdminApiPath(req.path) ? adminApiLimiter(req, res, next) : next()));
app.use("/api", apiLimiter);

// Jaga-jaga: kalau ada request PUT/POST yang body-nya kosong/gak ke-parse
// (mis. Content-Type gak ke-set, atau body literally kosong), req.body bisa
// jadi undefined. Beberapa controller langsung destructure req.body tanpa
// cek dulu — tanpa ini, itu bikin server 500 crash mentah-mentah
// ("Cannot destructure property '...' of 'req.body' as it is undefined").
app.use((req, res, next) => {
    if (!req.body) req.body = {};
    next();
});

// Static Folder
app.use(express.static(path.join(__dirname, "public")));

// =========================
// API Routes
// =========================
app.get("/api/sitemap", sitemapController.generateSitemap);
app.use("/api/auth", authRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/products", productRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/users", userRoutes);
app.use("/api/promo", promoRoutes);
app.use("/api/topup", topupRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/promo-codes", promoCodeRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/admin/stats", statsRoutes);
app.use("/api/news", newsRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/admin/ai", aiRoutes);
app.use("/api/ratings", ratingRoutes);
app.use("/api/music", musicRoutes);
app.use("/api/stats", statsRoutes); // sama router — /api/stats/public dibuka publik, /api/stats/overview tetap butuh admin

// Endpoint diagnostik hanya tersedia saat development.
if (process.env.NODE_ENV !== "production") {
    app.post("/tes", (req, res) => res.json({ status: "OK" }));
}

// =========================
// Protected Route
// =========================
app.get("/profile", authMiddleware, (req, res) => {
    res.json({
        message: "Selamat datang",
        user: req.user
    });
});

// =========================
// Home & SSR
// =========================
app.get("/", (req, res) => {
    res.send("Backend NexShop Berjalan");
});

app.get("/berita/:slug", ssrController.renderArticle);

// =========================
// 404 Handler
// =========================
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: "Endpoint tidak ditemukan"
    });
});

// =========================
// Global Error Handler
// =========================
app.use((err, req, res, next) => {
    console.error("❌ Server Error:", err);

    const status = Number(err.status) >= 400 && Number(err.status) < 600 ? Number(err.status) : 500;
    res.status(status).json({
        success: false,
        message: process.env.NODE_ENV === "production" ? "Terjadi kesalahan pada server" : (err.message || "Internal Server Error")
    });
});

// =========================
// Start Server
// =========================
app.listen(PORT, () => {
    console.log("=================================");
    console.log("🚀 NexShop Backend Running");
    console.log(`🌐 URL          : http://localhost:${PORT}`);
    console.log(`📦 Environment  : ${process.env.NODE_ENV || "development"}`);
    console.log(`🗄️ Database     : Supabase`);
    console.log("=================================");

    // Poller latar hanya nyala kalau ENABLE_POLLERS=1. Default mati supaya
    // menjalankan backend secara lokal tidak memicu notifikasi/payment/sync
    // ke provider live. Set ENABLE_POLLERS=1 di production untuk mengaktifkan.
    if (process.env.ENABLE_POLLERS === "1") {
        startTopupStatusPoller();
        startRetryPoller();
        startScheduledPublishPoller();
        startCatalogSyncPoller();
    } else {
        console.log("⏸️  Background pollers dimatikan (set ENABLE_POLLERS=1 untuk mengaktifkan)");
    }
});
