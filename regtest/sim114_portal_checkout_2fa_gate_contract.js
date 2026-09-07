"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const route = fs.readFileSync(path.join(root, "nexshop-backend", "routes", "topupRoutes.js"), "utf8");
const middlewarePath = path.join(root, "nexshop-backend", "middleware", "portalCheckoutAuthMiddleware.js");
const middleware = fs.existsSync(middlewarePath) ? fs.readFileSync(middlewarePath, "utf8") : "";

assert.match(route, /optionalAuthMiddleware,\s*portalCheckoutAuthMiddleware,\s*topupController\.create/, "checkout harus memakai gate khusus token portal setelah optional auth");
assert.match(middleware, /resellerPortalAuthMiddleware/, "gate checkout portal harus memakai verifikasi portal yang sama");
assert.match(middleware, /auth_context\s*!==\s*["']reseller_portal["']|auth_context\s*===\s*["']reseller_portal["']/, "gate harus membedakan sesi portal dari sesi storefront");

console.log("PASS sim114_portal_checkout_2fa_gate_contract");
