const path = require("path");
const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

dotenv.config();

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
const { startTopupStatusPoller } = require("./jobs/topupStatusPoller");

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
const PORT = process.env.PORT || 3000;

if (process.env.NODE_ENV === "production") {
    const requiredEnvironment = ["JWT_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_KEY", "FRONTEND_URL", "BACKEND_URL"];
    const missingEnvironment = requiredEnvironment.filter((name) => !process.env[name]);
    if (missingEnvironment.length) {
        throw new Error(`Environment production belum lengkap: ${missingEnvironment.join(", ")}`);
    }
}

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
    credentials: true
}));

app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "100kb" }));

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Terlalu banyak permintaan. Coba lagi beberapa menit." },
    // Hanya webhook provider yang dikecualikan. Pengecekan substring lama
    // membuat setiap endpoint dengan kata "notification" ikut melewati limit.
    skip: (req) => ["/orders/notification", "/topup/notification", "/topup/tokovoucher-webhook"].includes(req.path)
});
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
// Home
// =========================
app.get("/", (req, res) => {
    res.send("Backend NexShop Berjalan");
});

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

    startTopupStatusPoller();
});
