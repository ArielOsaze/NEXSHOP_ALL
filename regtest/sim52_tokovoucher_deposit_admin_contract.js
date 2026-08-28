const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const config = fs.readFileSync(path.join(root, "nexshop-backend", "config", "tokovoucher.js"), "utf8");
const controller = fs.readFileSync(path.join(root, "nexshop-backend", "controllers", "topupController.js"), "utf8");
const routes = fs.readFileSync(path.join(root, "nexshop-backend", "routes", "topupRoutes.js"), "utf8");
const html = fs.readFileSync(path.join(root, "nexshop-frontend", "admin", "dashboard.html"), "utf8");
const js = fs.readFileSync(path.join(root, "nexshop-frontend", "admin", "js", "dashboard.js"), "utf8");
const css = fs.readFileSync(path.join(root, "nexshop-frontend", "admin", "css", "style.css"), "utf8");

function assert(ok, msg) { if (!ok) throw new Error(msg); }

assert(/async function createDeposit\s*\(/.test(config), "Tokovoucher adapter must expose createDeposit");
assert(/\/v1\/deposit/.test(config), "deposit adapter must call the documented endpoint");
assert(/exports\.createDeposit\s*=/.test(controller), "admin deposit controller is missing");
assert(/\/admin\/deposit/.test(routes), "admin deposit route is missing");
assert(/superAdminMiddleware[\s\S]*requireAdminPin/.test(routes), "deposit route must be Admin-only and PIN-gated");
assert(/id=\"tvDepositModal\"/.test(html), "dashboard needs the deposit modal");
assert(/function submitTvDeposit\s*\(/.test(js), "dashboard needs the deposit submit flow");
assert(/approval-layout-2/.test(html), "dashboard CSS cache-buster must invalidate stale layout CSS");
assert(/\.app-shell\s*>\s*main\s*\{[^}]*margin-left\s*:\s*260px/s.test(css), "desktop main must reserve the fixed sidebar");

console.log("PASS sim52: TokoVoucher deposit is server-side Admin+PIN gated and dashboard layout cache is versioned");
