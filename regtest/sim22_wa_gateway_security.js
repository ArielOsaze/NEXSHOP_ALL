const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { validateWaGatewayUrlShape } = require("../nexshop-backend/utils/waGatewayUrl");

assert.equal(validateWaGatewayUrlShape("http://127.0.0.1:8080").ok, true, "gateway lokal harus boleh HTTP");
assert.equal(validateWaGatewayUrlShape("http://192.168.1.20:8080").ok, true, "gateway LAN privat harus boleh HTTP");
assert.equal(validateWaGatewayUrlShape("http://gateway.example.com:8080").ok, false, "gateway publik tidak boleh HTTP");
assert.equal(validateWaGatewayUrlShape("https://gateway.example.com").ok, true, "gateway publik HTTPS harus boleh");
assert.equal(validateWaGatewayUrlShape("http://127.0.0.1:8080/extra").ok, false, "base URL gateway tidak boleh memiliki path");

const controller = fs.readFileSync(path.join(__dirname, "../nexshop-backend/controllers/settingsController.js"), "utf8");
assert.ok(controller.includes("validateWaGatewayUrlShape"), "settings harus memakai validator gateway khusus");
assert.ok(!controller.includes("execSync(\"pm2 restart nexshop-wa-api\")"), "backend utama tidak boleh mengontrol PM2 gateway");
assert.ok(controller.includes("`${url}/reset`"), "reset harus diminta ke gateway sendiri");

const gateway = fs.readFileSync(path.join(__dirname, "../wa-gateway-server/server.js"), "utf8");
assert.ok(gateway.includes('process.env.HOST || "127.0.0.1"'), "gateway harus private-by-default");
assert.ok(gateway.includes("timingSafeEqual"), "API key gateway harus timing-safe");
assert.ok(gateway.includes('app.post("/send-message"'), "campaign harus memakai endpoint pesan satuan");

console.log("sim22_wa_gateway_security: passed");
