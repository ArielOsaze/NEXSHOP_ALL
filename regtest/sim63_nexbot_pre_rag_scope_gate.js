"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const controller = fs.readFileSync(
    path.join(root, "nexshop-backend", "controllers", "aiController.js"),
    "utf8"
);

const scopeIndex = controller.indexOf("const preRagScope = isNexShopScope");
const retrieveIndex = controller.indexOf("await retrieveKnowledge(message, sessionId, user)");
assert(scopeIndex >= 0, "controller harus menghitung scope ringan sebelum RAG");
assert(retrieveIndex > scopeIndex, "retrieveKnowledge tidak boleh dipanggil sebelum pre-RAG scope gate");
assert.match(controller, /if \(!scopeEstablished\)\s*\{[\s\S]{0,900}?source:\s*["']out_of_scope["']/,
    "out-of-scope harus return sebelum retrieval dan provider");
assert.doesNotMatch(controller.slice(scopeIndex, retrieveIndex), /retrieveKnowledge\(/,
    "tidak boleh ada retrieval terselip sebelum scope gate selesai");

console.log("PASS sim63: scope gate NexBot dievaluasi sebelum memory, RAG, dan provider");
