"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const auth = fs.readFileSync(path.join(root, "nexshop-backend/controllers/authController.js"), "utf8").replace(/\r\n/g, "\n");
const script = fs.readFileSync(path.join(root, "nexshop-frontend/script.js"), "utf8").replace(/\r\n/g, "\n");
const index = fs.readFileSync(path.join(root, "nexshop-frontend/index.html"), "utf8").replace(/\r\n/g, "\n");

assert.match(auth, /if \(loginContext === "admin" && !\["admin", "staff"\]\.includes\(user\.role\)\)/);
assert.doesNotMatch(auth, /if \(loginContext === "user" && \["admin", "staff"\]\.includes\(user\.role\)\)/, "admin/staff harus boleh login web utama");
assert.match(script, /body: JSON\.stringify\(\{ email, password, captcha_token, login_context: "user" \}\)/);
assert.match(script, /function getToastContainer\(\)/);
assert.match(script, /document\.body\.appendChild\(container\)/);
assert.doesNotMatch(index, /id="toastContainer"/, "test memastikan fallback dynamic container tetap dibutuhkan");

console.log("sim35_admin_public_login_and_toast_guard: passed");
