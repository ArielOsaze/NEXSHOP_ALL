const express = require("express");
const router = express.Router();
const orderController = require("../controllers/orderController");
const authMiddleware = require("../middleware/authMiddleware");
const optionalAuthMiddleware = require("../middleware/optionalAuthMiddleware");

// pakai optionalAuthMiddleware: checkout boleh dari guest (tanpa login) ATAU user login
router.post("/", optionalAuthMiddleware, orderController.create);

router.get("/my", authMiddleware, orderController.getMyOrders);
router.get("/", authMiddleware, orderController.getAllOrders); // baru: buat admin dashboard

// Webhook dari server Midtrans — SENGAJA tanpa authMiddleware, karena yang
// memanggil endpoint ini adalah server Midtrans, bukan user yang login.
// Keasliannya diverifikasi otomatis di dalam orderController.handleNotification.
router.post("/notification", orderController.handleNotification);

module.exports = router;
