"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const adminFile = fs.readFileSync(path.join(__dirname, "../nexshop-frontend/admin/js/dashboard.js"), "utf8").replace(/\r\n/g, "\n");
const publicFile = fs.readFileSync(path.join(__dirname, "../nexshop-frontend/script.js"), "utf8").replace(/\r\n/g, "\n");

assert.match(adminFile, /function requestAdminLogoutConfirmation\(\)/);
assert.match(adminFile, /logoutConfirmModal/);
assert.match(adminFile, /function logout\(\)\s*\{\s*requestAdminLogoutConfirmation\(\)\.then/);
assert.match(adminFile, /function logoutAdminNow\(\)\s*\{\s*requestAdminLogoutConfirmation\(\)\.then/);
assert.match(adminFile, /forceAdminLogout\("expired"\)/);
assert.match(publicFile, /function requestPublicLogoutConfirmation\(\)/);
assert.match(publicFile, /logoutConfirmOverlay/);
assert.match(publicFile, /document\.getElementById\("logoutBtn"\)\.addEventListener\("click", async/);
assert.doesNotMatch(publicFile, /logoutBtn[\s\S]{0,180}window\.confirm/);
assert.doesNotMatch(adminFile, /function confirmAdminLogout\(\)[\s\S]{0,120}window\.confirm/);

console.log("sim34_logout_confirmation: passed");
