const express = require("express");
const router = express.Router();
const resellerController = require("../controllers/resellerController");
const authMiddleware = require("../middleware/authMiddleware");
const resellerPortalAuthMiddleware = require("../middleware/resellerPortalAuthMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const {
    resellerApplyLimiter,
    resellerLoginLimiter,
    resellerTwoFactorVerifyLimiter,
    resellerWebhookTestLimiter
} = require("../middleware/rateLimiter");

// Publik — autentikasi mandiri khusus mitra reseller
router.post("/auth/register", resellerApplyLimiter, resellerController.resellerRegister);
// Login Partner Portal sekarang ikut dibatasi lajunya. Sebelumnya endpoint
// ini sama sekali tanpa limiter, jadi password akun mitra bisa di-brute-force
// tanpa batas padahal akun itu memegang saldo deposit.
router.post("/auth/login", resellerLoginLimiter, resellerController.resellerLogin);
router.post("/auth/2fa/verify", resellerTwoFactorVerifyLimiter, resellerController.verifyResellerTwoFactor);

// Publik — dipakai halaman info reseller buat nampilin tabel tingkatan
router.get("/tiers", resellerController.getPublicTiers);

// Endpoint status/pengajuan Portal Reseller wajib memakai identity portal.
// JWT customer dari toko utama tidak diterima di boundary ini.
router.get("/me", resellerPortalAuthMiddleware, resellerController.getMyResellerStatus);
router.post("/apply", resellerPortalAuthMiddleware, resellerApplyLimiter, resellerController.applyReseller);

// Partner Portal — identity reseller terpisah dari storefront
router.get("/portal/overview", resellerPortalAuthMiddleware, resellerController.getPortalOverview);
router.get("/portal/2fa/status", resellerPortalAuthMiddleware, resellerController.getResellerTwoFactorStatus);
router.post("/portal/2fa/setup", resellerPortalAuthMiddleware, resellerController.setupResellerTwoFactor);
router.post("/portal/2fa/enable", resellerPortalAuthMiddleware, resellerController.enableResellerTwoFactor);
router.post("/portal/2fa/disable", resellerPortalAuthMiddleware, resellerController.disableResellerTwoFactor);
router.get("/portal/secret", resellerPortalAuthMiddleware, resellerController.revealSecretKey);
router.post("/portal/api-key/generate", resellerPortalAuthMiddleware, resellerController.generateOrRotateApiKey);
router.put("/portal/settings", resellerPortalAuthMiddleware, resellerController.updatePortalSettings);
router.get("/portal/products", resellerPortalAuthMiddleware, resellerController.getPortalProducts);
router.get("/portal/orders", resellerPortalAuthMiddleware, resellerController.getPortalOrders);
// Unduhan rincian harga per level reseller (CSV siap-Excel atau JSON).
// Harga dihitung di server memakai hitungHargaReseller() yang sama dengan
// checkout, jadi isi file tidak pernah berbeda dari harga yang ditagih.
router.get("/portal/price-list", resellerPortalAuthMiddleware, resellerController.getResellerPriceList);
router.post("/portal/test-webhook", resellerPortalAuthMiddleware, resellerWebhookTestLimiter, resellerController.testPortalWebhook);

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
