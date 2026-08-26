const assert = require("assert");
const fs = require("fs");
const source = fs.readFileSync(require.resolve("../nexshop-frontend/script.js"), "utf8").replace(/\r\n/g, "\n");

const hasPhoneStart = source.indexOf("function hasVerifiedPhone");
const hasPhoneEnd = source.indexOf("// Backend menyimpan nomor HP", hasPhoneStart);
const hasPhone = source.slice(hasPhoneStart, hasPhoneEnd);
assert.match(hasPhone, /has_verified_phone/);
assert.match(hasPhone, /phone_verified_at/);
assert.match(hasPhone, /phone_normalized/);

const bootstrapStart = source.indexOf("async function bootstrapApp()");
const bootstrapEnd = source.indexOf("function startApp()", bootstrapStart);
const bootstrap = source.slice(bootstrapStart, bootstrapEnd);
assert.match(bootstrap, /const refreshedUser = await refreshCurrentUserProfile\(\)/);
assert.match(bootstrap, /if \(refreshedUser && currentUser && !hasVerifiedPhone\(currentUser\)\)/);

console.log("sim26_phone_verification_refresh: passed");
