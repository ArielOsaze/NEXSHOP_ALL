const express = require("express");
const router = express.Router();
const newsController = require("../controllers/newsController");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");

router.get("/", newsController.getPublicNews);
router.get("/all", authMiddleware, adminMiddleware, newsController.getAllNews);
router.post("/preview", authMiddleware, adminMiddleware, newsController.previewNews);
router.post("/", authMiddleware, adminMiddleware, newsController.createNews);
router.patch("/:id", authMiddleware, adminMiddleware, newsController.updateNewsFlags);
router.put("/:id", authMiddleware, adminMiddleware, newsController.updateNews);
router.delete("/:id", authMiddleware, adminMiddleware, newsController.deleteNews);

module.exports = router;
