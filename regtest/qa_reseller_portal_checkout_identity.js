"use strict";

const assert = require("assert");
const path = require("path");
const fs = require("fs");

const dbPath = require.resolve(path.join(__dirname, "..", "nexshop-backend", "config", "db.js"));
const userProfilePath = require.resolve(path.join(__dirname, "..", "nexshop-backend", "services", "userProfileService.js"));

function queryResult(data, error = null) {
    const chain = {
        select() { return chain; },
        eq(column, value) { chain.filters = { ...(chain.filters || {}), [column]: value }; return chain; },
        neq() { return chain; },
        order() { return chain; },
        limit() { return chain; },
        maybeSingle: async () => ({ data, error })
    };
    return chain;
}

const users = new Map([
    ["portal-approved", { id: "portal-approved", fullname: "Mitra Portal", email: "portal@example.test", phone: "081234567890", phone_normalized: null, phone_verified_at: null, is_blacklisted: false, account_scope: "portal_only" }],
    ["storefront-user", { id: "storefront-user", fullname: "Customer", email: "customer@example.test", phone: "081234567891", phone_normalized: "6281234567891", phone_verified_at: "2026-08-30T00:00:00.000Z", is_blacklisted: false, account_scope: "storefront" }]
]);

const dbStub = {
    from(table) {
        if (table === "users") {
            return {
                select() { return { eq(column, value) { return queryResult(users.get(value)); } }; }
            };
        }
        if (table === "reseller_applications") {
            return {
                select() {
                    const chain = queryResult({ fullname: "Mitra Portal", whatsapp: "081234567890", status: "approved" });
                    const originalEq = chain.eq;
                    chain.eq = function (column, value) {
                        this.filters = { ...(this.filters || {}), [column]: value };
                        if (column === "status" && value !== "approved") this.maybeSingle = async () => ({ data: null, error: null });
                        return this;
                    };
                    return chain;
                }
            };
        }
        throw new Error(`unexpected table: ${table}`);
    }
};

require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: dbStub };
const profileService = require(userProfilePath);

(async () => {
    assert.strictEqual(typeof profileService.getPortalCheckoutIdentity, "function", "helper identity portal harus tersedia");

    const portal = await profileService.getPortalCheckoutIdentity("portal-approved");
    assert.strictEqual(portal.identity.email, "portal@example.test");
    assert.strictEqual(portal.identity.phone, "+6281234567890");

    const storefront = await profileService.getPortalCheckoutIdentity("storefront-user");
    assert.strictEqual(storefront.error, "PORTAL_ACCOUNT_REQUIRED");

    const source = fs.readFileSync(path.join(__dirname, "..", "nexshop-backend", "controllers", "topupController.js"), "utf8");
    assert.match(source, /getPortalCheckoutIdentity/);
    assert.match(source, /auth_context\s*===\s*["']reseller_portal["']/);
    console.log("PASS qa_reseller_portal_checkout_identity: portal memakai identity KYC approved tanpa mengubah storefront");
})().catch((error) => {
    console.error(`FAIL qa_reseller_portal_checkout_identity: ${error.message}`);
    process.exitCode = 1;
});
