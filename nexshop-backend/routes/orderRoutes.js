const express = require("express");
const router = express.Router();
const orderController = require("../controllers/orderController");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const optionalAuthMiddleware = require("../middleware/optionalAuthMiddleware");

// pakai optionalAuthMiddleware: checkout boleh dari guest (tanpa login) ATAU user login
router.post("/", optionalAuthMiddleware, orderController.create);

router.get("/my", authMiddleware, orderController.getMyOrders);
router.get("/status/:id", orderController.getPublicStatus); // publik — buat halaman kembali dari pembayaran
router.get("/track/:id", orderController.getPublicDetail); // publik — buat tab "Cek Transaksi"
router.get("/", authMiddleware, adminMiddleware, orderController.getAllOrders); // admin dashboard
router.put("/:id/status", authMiddleware, adminMiddleware, orderController.updateOrderStatusAdmin);
router.post("/:id/actions", authMiddleware, adminMiddleware, orderController.adminOrderAction);

// Webhook dari server iPaymu — SENGAJA tanpa authMiddleware, karena yang
// memanggil endpoint ini adalah server iPaymu, bukan user yang login.
// Keasliannya diverifikasi ulang server-to-server di dalam orderController.handleNotification.
router.post("/notification", orderController.handleNotification);

module.exports = router;
