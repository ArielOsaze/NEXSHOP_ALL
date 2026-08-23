const express = require("express");
const router = express.Router();
const resellerController = require("../controllers/resellerController");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const {
    resellerApplyLimiter,
    resellerLoginLimiter,
    resellerWebhookTestLimiter
} = require("../middleware/rateLimiter");

// Publik — autentikasi mandiri khusus mitra reseller
router.post("/auth/register", resellerApplyLimiter, resellerController.resellerRegister);
// Login Partner Portal sekarang ikut dibatasi lajunya. Sebelumnya endpoint
// ini sama sekali tanpa limiter, jadi password akun mitra bisa di-brute-force
// tanpa batas padahal akun itu memegang saldo deposit.
router.post("/auth/login", resellerLoginLimiter, resellerController.resellerLogin);

// Publik — dipakai halaman info reseller buat nampilin tabel tingkatan
router.get("/tiers", resellerController.getPublicTiers);

// User yang sudah login
router.get("/me", authMiddleware, resellerController.getMyResellerStatus);
router.post("/apply", authMiddleware, resellerApplyLimiter, resellerController.applyReseller);

// Partner Portal — Reseller Aktif
router.get("/portal/overview", authMiddleware, resellerController.getPortalOverview);
router.get("/portal/secret", authMiddleware, resellerController.revealSecretKey);
router.post("/portal/api-key/generate", authMiddleware, resellerController.generateOrRotateApiKey);
router.put("/portal/settings", authMiddleware, resellerController.updatePortalSettings);
router.get("/portal/products", authMiddleware, resellerController.getPortalProducts);
router.get("/portal/orders", authMiddleware, resellerController.getPortalOrders);
// Unduhan rincian harga per level reseller (CSV siap-Excel atau JSON).
// Harga dihitung di server memakai hitungHargaReseller() yang sama dengan
// checkout, jadi isi file tidak pernah berbeda dari harga yang ditagih.
router.get("/portal/price-list", authMiddleware, resellerController.getResellerPriceList);
router.post("/portal/test-webhook", authMiddleware, resellerWebhookTestLimiter, resellerController.testPortalWebhook);

// Admin & staff
// Foto KTP hanya bisa dilihat lewat endpoint ini (didekripsi on-the-fly,
// tidak pernah punya URL publik). Lihat getKycDocument().
router.get("/admin/kyc-document", authMiddleware, adminMiddleware, resellerController.getKycDocument);
router.get("/admin/applications", authMiddleware, adminMiddleware, resellerController.listApplications);
router.post("/admin/applications/:id/decision", authMiddleware, adminMiddleware, resellerController.decideApplication);
router.get("/admin/resellers", authMiddleware, adminMiddleware, resellerController.listResellers);
router.put("/admin/resellers/:id", authMiddleware, adminMiddleware, resellerController.updateResellerUser);
router.get("/admin/tiers", authMiddleware, adminMiddleware, resellerController.listTiersAdmin);
router.put("/admin/tiers/:code", authMiddleware, adminMiddleware, resellerController.updateTier);

module.exports = router;
