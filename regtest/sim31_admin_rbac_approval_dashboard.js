"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
const auth = read("nexshop-backend/controllers/authController.js");
const notification = read("nexshop-backend/services/userNotificationHelpers.js");
const settingsRoutes = read("nexshop-backend/routes/settingsRoutes.js");
const uploadRoutes = read("nexshop-backend/routes/uploadRoutes.js");
const musicRoutes = read("nexshop-backend/routes/musicRoutes.js");
const server = read("nexshop-backend/server.js");
const dashboard = read("nexshop-frontend/admin/dashboard.html");
const dashboardJs = read("nexshop-frontend/admin/js/dashboard.js");
const approvalService = require("../nexshop-backend/services/adminApprovalService");

assert.match(notification, /Peringatan Login Admin NexShop/);
assert.match(notification, /Email:\s*`?\$\{safeEmail\}/i, "notif admin harus mencantumkan email admin");
assert.match(auth, /login_context/);
assert.match(auth, /requestedLoginContext/);
assert.match(auth, /referer/);
assert.match(auth, /request dari halaman \/admin\/login/);
assert.match(auth, /loginContext === "admin"[\s\S]{0,180}includes\(user\.role\)/);
assert.doesNotMatch(auth, /loginContext === "user"[\s\S]{0,180}includes\(user\.role\)/, "admin/staff tetap boleh login web utama");

assert.ok(fs.existsSync(path.join(root, "nexshop-backend/migrations/019_create_admin_approval_requests.sql")), "migration approval harus tersedia");
assert.ok(fs.existsSync(path.join(root, "nexshop-backend/routes/adminApprovalRoutes.js")), "route approval harus tersedia");
assert.ok(fs.existsSync(path.join(root, "nexshop-backend/controllers/adminApprovalController.js")), "controller approval harus tersedia");
assert.ok(fs.existsSync(path.join(root, "nexshop-backend/services/adminApprovalService.js")), "service approval harus tersedia");

assert.match(settingsRoutes, /superAdminMiddleware.*settingsController\.setupAdminPin|settingsController\.setupAdminPin.*superAdminMiddleware/);
assert.match(settingsRoutes, /superAdminMiddleware.*settingsController\.changeAdminPin|settingsController\.changeAdminPin.*superAdminMiddleware/);
assert.match(uploadRoutes, /sensitiveImageAuth/);
assert.match(uploadRoutes, /router\.post\("\/audio", authMiddleware, superAdminMiddleware/);
assert.match(musicRoutes, /router\.post\("\/", authMiddleware, superAdminMiddleware/);
assert.match(server, /app\.use\("\/api\/admin\/approvals", adminApprovalRoutes\)/);
assert.match(dashboard, /data-view="approvals"/);
assert.match(dashboard, /view-approvals/);
assert.match(dashboard, /sidebar-dashboard-link/);
assert.match(dashboardJs, /\/admin\/approvals/);
assert.match(dashboardJs, /submitStoreSettingsApproval|requestStoreSettingsApproval/);

const normalized = approvalService.normalizeStoreSettingsPayload({ store_name: "Toko Baru", security_pin: "[REDACTED]", api_key: "[REDACTED]" });
assert.deepStrictEqual(normalized, { store_name: "Toko Baru" }, "payload approval tidak boleh membawa secret/arbitrary field");
assert.throws(() => approvalService.normalizeStoreSettingsPayload({ security_pin: "[REDACTED]" }), /Tidak ada perubahan/);

console.log("sim31_admin_rbac_approval_dashboard: passed");
