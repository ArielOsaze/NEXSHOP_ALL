const express = require("express");
const router = express.Router();
const walletController = require("../controllers/walletController");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");

// Autentikasi User
router.get("/me", authMiddleware, walletController.getMyWallet);
router.get("/mutations", authMiddleware, walletController.getMutations);
router.post("/topup", authMiddleware, walletController.createTopup);
router.get("/topup/:id", authMiddleware, walletController.getTopupStatus);

// Webhook iPaymu untuk top up saldo (tanpa authMiddleware, verifikasi server-to-server)
router.post("/notification", walletController.handleIpaymuWalletNotification);

// Admin Control Panel
router.get("/admin/wallets", authMiddleware, adminMiddleware, walletController.adminGetWallets);
router.get("/admin/ledger", authMiddleware, adminMiddleware, walletController.adminGetLedger);
router.post("/admin/adjust", authMiddleware, adminMiddleware, walletController.adminAdjustBalance);
router.post("/admin/refund-order", authMiddleware, adminMiddleware, walletController.adminRefundOrder);

module.exports = router;

