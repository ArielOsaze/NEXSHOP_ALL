const express = require("express");
const router = express.Router();
const articleController = require("../controllers/newsArticleController");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");

// ─────────────────────────────────────────────────────────────────────────────
// NexShop News (editorial) — satu-satunya sistem berita yang dipakai.
//
// Sistem lama "Gaming News" (agregator link publisher, tabel `gaming_news`,
// controllers/newsController.js) sudah DIHAPUS: fungsinya digantikan penuh
// oleh editorial di bawah ini, dan mempertahankan dua sistem berita
// berdampingan cuma bikin admin bingung harus nulis di mana. Rute lamanya
// (GET/POST/PUT/PATCH/DELETE /api/news dan /api/news/all, /api/news/preview)
// sekarang balas 404 seperti endpoint tak dikenal lainnya.
//
// Kalau tabel `gaming_news` di Supabase masih ada, dia sudah tidak
// disentuh kode mana pun dan aman dihapus manual kapan saja.
// ─────────────────────────────────────────────────────────────────────────────

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
