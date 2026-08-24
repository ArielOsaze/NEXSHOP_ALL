"use strict";

const express = require("express");
const docsController = require("../controllers/docsController");

const router = express.Router();

router.get("/reseller.pdf", docsController.downloadResellerPdf);

module.exports = router;
