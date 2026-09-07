"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const service = fs.readFileSync(path.join(root, "nexshop-backend", "services", "resellerWebhookService.js"), "utf8");
const poller = fs.readFileSync(path.join(root, "nexshop-backend", "jobs", "webhookRelayPoller.js"), "utf8");
const migration = fs.readFileSync(path.join(root, "nexshop-backend", "migrations", "026_create_reseller_webhook_deliveries.sql"), "utf8");

assert.match(service, /reseller_webhook_deliveries/);
assert.match(service, /enqueueResellerWebhook/);
assert.match(service, /schedulePatchAfterFailure/);
assert.match(service, /flushResellerWebhookDeliveries/);
assert.match(poller, /flushResellerWebhookDeliveries/);
assert.match(migration, /UNIQUE|unique/i);
assert.match(migration, /ENABLE ROW LEVEL SECURITY/i);

console.log("PASS sim117_reseller_webhook_durable_delivery_contract");
