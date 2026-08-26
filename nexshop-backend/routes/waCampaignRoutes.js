"use strict";

const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const controller = require("../controllers/waMarketingController");

router.post("/inbound", controller.receiveInbound);
router.get("/campaigns", authMiddleware, adminMiddleware, controller.listCampaigns);
router.post("/campaigns", authMiddleware, adminMiddleware, controller.createCampaign);
router.get("/contacts", authMiddleware, adminMiddleware, controller.listContacts);
router.patch("/contacts/:id/opt-in", authMiddleware, adminMiddleware, controller.updateContactOptIn);
router.post("/run-now", authMiddleware, adminMiddleware, controller.runNow);

module.exports = router;
