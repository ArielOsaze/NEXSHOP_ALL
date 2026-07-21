const path = require("path");
const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");

dotenv.config();

const db = require("./config/db");

const authRoutes = require("./routes/authRoutes");
const orderRoutes = require("./routes/orderRoutes");
const productRoutes = require("./routes/productRoutes");
const userRoutes = require("./routes/userRoutes"); // baru
const promoRoutes = require("./routes/promoRoutes"); // baru
const authMiddleware = require("./middleware/authMiddleware");
const uploadRoutes = require("./routes/uploadRoutes");
const topupRoutes = require("./routes/topupRoutes"); // baru: topup diamond (TokoVoucher)
const settingsRoutes = require("./routes/settingsRoutes"); // baru: settings & api keys
const promoCodeRoutes = require("./routes/promoCodeRoutes"); // baru: kode promo / redeem code
const notificationRoutes = require("./routes/notificationRoutes"); // baru: notifikasi admin

const app = express();

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

// Folder public (HTML, CSS, JS)
app.use(express.static(path.join(__dirname, "public")));

// =========================
// Routes API
// =========================
app.use("/api/auth", authRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/products", productRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/users", userRoutes); // baru
app.use("/api/promo", promoRoutes); // baru
app.use("/api/topup", topupRoutes); // baru: topup diamond (TokoVoucher)
app.use("/api/settings", settingsRoutes); // baru: settings & api keys
app.use("/api/promo-codes", promoCodeRoutes); // baru: kode promo / redeem code
app.use("/api/notifications", notificationRoutes); // baru: notifikasi admin

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
// Start Server
// =========================
app.listen(3000, () => {
    console.log("=================================");
    console.log("🚀 NexShop Backend Running");
    console.log("🌐 http://localhost:3000");
    console.log("=================================");
});
