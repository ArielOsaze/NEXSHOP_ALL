const express = require("express");
const router = express.Router();
const topupController = require("../controllers/topupController");
const authMiddleware = require("../middleware/authMiddleware");
const optionalAuthMiddleware = require("../middleware/optionalAuthMiddleware");

// Publik
router.get("/products", topupController.getProducts);

// Checkout — boleh guest atau login, sama seperti /api/orders
router.post("/", optionalAuthMiddleware, topupController.create);

// User
router.get("/my", authMiddleware, topupController.getMyOrders);

// Admin
router.get("/admin/products", authMiddleware, topupController.getAllProductsAdmin);
router.get("/admin/sync", authMiddleware, topupController.syncProducts);
router.put("/admin/products/:id", authMiddleware, topupController.updateProduct);
router.delete("/admin/products/:id", authMiddleware, topupController.deleteProduct);
router.get("/admin/orders", authMiddleware, topupController.getAllOrders);
router.get("/admin/balance", authMiddleware, topupController.getBalance);
router.get("/status/:id", authMiddleware, topupController.checkStatus);

// Webhooks — SENGAJA tanpa authMiddleware (dipanggil server Midtrans/TokoVoucher),
// masing-masing diverifikasi keasliannya di dalam controller.
router.post("/notification", topupController.handleMidtransNotification);
router.post("/tokovoucher-webhook", topupController.handleTokoVoucherWebhook);

module.exports = router;
