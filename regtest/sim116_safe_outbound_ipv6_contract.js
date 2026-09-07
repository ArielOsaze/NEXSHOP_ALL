"use strict";

const assert = require("assert");
const { validateWebhookUrlShape } = require("../nexshop-backend/utils/safeOutboundUrl");

for (const url of [
    "https://[::ffff:7f00:1]/hook",
    "https://[::ffff:a00:1]/hook",
    "https://[::ffff:c000:201]/hook",
    "https://[febf::1]/hook"
]) {
    assert.strictEqual(validateWebhookUrlShape(url).ok, false, `private IPv6 form harus ditolak: ${url}`);
}

assert.strictEqual(validateWebhookUrlShape("https://example.com/hook").ok, true);
console.log("PASS sim116_safe_outbound_ipv6_contract");
