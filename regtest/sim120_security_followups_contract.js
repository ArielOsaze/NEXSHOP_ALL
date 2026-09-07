"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const portal = read("nexshop-backend/controllers/resellerController.js");
const portalRoutes = read("nexshop-backend/routes/resellerRoutes.js");
const secret = read("nexshop-backend/controllers/resellerController.js");
const auth = read("nexshop-backend/middleware/authMiddleware.js");
const optionalAuth = read("nexshop-backend/middleware/optionalAuthMiddleware.js");
const walletRoutes = read("nexshop-backend/routes/walletRoutes.js");
const approvalService = read("nexshop-backend/services/adminApprovalService.js");
const approvalController = read("nexshop-backend/controllers/adminApprovalController.js");
const approvalMigration = read("nexshop-backend/migrations/028_extend_admin_approval_wallet.sql");
const pricing = read("nexshop-backend/utils/resellerPricing.js");
const api = read("nexshop-backend/controllers/resellerApiController.js");

assert.match(portal, /issuePortalSecretStepUp/);
assert.match(portal, /x-portal-step-up/);
assert.match(portalRoutes, /\/portal\/secret\/step-up/);
assert.match(secret, /portal_secret_step_up/);
assert.match(auth, /decoded\.kind === "portal_2fa_challenge"/);
assert.match(optionalAuth, /decoded\.kind === "portal_2fa_challenge"/);
assert.match(walletRoutes, /portalCheckoutAuthMiddleware/);
assert.match(walletRoutes, /admin\/adjust", authMiddleware, superAdminMiddleware/);

assert.match(approvalService, /wallet_adjustment/);
assert.match(approvalService, /APPROVAL-WALLET-\$\{request\.id\}/);
assert.match(approvalService, /\.eq\("status", "pending"\)[\s\S]*maybeSingle/);
assert.match(approvalController, /createWalletAdjustmentApproval/);
assert.match(approvalMigration, /wallet_adjustment/);

assert.match(pricing, /sellable: false/);
assert.match(pricing, /harga: null/);
assert.match(api, /REF_ID_CONFLICT/);
assert.match(api, /samePayload/);
assert.match(portal, /getPortalCatalogPage/);
assert.match(portal, /select\(PORTAL_PRODUCT_COLUMNS, \{ count: "exact" \}\)/);
assert.match(portal, /\.range\(from, to\)/);
assert.doesNotMatch(portal, /const allRows = await getCachedPortalCatalogRows\(\)/);

console.log("PASS sim120_security_followups_contract");
