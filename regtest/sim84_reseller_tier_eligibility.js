const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const service = fs.readFileSync(path.join(root, "nexshop-backend", "services", "resellerService.js"), "utf8");
const controller = fs.readFileSync(path.join(root, "nexshop-backend", "controllers", "resellerController.js"), "utf8");
const publicHtml = fs.readFileSync(path.join(root, "nexshop-frontend", "reseller.html"), "utf8");
const adminJs = fs.readFileSync(path.join(root, "nexshop-frontend", "admin", "js", "reseller.js"), "utf8");

const goldRule = service.match(/gold:[\s\S]{0,400}/i)?.[0] || "";
const platinumRule = service.match(/platinum:[\s\S]{0,400}/i)?.[0] || "";
assert(/50000000/.test(goldRule) && /operator:\s*"gte"/.test(goldRule), "Gold tier must require at least Rp50 million monthly average");
assert(/100000000/.test(platinumRule) && /operator:\s*"gt"/.test(platinumRule), "Platinum tier must require above Rp100 million monthly average");
assert(/eligibility/.test(controller), "Reseller tier API must expose eligibility requirements");
assert(/Gold[\s\S]{0,260}Rp50\.000\.000/.test(publicHtml), "Public reseller page must show Gold monthly requirement");
assert(/Platinum[\s\S]{0,260}Rp100\.000\.000/.test(publicHtml), "Public reseller page must show Platinum monthly requirement");
assert(/t\.eligibility\?\.requirement/.test(adminJs), "Admin tier table must show the server-side requirement");

console.log("PASS sim84: Gold/Platinum reseller monthly transaction eligibility is consistent");
