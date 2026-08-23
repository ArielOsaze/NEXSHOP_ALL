const express = require("express");
const router = express.Router();
const resellerApiController = require("../controllers/resellerApiController");
const { apiKeyAuthMiddleware } = require("../middleware/apiKeyAuthMiddleware");
const { resellerApiLimiter } = require("../middleware/rateLimiter");

// Semua route Open API v1 reseller diproteksi oleh apiKeyAuthMiddleware
// (Mendukung Header X-NexShop-Api-Key / X-RESELLER-KEY + Secret, IP Whitelist, dan Status APPROVED)
// Limiter DIPASANG SEBELUM autentikasi supaya percobaan tebak API Key
// pun ikut kena batas -- kalau dipasang setelahnya, request yang gagal
// auth tidak pernah terhitung dan brute-force jadi gratis.
router.use(resellerApiLimiter);
router.use(apiKeyAuthMiddleware);

router.post("/orders", resellerApiController.createOrder);
router.get("/orders/:id", resellerApiController.getOrderStatus);
router.get("/balance", resellerApiController.getBalance);
router.get("/products", resellerApiController.getProducts);
router.post("/check-nickname", resellerApiController.checkNickname);

module.exports = router;
