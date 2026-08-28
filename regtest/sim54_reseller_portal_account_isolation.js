const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const controller = fs.readFileSync(path.join(root, "nexshop-backend/controllers/resellerController.js"), "utf8");
const routes = fs.readFileSync(path.join(root, "nexshop-backend/routes/resellerRoutes.js"), "utf8");
const auth = fs.readFileSync(path.join(root, "nexshop-backend/controllers/authController.js"), "utf8");
const docs = fs.readFileSync(path.join(root, "nexshop-frontend/docs-reseller.html"), "utf8");
const portal = fs.readFileSync(path.join(root, "nexshop-frontend/portal-reseller.html"), "utf8");
const migration = fs.readFileSync(path.join(root, "nexshop-backend/migrations/023_create_reseller_portal_accounts.sql"), "utf8");

process.env.JWT_SECRET = "sim54-test-secret";
const jwt = require(path.join(root, "nexshop-backend/node_modules/jsonwebtoken"));
const resellerPortalAuthMiddleware = require(path.join(root, "nexshop-backend/middleware/resellerPortalAuthMiddleware.js"));

function runPortalMiddleware(payload) {
    let nextCalled = false;
    let response = null;
    const req = { headers: { authorization: `Bearer ${jwt.sign(payload, process.env.JWT_SECRET)}` } };
    const res = {
        status(code) {
            response = { status: code };
            return this;
        },
        json(body) {
            response.body = body;
            return this;
        }
    };
    resellerPortalAuthMiddleware(req, res, () => { nextCalled = true; });
    return { nextCalled, response };
}

const storefrontAttempt = runPortalMiddleware({ id: 10, email: "buyer@example.com" });
assert.strictEqual(storefrontAttempt.nextCalled, false, "storefront JWT must not pass the portal middleware");
assert.strictEqual(storefrontAttempt.response.status, 403, "storefront JWT must be rejected with HTTP 403");
assert.strictEqual(storefrontAttempt.response.body.code, "PORTAL_ACCOUNT_REQUIRED", "storefront JWT must receive the portal boundary error");
const portalAttempt = runPortalMiddleware({ id: 11, portal_account_id: "portal-uuid", auth_context: "reseller_portal" });
assert.strictEqual(portalAttempt.nextCalled, true, "dedicated portal JWT must pass the portal middleware");

assert.match(controller, /auth_context:\s*["']reseller_portal["']/, "portal JWT must carry a dedicated auth context");
assert.match(routes, /resellerPortalAuthMiddleware/, "portal routes must use the dedicated portal auth middleware");
assert.match(routes, /router\.post\("\/apply",\s*resellerPortalAuthMiddleware/, "customer JWT must not submit a reseller application");
assert.match(auth, /portal_only|account_scope/, "storefront login must reject portal-only identities");
assert.match(migration, /CREATE TABLE IF NOT EXISTS (?:public\.)?reseller_portal_accounts/i, "dedicated reseller portal account migration must exist");
assert.match(migration, /password_hash/i, "portal credentials must be stored separately from storefront password");
assert.doesNotMatch(docs, /Sudah punya akun belanja NexShop dengan email yang sama/i, "docs must not tell users to reuse the storefront account");
assert.match(docs, /berbeda dari akun belanja|akun Portal Reseller terpisah/i, "docs must require separate portal credentials");
assert.match(portal, /berbeda dari akun belanja|akun portal terpisah/i, "portal UI must explain account isolation");

console.log("PASS sim54: reseller portal account is isolated from storefront account");
