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
router.get("/analytics", authMiddleware, adminMiddleware, aiController.getAnalytics);

// Admin Gemini AI Status, Test, & Logs Endpoints (Legacy)
router.get("/gemini-status", authMiddleware, adminMiddleware, aiController.getGeminiStatus);
router.post("/test-gemini", authMiddleware, adminMiddleware, aiController.testGeminiConnection);
router.get("/gemini-logs", authMiddleware, adminMiddleware, aiController.getGeminiLogs);

// Admin Multi-AI Provider System Endpoints
router.get("/status", authMiddleware, adminMiddleware, aiController.getAdminAiStatus);
router.get("/admin/status", authMiddleware, adminMiddleware, aiController.getAdminAiStatus);
router.get("/config", authMiddleware, adminMiddleware, aiController.getAdminAiConfig);
router.get("/admin/config", authMiddleware, adminMiddleware, aiController.getAdminAiConfig);
router.put("/config", authMiddleware, adminMiddleware, aiController.saveAdminAiConfig);
router.put("/admin/config", authMiddleware, adminMiddleware, aiController.saveAdminAiConfig);
router.post("/config", authMiddleware, adminMiddleware, aiController.saveAdminAiConfig);
router.post("/admin/config", authMiddleware, adminMiddleware, aiController.saveAdminAiConfig);
router.get("/logs", authMiddleware, adminMiddleware, aiController.getAdminAiLogs);
router.get("/admin/logs", authMiddleware, adminMiddleware, aiController.getAdminAiLogs);
router.post("/test", authMiddleware, adminMiddleware, aiController.testAdminAiProviders);
router.post("/admin/test", authMiddleware, adminMiddleware, aiController.testAdminAiProviders);
router.post("/provider", authMiddleware, adminMiddleware, aiController.updateAdminAiProvider);
router.post("/admin/provider", authMiddleware, adminMiddleware, aiController.updateAdminAiProvider);
router.post("/apikey", authMiddleware, adminMiddleware, aiController.saveAdminAiApiKey);
router.post("/admin/apikey", authMiddleware, adminMiddleware, aiController.saveAdminAiApiKey);

module.exports = router;
