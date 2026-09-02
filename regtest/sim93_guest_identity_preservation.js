"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8").replace(/\r\n/g, "\n");
const identitySource = read("nexshop-frontend/checkout-identity.js");
const scriptSource = read("nexshop-frontend/script.js");
const marketplaceSource = read("nexshop-frontend/marketplace.html");

const fields = {
    twEmail: { value: " user@gmail.com ", required: true, readOnly: false },
    twPhone: { value: "081234567890", required: true, readOnly: false }
};
const context = {
    window: {},
    document: {
        getElementById(id) { return fields[id] || null; }
    }
};
vm.runInNewContext(identitySource, context);
const helpers = context.window.NexShopCheckoutHelpers;
assert.equal(typeof helpers.readCheckoutIdentity, "function", "pure identity reader must exist");

const before = { email: fields.twEmail.value, phone: fields.twPhone.value };
const identity = helpers.readCheckoutIdentity({ user: null, emailId: "twEmail", phoneId: "twPhone" });
assert.deepEqual({ email: fields.twEmail.value, phone: fields.twPhone.value }, before, "reading guest identity must not mutate inputs");
assert.equal(identity.authenticated, false);
assert.equal(identity.email, before.email, "reader must use the latest guest email");
assert.equal(identity.phone, before.phone, "reader must use the latest guest phone");

assert.match(scriptSource, /const\s+checkoutIdentity\s*=\s*readCheckoutIdentity\(\)/, "top-up step validation must use read-only identity");
assert.doesNotMatch(scriptSource, /const\s+checkoutIdentity\s*=\s*toggleCheckoutIdentityFields\(\)/, "top-up validation/submit must not resync and clear guest fields");
assert.match(marketplaceSource, /const\s+checkoutIdentity\s*=\s*readCheckoutIdentity\(\)/, "marketplace submit must use read-only identity");
assert.doesNotMatch(marketplaceSource, /const\s+checkoutIdentity\s*=\s*toggleCheckoutIdentityFields\(\)/, "marketplace submit must not resync and clear guest fields");

console.log("sim93_guest_identity_preservation: passed");
