const express = require("express");
const router = express.Router();
const ratingController = require("../controllers/ratingController");
const authMiddleware = require("../middleware/authMiddleware");
const optionalAuthMiddleware = require("../middleware/optionalAuthMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");

router.get("/eligibility/:orderId", optionalAuthMiddleware, ratingController.checkEligibility);
router.post("/", optionalAuthMiddleware, ratingController.submitRating);
router.get("/admin", authMiddleware, adminMiddleware, ratingController.getAdminRatings);
router.get("/admin/summary", authMiddleware, adminMiddleware, ratingController.getAdminRatingSummary);

// FEATURE: rating untuk topup (lihat komentar di ratingController.js) --
// endpoint terpisah karena topup_orders/topup_ratings adalah tabel berbeda
// dari orders/order_ratings.
router.get("/topup/eligibility/:orderId", optionalAuthMiddleware, ratingController.checkTopupEligibility);
router.post("/topup", optionalAuthMiddleware, ratingController.submitTopupRating);

// FEATURE: testimoni publik untuk section "Apa Kata Mereka" di homepage --
// sengaja TIDAK pakai middleware auth apa pun, endpoint ini publik.
router.get("/public/testimonials", ratingController.getPublicTestimonials);

// FEATURE: CRUD testimoni kustom (Admin Dashboard) -- lihat komentar di
// ratingController.js. Semua route di bawah wajib admin.
router.get("/admin/custom", authMiddleware, adminMiddleware, ratingController.getAdminCustomTestimonials);
router.post("/admin/custom", authMiddleware, adminMiddleware, ratingController.createCustomTestimonial);
router.put("/admin/custom/:id", authMiddleware, adminMiddleware, ratingController.updateCustomTestimonial);
router.delete("/admin/custom/:id", authMiddleware, adminMiddleware, ratingController.deleteCustomTestimonial);

module.exports = router;
