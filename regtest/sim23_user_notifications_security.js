const assert = require("assert");
const {
    resolveUserDisplayName,
    formatWibTimestamp,
    describeUserAgent,
    buildLoginSecurityMessage
} = require("../nexshop-backend/services/userNotificationHelpers");

assert.equal(resolveUserDisplayName({ fullname: "  Ariel Osaze  ", email: "ariel@example.com" }), "Ariel Osaze");
assert.equal(resolveUserDisplayName({ fullname: "", email: "ariel.osaze@gmail.com" }), "ariel.osaze");
assert.equal(resolveUserDisplayName({ fullname: "Player 123456", email: "ariel.osaze@gmail.com" }), "ariel.osaze");
assert.equal(resolveUserDisplayName({ fullname: null, email: "" }), "Pengguna NexShop");

const timestamp = formatWibTimestamp(new Date("2026-08-26T06:07:08.000Z"));
assert.match(timestamp, /13:07:08 WIB/);
assert.match(timestamp, /26 Agustus 2026/);

const browser = describeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/139.0.0.0 Safari/537.36");
assert.match(browser, /Chrome/);
assert.match(browser, /Windows/);

const message = buildLoginSecurityMessage({
    user: { fullname: "", email: "ariel.osaze@gmail.com" },
    timestamp: new Date("2026-08-26T06:07:08.000Z"),
    ip: "203.0.113.10",
    location: "Jakarta, Indonesia",
    userAgent: "Mozilla/5.0 Chrome/139 Windows",
    resetUrl: "https://nexshop.cloud/#/reset-password?token=" + "a".repeat(64)
});
assert.match(message, /ariel\.osaze/);
assert.match(message, /26 Agustus 2026 13:07:08 WIB/);
assert.match(message, /Jakarta, Indonesia/);
assert.match(message, /Chrome/);
assert.match(message, /203\.0\.113\.10/);
assert.match(message, /https:\/\/nexshop\.cloud\/#\/reset-password\?token=[a-f0-9]{64}/);
assert.match(message, /Jika ini bukan Anda/i);

const adminMessage = buildLoginSecurityMessage({
    user: { fullname: "Ariel Admin", email: "admin@nexshop.com", role: "admin" },
    loginContext: "admin",
    timestamp: new Date("2026-08-26T06:07:08.000Z"),
    ip: "203.0.113.10",
    location: "Jakarta, Indonesia",
    userAgent: "Mozilla/5.0 Chrome/139 Windows",
    resetUrl: "https://nexshop.cloud/#/reset-password?token=" + "a".repeat(64)
});
assert.match(adminMessage, /Peringatan Login Dashboard Admin NexShop/);
assert.match(adminMessage, /dashboard admin NexShop/i);
assert.match(adminMessage, /Nama: Ariel Admin/);
assert.match(adminMessage, /Email: admin@nexshop\.com/);
assert.match(adminMessage, /Peran: Admin/);
assert.doesNotMatch(adminMessage, /akun NexShop kamu baru saja login/i);

const staffMessage = buildLoginSecurityMessage({
    user: { fullname: "Staff NexShop", email: "staff@nexshop.com", role: "staff" },
    loginContext: "admin",
    timestamp: new Date("2026-08-26T06:07:08.000Z"),
    ip: "203.0.113.11",
    location: "Bandung, Indonesia",
    userAgent: "Mozilla/5.0 Firefox/140 Windows",
    resetUrl: "https://nexshop.cloud/#/reset-password?token=" + "a".repeat(64)
});
assert.match(staffMessage, /Peringatan Login Dashboard Staff NexShop/);
assert.match(staffMessage, /dashboard staff NexShop/i);

const fs = require("fs");
const walletControllerSource = fs.readFileSync(require.resolve("../nexshop-backend/controllers/walletController"), "utf8");
assert.match(walletControllerSource, /notify\("wallet"/);
assert.match(walletControllerSource, /sendUserWhatsApp\(/);
assert.match(walletControllerSource, /email: buyerEmail/);

console.log("sim23_user_notifications_security: passed");
