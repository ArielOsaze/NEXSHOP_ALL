const path = require("path");
const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");

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

const app = express();

// =========================
// Config
// =========================
const PORT = process.env.PORT || 3000;

// =========================
// Middleware
// =========================
app.use(cors({
    origin: [
        "https://nexshop.cloud",
        "https://www.nexshop.cloud",
        "http://127.0.0.1:5500",
        "http://localhost:5500"
    ],
    credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

// =========================
// Test API
// =========================
app.post("/tes", (req, res) => {
    res.json({
        status: "OK"
    });
});

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
    res.send("Backend NexShop Berjalan 🚀");
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

    res.status(err.status || 500).json({
        success: false,
        message: err.message || "Internal Server Error"
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
});