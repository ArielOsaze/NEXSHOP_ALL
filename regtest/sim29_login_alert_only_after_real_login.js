const assert = require("assert");
const fs = require("fs");
const auth = fs.readFileSync(require.resolve("../nexshop-backend/controllers/authController.js"), "utf8").replace(/\r\n/g, "\n");

const loginStart = auth.indexOf("exports.login =");
const googleStart = auth.indexOf("exports.googleCallback =");
const login = auth.slice(loginStart, googleStart);
const google = auth.slice(googleStart, auth.indexOf("exports.googleExchange =", googleStart));

assert.match(login, /const session = issueUserSession\(user\);[\s\S]*res\.json\(\{ message: "Login berhasil"/);
assert.match(login, /res\.json\(\{ message: "Login berhasil"[\s\S]*sendLoginSecurityNotification\(user, req\)/);
assert.match(google, /if \(state\.action === "login"\) \{[\s\S]*sendLoginSecurityNotification\(outcome\.user, req\)/);
assert.doesNotMatch(google, /if \(state\.action === "link"\)[\s\S]*sendLoginSecurityNotification/);

console.log("sim29_login_alert_only_after_real_login: passed");
