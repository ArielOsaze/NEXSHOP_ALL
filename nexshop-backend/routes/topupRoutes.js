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
router.get("/public-status/:id", topupController.getPublicStatus); // publik — buat halaman kembali dari pembayaran

// Admin
router.get("/admin/products", authMiddleware, topupController.getAllProductsAdmin);
router.get("/admin/sync", authMiddleware, topupController.syncProducts);
router.put("/admin/products/:id", authMiddleware, topupController.updateProduct);
router.delete("/admin/products/:id", authMiddleware, topupController.deleteProduct);
router.delete("/admin/products", authMiddleware, topupController.deleteAllProducts); // hapus semua (opsional ?kategori=...)
router.put("/admin/category-logo", authMiddleware, topupController.updateCategoryLogo); // set logo game utk 1 kategori sekaligus
router.get("/admin/orders", authMiddleware, topupController.getAllOrders);
router.get("/admin/balance", authMiddleware, topupController.getBalance);
router.get("/status/:id", authMiddleware, topupController.checkStatus);

// Webhooks — SENGAJA tanpa authMiddleware (dipanggil server iPaymu/TokoVoucher),
// masing-masing diverifikasi keasliannya di dalam controller.
router.post("/notification", topupController.handleIpaymuNotification);
router.post("/tokovoucher-webhook", topupController.handleTokoVoucherWebhook);

module.exports = router;
