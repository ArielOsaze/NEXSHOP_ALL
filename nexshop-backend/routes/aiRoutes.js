const express = require("express");
const router = express.Router();
const aiController = require("../controllers/aiController");
const optionalAuthMiddleware = require("../middleware/optionalAuthMiddleware");
const authMiddleware = require("../middleware/authMiddleware");
const superAdminMiddleware = require("../middleware/superAdminMiddleware");
const { aiChatLimiter } = require("../middleware/rateLimiter");

// RAG AI Chat Endpoint (Publik & User Login)
router.post("/chat", aiChatLimiter, optionalAuthMiddleware, aiController.chat);
router.get("/quick/:action", aiChatLimiter, optionalAuthMiddleware, aiController.quickAction);

// Admin Knowledge Base CRUD Endpoints
router.get("/knowledge", authMiddleware, superAdminMiddleware, aiController.getKnowledgeBase);
router.post("/knowledge", authMiddleware, superAdminMiddleware, aiController.createKnowledgeBase);
router.post("/knowledge/reseed", authMiddleware, superAdminMiddleware, aiController.reseedKnowledgeBase);
router.post("/faq/generate", authMiddleware, superAdminMiddleware, aiController.generateProductFaqs);
router.put("/knowledge/:id", authMiddleware, superAdminMiddleware, aiController.updateKnowledgeBase);
router.get("/analytics", authMiddleware, superAdminMiddleware, aiController.getAnalytics);

// Admin Gemini AI Status, Test, & Logs Endpoints (Legacy)
router.get("/gemini-status", authMiddleware, superAdminMiddleware, aiController.getGeminiStatus);
router.post("/test-gemini", authMiddleware, superAdminMiddleware, aiController.testGeminiConnection);
router.get("/gemini-logs", authMiddleware, superAdminMiddleware, aiController.getGeminiLogs);

// Admin Multi-AI Provider System Endpoints
router.get("/status", authMiddleware, superAdminMiddleware, aiController.getAdminAiStatus);
router.get("/admin/status", authMiddleware, superAdminMiddleware, aiController.getAdminAiStatus);
router.get("/config", authMiddleware, superAdminMiddleware, aiController.getAdminAiConfig);
router.get("/admin/config", authMiddleware, superAdminMiddleware, aiController.getAdminAiConfig);
router.put("/config", authMiddleware, superAdminMiddleware, aiController.saveAdminAiConfig);
router.put("/admin/config", authMiddleware, superAdminMiddleware, aiController.saveAdminAiConfig);
router.post("/config", authMiddleware, superAdminMiddleware, aiController.saveAdminAiConfig);
router.post("/admin/config", authMiddleware, superAdminMiddleware, aiController.saveAdminAiConfig);
router.get("/logs", authMiddleware, superAdminMiddleware, aiController.getAdminAiLogs);
router.get("/admin/logs", authMiddleware, superAdminMiddleware, aiController.getAdminAiLogs);
router.post("/test", authMiddleware, superAdminMiddleware, aiController.testAdminAiProviders);
router.post("/admin/test", authMiddleware, superAdminMiddleware, aiController.testAdminAiProviders);
router.post("/provider", authMiddleware, superAdminMiddleware, aiController.updateAdminAiProvider);
router.post("/admin/provider", authMiddleware, superAdminMiddleware, aiController.updateAdminAiProvider);
router.post("/apikey", authMiddleware, superAdminMiddleware, aiController.saveAdminAiApiKey);
router.post("/admin/apikey", authMiddleware, superAdminMiddleware, aiController.saveAdminAiApiKey);

module.exports = router;
