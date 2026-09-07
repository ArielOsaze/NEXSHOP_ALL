"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const runtimeConfig = read("nexshop-backend/services/runtimeConfigService.js");
const music = read("nexshop-backend/controllers/musicController.js");
const authSecurity = read("nexshop-frontend/auth-security.js");
const homepage = read("nexshop-frontend/script.js");
const resellerCss = read("nexshop-frontend/reseller.css");

assert.match(runtimeConfig, /RUNTIME_CONFIG_QUERY_TIMEOUT_MS/,
    "runtime config public harus memiliki batas waktu query");
assert.match(runtimeConfig, /FALLBACK_CACHE_TTL_MS = 5 \* 1000/,
    "fallback runtime config tidak boleh mengunci Turnstile terlalu lama");
assert.match(runtimeConfig, /runtimeConfigRequest/,
    "runtime config harus mendeduplikasi query bersamaan");
assert.match(music, /PUBLIC_MUSIC_QUERY_TIMEOUT_MS/,
    "public music harus memiliki batas waktu query");
assert.match(music, /PUBLIC_MUSIC_CACHE_FILE/,
    "public music harus mempertahankan cache lintas restart");
assert.match(music, /serveCachedPublicMusic\(res, \{ stale: true \}\)/,
    "public music harus mengembalikan stale cache saat upstream bermasalah");
assert.match(authSecurity, /const turnstilePromise = loadTurnstile\(\)/,
    "Turnstile script dan public config harus dimulai paralel");
assert.match(homepage, /MUSIC_REQUEST_TIMEOUT_MS/,
    "homepage music harus memiliki batas waktu request");
assert.match(homepage, /new AbortController\(\)/,
    "homepage music harus membatalkan request yang menggantung");
assert.match(resellerCss, /rs-universe-node-voucher \{ top: 50%; right: auto; bottom: auto;/,
    "Voucher tidak boleh di-stretch oleh bottom positioning lama");
assert.match(resellerCss, /@keyframes rs-card-liveness/,
    "node card harus memiliki animasi liveness pengganti");
assert.match(resellerCss, /rs-universe-stage\.rs-universe-in-viewport \.rs-universe-node/,
    "animasi Universe harus aktif ketika stage terlihat");
assert.match(resellerCss, /prefers-reduced-motion: reduce[\s\S]*rs-card-liveness/s,
    "animasi pengganti harus menghormati reduced motion");

const originalLoad = Module._load;
const hangingQuery = {
    select() { return this; },
    eq() { return this; },
    maybeSingle() { return new Promise(() => {}); }
};
Module._load = function (request, parent, isMain) {
    if (request === "../config/db") return { from: () => hangingQuery };
    return originalLoad.call(this, request, parent, isMain);
};

(async () => {
    try {
        delete require.cache[require.resolve(path.join(root, "nexshop-backend/services/runtimeConfigService.js"))];
        const runtimeService = require(path.join(root, "nexshop-backend/services/runtimeConfigService.js"));
        const runtimeStart = Date.now();
        const runtime = await runtimeService.getRuntimeConfig();
        const runtimeElapsed = Date.now() - runtimeStart;
        assert(runtimeElapsed < 5000, `runtime config timeout terlalu lama: ${runtimeElapsed}ms`);
        assert(runtime && typeof runtime === "object", "runtime config fallback tidak valid");

        delete require.cache[require.resolve(path.join(root, "nexshop-backend/controllers/musicController.js"))];
        const musicController = require(path.join(root, "nexshop-backend/controllers/musicController.js"));
        const response = {
            statusCode: 200,
            headers: {},
            setHeader(key, value) { this.headers[key] = value; },
            status(code) { this.statusCode = code; return this; },
            json(body) { this.body = body; return this; }
        };
        const musicStart = Date.now();
        await musicController.getPublicMusic({}, response);
        const musicElapsed = Date.now() - musicStart;
        assert(musicElapsed < 5000, `music query timeout terlalu lama: ${musicElapsed}ms`);
        assert(response.statusCode === 503, `music timeout harus 503, dapat ${response.statusCode}`);
        console.log(`PASS sim121_public_resilience_and_reseller_visual_contract runtime=${runtimeElapsed}ms music=${musicElapsed}ms`);
    } finally {
        Module._load = originalLoad;
    }
})().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
