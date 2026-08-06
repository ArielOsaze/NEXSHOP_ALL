const express = require("express");
const router = express.Router();
const aiController = require("../controllers/aiController");
const optionalAuthMiddleware = require("../middleware/optionalAuthMiddleware");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const { aiChatLimiter } = require("../middleware/rateLimiter");

// RAG AI Chat Endpoint (Publik & User Login)
router.post("/chat", aiChatLimiter, optionalAuthMiddleware, aiController.chat);
router.get("/quick/:action", aiChatLimiter, optionalAuthMiddleware, aiController.quickAction);

// Admin Knowledge Base CRUD Endpoints
router.get("/knowledge", authMiddleware, adminMiddleware, aiController.getKnowledgeBase);
router.post("/knowledge", authMiddleware, adminMiddleware, aiController.createKnowledgeBase);
router.post("/knowledge/reseed", authMiddleware, adminMiddleware, aiController.reseedKnowledgeBase);
router.post("/faq/generate", authMiddleware, adminMiddleware, aiController.generateProductFaqs);
router.put("/knowledge/:id", authMiddleware, adminMiddleware, aiController.updateKnowledgeBase);
router.delete("/knowledge/:id", authMiddleware, adminMiddleware, aiController.deleteKnowledgeBase);
router.get("/analytics", authMiddleware, adminMiddleware, aiController.getAnalytics);

module.exports = router;
