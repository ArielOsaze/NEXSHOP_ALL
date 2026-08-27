const express = require("express");
const router = express.Router();
const topupController = require("../controllers/topupController");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const optionalAuthMiddleware = require("../middleware/optionalAuthMiddleware");

const { checkNicknameLimiter, inquiryLimiter } = require("../middleware/rateLimiter");

// Publik

// Public Full Catalog for One Stop Solution
// optionalAuth: guest lihat harga normal, reseller yang login langsung
// lihat harga resellernya (dihitung di server, lihat resellerService).
// --- Etalase bertahap (lazy load) + pencarian sisi server ---
// Tiga route ini menggantikan pola "tarik seluruh katalog sekali jalan".
// Kartu dikirim per halaman, dan pencariannya dijalankan server atas SELURUH
// indeks katalog -- jadi produk yang kartunya belum termuat tetap ketemu.
router.get("/catalog/games", optionalAuthMiddleware, topupController.getCatalogGames);
router.get("/catalog/operators", optionalAuthMiddleware, topupController.getCatalogOperators);
router.get("/catalog/group/:jenis/:id/products", optionalAuthMiddleware, topupController.getCatalogGroupProducts);

// Endpoint lama tetap ada supaya integrasi/halaman yang belum dimigrasi
// tidak rusak mendadak.
router.get("/public-catalog", optionalAuthMiddleware, topupController.getPublicCatalog);

router.get("/products", optionalAuthMiddleware, topupController.getProducts);
router.post("/check-nickname", checkNicknameLimiter, topupController.checkNicknameHandler); // publik — cek akun sebelum checkout
router.post("/validate-promo", topupController.validatePromo); // publik — tombol "Terapkan" kode promo di halaman topup
// Publik tapi di-rate-limit KETAT: tiap cek tagihan motong saldo TokoVoucher
// kita, walaupun customer-nya gak jadi bayar.
router.post("/inquiry-pascabayar", inquiryLimiter, topupController.inquiryPascabayarHandler); // publik — tombol "Cek Tagihan" di checkout Marketplace

// Checkout — boleh guest atau login, sama seperti /api/orders
router.post("/", optionalAuthMiddleware, topupController.create);

// User
router.get("/my", authMiddleware, topupController.getMyOrders);
router.get("/public-status/:id", topupController.getPublicStatus); // publik — buat halaman kembali dari pembayaran
router.get("/track/:id", topupController.getPublicDetail); // publik — buat tab "Cek Transaksi"

// Admin
router.get("/admin/products", authMiddleware, adminMiddleware, topupController.getAllProductsAdmin);
router.get("/admin/sync", authMiddleware, adminMiddleware, topupController.syncProducts);
router.put("/admin/products/bulk-status", authMiddleware, adminMiddleware, topupController.bulkUpdateStatus); // aktif/nonaktif massal
router.put("/admin/products/bulk-server-id", authMiddleware, adminMiddleware, topupController.bulkUpdateButuhServerId); // toggle "butuh server id" massal
router.put("/admin/products/bulk-icon", authMiddleware, adminMiddleware, topupController.bulkUpdateIcon); // set icon massal (produk terpilih)
router.put("/admin/products/bulk-markup", authMiddleware, adminMiddleware, topupController.bulkMarkupPrice); // hitung ulang harga jual dari harga modal (markup %/nominal)
router.put("/admin/products/auto-markup", authMiddleware, adminMiddleware, topupController.autoMarkupPrice); // markup otomatis "wajar" (persen dari MARKUP_TIERS utk kategori biasa, admin flat khusus E-Wallet -- lihat hitungMarkupWajar di topupHelpers.js, gak perlu input manual)
router.put("/admin/products/smart-activate", authMiddleware, adminMiddleware, topupController.smartActivateProducts); // aktivasi cerdas: pilih varian termurah per nominal diamond + nonaktifin nominal yg gak/jarang laku
router.put("/admin/products/bulk-kategori", authMiddleware, adminMiddleware, topupController.bulkUpdateKategori); // pindah kategori massal (produk terpilih)
router.put("/admin/products/kategori-status", authMiddleware, adminMiddleware, topupController.setKategoriActive); // toggle satu kategori/game sekaligus
router.put("/admin/products/:id", authMiddleware, adminMiddleware, topupController.updateProduct);
router.delete("/admin/products/bulk", authMiddleware, adminMiddleware, topupController.bulkDeleteProducts); // hapus produk terpilih (checkbox)
router.post("/admin/products/undo", authMiddleware, adminMiddleware, topupController.undoLastAction); // undo aksi bulk paling baru
router.post("/admin/products/redo", authMiddleware, adminMiddleware, topupController.redoLastAction); // redo aksi yang paling terakhir di-undo
router.get("/admin/products/history-status", authMiddleware, adminMiddleware, topupController.getActionHistoryStatus); // status tombol undo/redo
router.delete("/admin/products/:id", authMiddleware, adminMiddleware, topupController.deleteProduct);
router.delete("/admin/products", authMiddleware, adminMiddleware, topupController.deleteAllProducts); // hapus semua (opsional ?kategori=...)
router.put("/admin/category-logo", authMiddleware, adminMiddleware, topupController.updateCategoryLogo); // set logo game utk 1 kategori sekaligus
router.get("/admin/orders", authMiddleware, adminMiddleware, topupController.getAllOrders);
router.post("/admin/orders/:id/actions", authMiddleware, adminMiddleware, topupController.adminOrderAction);
router.get("/admin/balance", authMiddleware, adminMiddleware, topupController.getBalance);
router.post("/admin/sync-full", authMiddleware, adminMiddleware, topupController.syncFullCatalog);
router.get("/admin/sync-status", authMiddleware, adminMiddleware, topupController.getSyncStatus);
router.get("/admin/catalog-summary", authMiddleware, adminMiddleware, topupController.getCatalogSummary);
router.get("/admin/category-map", authMiddleware, adminMiddleware, topupController.getCategoryMap);
router.put("/admin/category-map", authMiddleware, adminMiddleware, topupController.updateCategoryMap);
router.post("/admin/toggle-operator", authMiddleware, adminMiddleware, topupController.toggleOperator);
router.post("/admin/products/apply-filter", authMiddleware, adminMiddleware, topupController.applyToFilter); // terapin aksi ke semua produk yang cocok filter (tanpa centang manual)
router.get("/status/:id", authMiddleware, adminMiddleware, topupController.checkStatus);

// Webhooks — SENGAJA tanpa authMiddleware (dipanggil server iPaymu/TokoVoucher),
// masing-masing diverifikasi keasliannya di dalam controller.
router.post("/notification", topupController.handleIpaymuNotification);
router.post("/tokovoucher-webhook", topupController.handleTokoVoucherWebhook);

module.exports = router;
