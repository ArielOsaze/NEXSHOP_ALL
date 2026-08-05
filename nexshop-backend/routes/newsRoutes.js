const express = require("express");
const router = express.Router();
const newsController = require("../controllers/newsController");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const rateLimit = require("express-rate-limit");

const newsPreviewLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Terlalu banyak preview artikel. Coba lagi beberapa menit." }
});

router.get("/", newsController.getPublicNews);
router.get("/all", authMiddleware, adminMiddleware, newsController.getAllNews);
router.post("/preview", authMiddleware, adminMiddleware, newsPreviewLimiter, newsController.previewNews);
router.post("/", authMiddleware, adminMiddleware, newsController.createNews);
router.patch("/bulk", authMiddleware, adminMiddleware, newsController.bulkUpdateNews);
router.patch("/:id", authMiddleware, adminMiddleware, newsController.updateNewsFlags);
router.put("/:id", authMiddleware, adminMiddleware, newsController.updateNews);
router.delete("/:id", authMiddleware, adminMiddleware, newsController.deleteNews);

module.exports = router;
