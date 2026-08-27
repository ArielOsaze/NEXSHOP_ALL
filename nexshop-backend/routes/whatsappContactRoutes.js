const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const superAdminMiddleware = require("../middleware/superAdminMiddleware");
const controller = require("../controllers/whatsappContactController");

const router = express.Router();

// Data kontak adalah PII dan hanya tersedia untuk Admin utama.
router.get("/export.vcf", authMiddleware, superAdminMiddleware, controller.exportVCard);
router.get("/", authMiddleware, superAdminMiddleware, controller.getContacts);

module.exports = router;
