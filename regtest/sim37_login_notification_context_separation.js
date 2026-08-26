"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const helper = require(path.join(root, "nexshop-backend/services/userNotificationHelpers"));
const service = fs.readFileSync(path.join(root, "nexshop-backend/services/loginSecurityNotificationService.js"), "utf8").replace(/\r\n/g, "\n");
const auth = fs.readFileSync(path.join(root, "nexshop-backend/controllers/authController.js"), "utf8").replace(/\r\n/g, "\n");
const publicScript = fs.readFileSync(path.join(root, "nexshop-frontend/script.js"), "utf8").replace(/\r\n/g, "\n");
const adminScript = fs.readFileSync(path.join(root, "nexshop-frontend/admin/js/login.js"), "utf8").replace(/\r\n/g, "\n");

const common = {
    user: { fullname: "Ariel", email: "ariel@example.com", role: "admin" },
    timestamp: new Date("2026-08-27T00:00:00.000Z"),
    ip: "203.0.113.10",
    location: "Jakarta, Indonesia",
    userAgent: "Mozilla/5.0 Chrome/139 Windows",
    resetUrl: "https://nexshop.cloud/#/forgot-password"
};
const webMessage = helper.buildLoginSecurityMessage({ ...common, loginContext: "user" });
const dashboardMessage = helper.buildLoginSecurityMessage({ ...common, loginContext: "admin" });

assert.match(webMessage, /Peringatan Login Web Utama NexShop/);
assert.match(webMessage, /Konteks: Web utama NexShop/);
assert.doesNotMatch(webMessage, /Peringatan Login Dashboard Admin NexShop/);
assert.doesNotMatch(webMessage, /akses dashboard admin/i);
assert.match(dashboardMessage, /Peringatan Login Dashboard Admin NexShop/);
assert.match(dashboardMessage, /Konteks: Dashboard Admin NexShop/);
assert.match(dashboardMessage, /dashboard admin NexShop/i);
assert.notEqual(webMessage, dashboardMessage);

assert.match(service, /function resolveLoginContext|loginContext/);
assert.match(service, /buildLoginSecurityMessage\(\{[\s\S]*loginContext/);
assert.match(auth, /sendLoginSecurityNotification\(user, req, \{ loginContext \}\)/);
assert.match(auth, /sendLoginSecurityNotification\(outcome\.user, req, \{ loginContext:/);
assert.match(publicScript, /login_context: "user"/);
assert.match(adminScript, /login_context: "admin"/);

console.log("sim37_login_notification_context_separation: passed");
