const express = require("express");
const router = express.Router();
const aiController = require("../controllers/aiController");
const optionalAuthMiddleware = require("../middleware/optionalAuthMiddleware");

// RAG AI Chat Endpoint (Publik & User Login)
router.post("/chat", optionalAuthMiddleware, aiController.chat);

module.exports = router;
