const express = require("express");
const router = express.Router();
const aiController = require("../controllers/aiController");
const optionalAuthMiddleware = require("../middleware/optionalAuthMiddleware");
const authMiddleware = require("../middleware/authMiddleware");

// RAG AI Chat Endpoint (Publik & User Login)
router.post("/chat", optionalAuthMiddleware, aiController.chat);

// Admin Knowledge Base CRUD Endpoints
router.get("/knowledge", authMiddleware, aiController.getKnowledgeBase);
router.post("/knowledge", authMiddleware, aiController.createKnowledgeBase);
router.put("/knowledge/:id", authMiddleware, aiController.updateKnowledgeBase);
router.delete("/knowledge/:id", authMiddleware, aiController.deleteKnowledgeBase);

module.exports = router;
