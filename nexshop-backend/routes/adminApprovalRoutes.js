const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const superAdminMiddleware = require("../middleware/superAdminMiddleware");
const { requireAdminPin } = require("../middleware/adminPinMiddleware");
const controller = require("../controllers/adminApprovalController");

function staffOnly(req, res, next) {
    if (req.user?.role !== "staff") {
        return res.status(403).json({ message: "Hanya Staff yang dapat mengajukan approval." });
    }
    next();
}

router.get("/", authMiddleware, adminMiddleware, controller.list);
router.post("/", authMiddleware, adminMiddleware, staffOnly, controller.create);
router.post("/:id/approve", authMiddleware, superAdminMiddleware, requireAdminPin, controller.approve);
router.post("/:id/reject", authMiddleware, superAdminMiddleware, requireAdminPin, controller.reject);

module.exports = router;
