"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
const dashboard = read("nexshop-frontend/admin/js/dashboard.js");
const dashboardHtml = read("nexshop-frontend/admin/dashboard.html");
const settingsRoutes = read("nexshop-backend/routes/settingsRoutes.js");
const userRoutes = read("nexshop-backend/routes/userRoutes.js");
const webhookRoutes = read("nexshop-backend/routes/webhookRelayRoutes.js");
const notificationRoutes = read("nexshop-backend/routes/notificationRoutes.js");
const topupRoutes = read("nexshop-backend/routes/topupRoutes.js");
const resellerRoutes = read("nexshop-backend/routes/resellerRoutes.js");
const settingsController = read("nexshop-backend/controllers/settingsController.js");

const bootStart = dashboard.indexOf("async function bootAdminGate()");
const bootEnd = dashboard.indexOf("\nfunction retryAdminGate", bootStart);
assert.ok(bootStart >= 0 && bootEnd > bootStart, "dashboard boot gate must exist");
const boot = dashboard.slice(bootStart, bootEnd);

// Staff must open after the server-returned role is checked, without any
// Security PIN setup/status/verify request.
assert.match(boot, /me\.role\s*===\s*["']staff["']/i, "boot must branch explicitly for staff");
const staffStart = boot.indexOf('me.role === "staff"');
const staffEnd = boot.indexOf("// ── Security PIN Admin", staffStart);
const staffBranch = boot.slice(staffStart, staffEnd > staffStart ? staffEnd : boot.length);
assert.ok(staffBranch, "staff boot branch must be readable");
assert.doesNotMatch(staffBranch, /getAdminPinStatus|security-pin/i, "staff boot must not call Security PIN endpoints");
assert.match(boot, /getAdminPinStatus\(\)/, "admin boot must retain Security PIN flow");
assert.match(dashboard, /async function withAdminPin\(action, purpose\)[\s\S]{0,180}currentUser\?\.role === "staff"/);
assert.match(dashboard, /STAFF_BLOCKED_VIEWS = new Set\(\["users", "waApi", "aimgmt", "musicplayer"\]\)/);
assert.match(dashboard, /SENSITIVE_SETTINGS_TABS = new Set\(\["apikeys", "authconfig", "security", "store", "mascot", "webhooks"\]\)/);
assert.match(dashboard, /function lewatiGerbangPin\(\)[\s\S]{0,220}Security PIN wajib diverifikasi/);
assert.doesNotMatch(dashboardHtml, /id="adminGateSkip"/, "dashboard must not render a PIN bypass action");

// /me is the dashboard's server-backed role source and must itself be admin-only.
assert.match(settingsRoutes, /router\.get\("\/me",\s*authMiddleware,\s*adminMiddleware,/);
assert.match(settingsRoutes, /router\.put\("\/me",\s*authMiddleware,\s*adminMiddleware,/);
assert.match(settingsController, /select\("id, fullname, email, role, created_at"\)/);

// Staff must not reach account/role management, webhook, or Security PIN APIs.
assert.match(settingsRoutes, /router\.get\("\/security-pin",\s*authMiddleware,\s*superAdminMiddleware,/);
for (const route of [
    /router\.post\("\/list",[\s\S]*?superAdminMiddleware/,
    /router\.post\("\/otp",[\s\S]*?superAdminMiddleware/,
    /router\.post\("\/:id\/detail",[\s\S]*?superAdminMiddleware/,
    /router\.post\("\/:id\/resend-otp",[\s\S]*?superAdminMiddleware/
]) assert.match(userRoutes, route);
for (const route of [
    /router\.get\("\/admin\/info",\s*authMiddleware,\s*superAdminMiddleware,/,
    /router\.get\("\/admin\/endpoints",\s*authMiddleware,\s*superAdminMiddleware,/,
    /router\.get\("\/admin\/deliveries",\s*authMiddleware,\s*superAdminMiddleware,/
]) assert.match(webhookRoutes, route);
assert.match(notificationRoutes, /authMiddleware,\s*adminMiddleware/);
assert.match(topupRoutes, /router\.get\("\/admin\/balance",\s*authMiddleware,\s*superAdminMiddleware,/);
assert.match(resellerRoutes, /router\.get\("\/admin\/kyc-document",\s*authMiddleware,\s*superAdminMiddleware,/);
assert.match(resellerRoutes, /router\.post\("\/admin\/applications\/:id\/decision",\s*authMiddleware,\s*superAdminMiddleware,/);
assert.match(resellerRoutes, /router\.put\("\/admin\/resellers\/:id",\s*authMiddleware,\s*superAdminMiddleware,/);
assert.match(resellerRoutes, /router\.put\("\/admin\/tiers\/:code",\s*authMiddleware,\s*superAdminMiddleware,/);
assert.doesNotMatch(settingsController, /\["admin",\s*"staff"\]\.includes\(req\.user\.role\)/, "API key controller must not admit staff");

// Exercise the real server guard with a stubbed read-only role lookup. No
// credentials, PINs, network calls, or mutations are used by this test.
const dbPath = require.resolve("../nexshop-backend/config/db");
require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
        from() {
            const query = {
                select() { return query; },
                eq() { return query; },
                async maybeSingle() {
                    return { data: { role: query.__role, is_blacklisted: false }, error: null };
                }
            };
            Object.defineProperty(query, "__role", {
                get() { return queryRole; }
            });
            return query;
        }
    }
};
let queryRole = "staff";
const adminGuard = require("../nexshop-backend/middleware/adminMiddleware");
const sensitiveGuard = require("../nexshop-backend/middleware/superAdminMiddleware");

function runGuard(guard, role, id) {
    queryRole = role;
    return new Promise((resolve, reject) => {
        const req = { user: { id, role }, get: () => "" };
        const res = {
            statusCode: 200,
            body: null,
            status(code) { this.statusCode = code; return this; },
            json(body) { this.body = body; resolve({ req, next: false, statusCode: this.statusCode, body }); }
        };
        guard(req, res, () => resolve({ req, next: true, statusCode: 200, body: null })).catch(reject);
    });
}

(async () => {
    const staffOps = await runGuard(adminGuard, "staff", "sim76-staff-operational");
    const staffSensitive = await runGuard(sensitiveGuard, "staff", "sim76-staff-sensitive");
    const adminSensitive = await runGuard(sensitiveGuard, "admin", "sim76-admin-sensitive");
    assert.strictEqual(staffOps.next, true, "staff may use operational admin routes");
    assert.strictEqual(staffSensitive.statusCode, 403, "staff sensitive route must return 403");
    assert.strictEqual(staffSensitive.body.code, "SUPERADMIN_REQUIRED");
    assert.strictEqual(adminSensitive.next, true, "admin may pass the role guard before PIN verification");
    assert.deepStrictEqual(require("../nexshop-backend/middleware/adminRoles").ROLE_PERMISSIONS.sensitive, ["admin"]);
    console.log("sim76_staff_dashboard_rbac: passed");
})().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
