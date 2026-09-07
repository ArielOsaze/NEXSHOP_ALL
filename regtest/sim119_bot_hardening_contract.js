"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const limiter = read("nexshop-backend/middleware/rateLimiter.js");
const authRoutes = read("nexshop-backend/routes/authRoutes.js");
const resellerApiRoutes = read("nexshop-backend/routes/resellerApiRoutes.js");
const topupRoutes = read("nexshop-backend/routes/topupRoutes.js");
const orderRoutes = read("nexshop-backend/routes/orderRoutes.js");
const runtimeConfig = read("nexshop-backend/services/runtimeConfigService.js");
const musicController = read("nexshop-backend/controllers/musicController.js");

assert.match(limiter, /const loginAccountLimiter = rateLimit/);
assert.match(limiter, /const forgotPasswordAccountLimiter = rateLimit/);
assert.match(limiter, /const resellerApiIpLimiter = rateLimit/);
assert.match(limiter, /identityBucket\(key\)/);
assert.doesNotMatch(limiter, /String\(key\)\.slice\(/);
assert.doesNotMatch(limiter, /auth\.slice\(7,\s*71\)/);

assert.match(authRoutes, /loginLimiter, loginAccountLimiter, adminLoginLimiter/);
assert.match(authRoutes, /forgotPasswordLimiter, forgotPasswordAccountLimiter/);
assert.match(resellerApiRoutes, /router\.use\(resellerApiIpLimiter\);[\s\S]*router\.use\(resellerApiLimiter\);/);
assert.match(topupRoutes, /publicCatalogLimiter/);
assert.match(topupRoutes, /promoValidationLimiter/);
assert.match(topupRoutes, /checkoutLimiter/);
assert.match(topupRoutes, /providerWebhookLimiter/);
assert.match(orderRoutes, /providerWebhookLimiter/);

assert.match(runtimeConfig, /if \(runtimeConfigCache\.data\) return runtimeConfigCache\.data/);
assert.match(musicController, /PUBLIC_MUSIC_CACHE_TTL_MS/);
assert.match(musicController, /serveCachedPublicMusic\(res, \{ stale: true \}\)/);

console.log("PASS sim119_bot_hardening_contract");
