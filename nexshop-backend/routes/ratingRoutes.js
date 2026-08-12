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

module.exports = router;
