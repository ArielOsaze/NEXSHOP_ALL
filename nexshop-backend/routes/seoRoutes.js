"use strict";

const express = require("express");
const seoController = require("../controllers/seoController");

const router = express.Router();

router.get("/thumbnail", seoController.thumbnail);

module.exports = router;
