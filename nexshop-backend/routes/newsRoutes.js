const express = require("express");
const router = express.Router();
const newsController = require("../controllers/newsController");
const articleController = require("../controllers/newsArticleController");
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

// ─────────────────────────────────────────────────────────────────────────────
// LEGACY Gaming News (aggregator) — JANGAN DIUBAH / DIHAPUS
// ─────────────────────────────────────────────────────────────────────────────
router.get("/",        newsController.getPublicNews);
router.get("/all",     authMiddleware, adminMiddleware, newsController.getAllNews);
router.post("/preview",authMiddleware, adminMiddleware, newsPreviewLimiter, newsController.previewNews);
router.post("/",       authMiddleware, adminMiddleware, newsController.createNews);
router.patch("/bulk",  authMiddleware, adminMiddleware, newsController.bulkUpdateNews);
router.patch("/:id",   authMiddleware, adminMiddleware, newsController.updateNewsFlags);
router.put("/:id",     authMiddleware, adminMiddleware, newsController.updateNews);
router.delete("/:id",  authMiddleware, adminMiddleware, newsController.deleteNews);

// ─────────────────────────────────────────────────────────────────────────────
// EDITORIAL Articles — NexShop News System
// Public endpoints (tidak butuh auth)
// ─────────────────────────────────────────────────────────────────────────────
router.get("/articles",      articleController.getPublicArticles);
router.get("/articles/:slug", articleController.getPublicArticleBySlug);

// ─────────────────────────────────────────────────────────────────────────────
// EDITORIAL Articles — Admin endpoints (butuh auth + admin role)
// ─────────────────────────────────────────────────────────────────────────────
// Bulk action — HARUS sebelum /:id agar "bulk" tidak ditafsir sebagai ID
router.patch("/admin/articles/bulk",                    authMiddleware, adminMiddleware, articleController.bulkArticleAction);

router.get("/admin/articles",                           authMiddleware, adminMiddleware, articleController.getAllArticles);
router.post("/admin/articles",                          authMiddleware, adminMiddleware, articleController.createArticle);
router.get("/admin/articles/:id",                       authMiddleware, adminMiddleware, articleController.getArticleById);
router.put("/admin/articles/:id",                       authMiddleware, adminMiddleware, articleController.updateArticle);
router.delete("/admin/articles/:id",                    authMiddleware, adminMiddleware, articleController.deleteArticle);
router.patch("/admin/articles/:id/publish",             authMiddleware, adminMiddleware, articleController.publishArticle);
router.patch("/admin/articles/:id/unpublish",           authMiddleware, adminMiddleware, articleController.unpublishArticle);
router.patch("/admin/articles/:id/schedule",            authMiddleware, adminMiddleware, articleController.scheduleArticle);

// Sources
router.get("/admin/articles/:id/sources",               authMiddleware, adminMiddleware, articleController.getArticleSources);
router.post("/admin/articles/:id/sources",              authMiddleware, adminMiddleware, articleController.addArticleSource);
router.delete("/admin/articles/:id/sources/:sid",       authMiddleware, adminMiddleware, articleController.deleteArticleSource);

module.exports = router;
