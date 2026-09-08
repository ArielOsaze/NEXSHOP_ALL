"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const controller = fs.readFileSync(path.join(root, "nexshop-backend", "controllers", "resellerController.js"), "utf8");
const mailer = fs.readFileSync(path.join(root, "nexshop-backend", "config", "mailer.js"), "utf8");

assert.match(controller, /sendPasswordResetEmail/, "Portal reset harus memanggil email sender");
assert.match(controller, /Promise\.allSettled/, "email dan WA harus dicoba independen");
assert.match(controller, /sendUserSecurityWhatsApp/, "Portal reset harus memanggil WA sender");
assert.match(controller, /Email.*WhatsApp|WhatsApp.*Email/i, "pesan generik harus menyebut dua channel");
assert.match(mailer, /sendPasswordResetEmail/, "mailer harus menyediakan template reset");
console.log("PASS sim124_portal_password_reset_delivery_channels");
