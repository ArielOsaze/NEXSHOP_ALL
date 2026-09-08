"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const migrationPath = path.join(root, "nexshop-backend", "migrations", "029_create_reseller_portal_password_reset.sql");
const migration = fs.existsSync(migrationPath) ? read("nexshop-backend", "migrations", "029_create_reseller_portal_password_reset.sql") : "";
const controller = read("nexshop-backend", "controllers", "resellerController.js");
const routes = read("nexshop-backend", "routes", "resellerRoutes.js");
const limiter = read("nexshop-backend", "middleware", "rateLimiter.js");
const portal = read("nexshop-frontend", "portal-reseller.html");
const portalCss = read("nexshop-frontend", "portal-reseller.css");
const resetUiPath = path.join(root, "nexshop-frontend", "portal-password-reset.js");
const resetUi = fs.existsSync(resetUiPath) ? read("nexshop-frontend", "portal-password-reset.js") : "";

function test(name, fn) {
    try {
        fn();
        console.log(`PASS ${name}`);
    } catch (error) {
        console.error(`FAIL ${name}: ${error.message}`);
        process.exitCode = 1;
    }
}

test("portal reset migration is dedicated and single-use", () => {
    assert.match(migration, /ALTER TABLE public\.reseller_portal_accounts/i);
    assert.match(migration, /reset_password_token/i);
    assert.match(migration, /reset_password_expires_at/i);
    assert.match(migration, /CREATE INDEX/i);
});

test("portal reset route is rate limited and public", () => {
    assert.match(limiter, /resellerForgotPasswordLimiter/);
    assert.match(routes, /\/auth\/forgot-password/);
    assert.match(routes, /resellerForgotPasswordLimiter/);
    assert.match(routes, /resellerResetPasswordLimiter/);
    assert.match(routes, /\/auth\/reset-password/);
});

test("portal reset is bound to dedicated portal account and WhatsApp security sender", () => {
    assert.match(controller, /reseller_portal_accounts/);
    assert.match(controller, /reset_password_token/);
    assert.match(controller, /sendUserSecurityWhatsApp/);
    assert.match(controller, /exports\.resellerForgotPassword/);
    assert.match(controller, /exports\.resellerResetPassword/);
    assert.match(controller, /account_scope/);
});

test("portal UI exposes forgot and reset states without inline handlers", () => {
    assert.match(portal, /id="btnPortalForgotPassword"/);
    assert.match(portal, /id="portalForgotPasswordPane"/);
    assert.match(portal, /id="portalResetPasswordPane"/);
    assert.match(portal, /portal-password-reset\.js\?v=/);
    assert.match(resetUi, /reseller\/auth\/forgot-password/);
    assert.match(resetUi, /reseller\/auth\/reset-password/);
    assert.match(resetUi, /captchaToken\("reseller-forgot"\)/);
    assert.doesNotMatch(resetUi, /onclick\s*=/i);
});

test("portal reset UI has readable responsive states", () => {
    assert.match(portalCss, /tv-portal-password-link/);
    assert.match(portalCss, /tv-portal-password-pane/);
    assert.match(portalCss, /min-width:\s*0/);
});

if (process.exitCode) process.exit(1);
console.log("PASS sim122_portal_password_reset_contract");
