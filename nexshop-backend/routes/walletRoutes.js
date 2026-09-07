const express = require("express");
const router = express.Router();
const walletController = require("../controllers/walletController");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const superAdminMiddleware = require("../middleware/superAdminMiddleware");
const portalCheckoutAuthMiddleware = require("../middleware/portalCheckoutAuthMiddleware");
const { walletNotificationLimiter } = require("../middleware/rateLimiter");

// Storefront/admin sessions remain valid; Portal Reseller sessions must pass
// the live 2FA gate before reading or mutating reseller wallet state.
router.get("/me", authMiddleware, portalCheckoutAuthMiddleware, walletController.getMyWallet);
router.get("/mutations", authMiddleware, portalCheckoutAuthMiddleware, walletController.getMutations);
router.post("/topup", authMiddleware, portalCheckoutAuthMiddleware, walletController.createTopup);
router.get("/topup/:id", authMiddleware, portalCheckoutAuthMiddleware, walletController.getTopupStatus);

// Webhook iPaymu untuk top up saldo (tanpa authMiddleware, verifikasi server-to-server)
router.post("/notification", walletNotificationLimiter, walletController.handleIpaymuWalletNotification);

// Admin Control Panel
router.get("/admin/wallets", authMiddleware, adminMiddleware, walletController.adminGetWallets);
router.get("/admin/ledger", authMiddleware, adminMiddleware, walletController.adminGetLedger);
router.post("/admin/adjust", authMiddleware, superAdminMiddleware, walletController.adminAdjustBalance);
router.post("/admin/refund-order", authMiddleware, superAdminMiddleware, walletController.adminRefundOrder);

module.exports = router;

