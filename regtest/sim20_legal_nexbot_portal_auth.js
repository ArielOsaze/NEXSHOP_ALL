"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const portal = read("nexshop-frontend/portal-reseller.html");
const index = read("nexshop-frontend/index.html");
const legalModal = read("nexshop-frontend/legal-modal.js");
const nexbot = read("nexshop-frontend/nexbot.js");
const style = read("nexshop-frontend/style.css");
const publicLegalPages = [
    "berita-artikel.html",
    "berita.html",
    "docs-reseller.html",
    "marketplace.html",
    "reseller.html"
].map((name) => read(`nexshop-frontend/${name}`));

let passed = 0;
function check(label, condition) {
    if (!condition) {
        console.error(`  [FAIL] ${label}`);
        process.exitCode = 1;
        return;
    }
    passed += 1;
    console.log(`  [PASS] ${label}`);
}

console.log("NEXSHOP REGTEST 20: LEGALITAS, NEXBOT & AUTH PORTAL\n");

check(
    "semua footer publik memuat modal legalitas bersama",
    publicLegalPages.every((html) => html.includes('/legal-modal.js?v=20260825'))
);
check(
    "klik /legalitas dicegah agar tidak pindah ke halaman Top Up",
    legalModal.includes('a[href="/legalitas"]') &&
        legalModal.includes("event.preventDefault()") &&
        legalModal.includes("openModal(trigger)") &&
        !legalModal.includes("window.location")
);
check(
    "modal legalitas dapat ditutup, mengembalikan fokus, dan mendukung Escape",
    legalModal.includes('event.key === "Escape"') &&
        legalModal.includes("lastTrigger.focus()") &&
        legalModal.includes('aria-modal="true"')
);

const fetchPosition = portal.indexOf('fetch(`${API_BASE}/reseller/portal/overview`');
const dashboardPosition = portal.indexOf("showPortalDashboard();", fetchPosition);
check(
    "dashboard reseller baru tampil setelah token diverifikasi server",
    fetchPosition >= 0 &&
        dashboardPosition > fetchPosition &&
        portal.indexOf("if (!res.ok)", fetchPosition) < dashboardPosition &&
        portal.indexOf("if (!data.user)", fetchPosition) < dashboardPosition
);
check(
    "sesi kosong atau kedaluwarsa selalu gagal tertutup ke layar login",
    portal.includes("if (!token) {") &&
        portal.includes("clearResellerSession();\n                    showPortalAuth(data.message") &&
        portal.includes('if (secDash) secDash.style.display = "none"')
);
check(
    "token customer biasa tidak dipakai sebagai token portal reseller",
    portal.includes('localStorage.getItem("nexshop-reseller-token")') &&
        !/function getResellerToken\(\)[\s\S]{0,600}localStorage\.getItem\(["']token["']\)/.test(portal)
);

const mascotPath = path.join(root, "nexshop-frontend/images/nexbot-mascot.webp");
const mascotHeader = fs.existsSync(mascotPath)
    ? fs.readFileSync(mascotPath).subarray(0, 12).toString("ascii")
    : "";
check(
    "maskot NexBot tersimpan sebagai aset WebP lokal",
    mascotHeader.startsWith("RIFF") && mascotHeader.endsWith("WEBP")
);
check(
    "semua avatar NexBot memakai satu aset maskot terpusat",
    nexbot.includes('const NEXBOT_MASCOT_SRC = "/images/nexbot-mascot.webp"') &&
        !nexbot.includes("fa-robot") &&
        style.includes(".nexbot-mascot-image")
);
check(
    "maskot merespons pointer, fokus input, dan klik pengguna",
    nexbot.includes('floatBtn.addEventListener("pointermove"') &&
        nexbot.includes('floatBtn.classList.add("expanding", "is-reacting")') &&
        nexbot.includes('windowEl.classList.toggle("is-listening"') &&
        style.includes("@keyframes nexbot-mascot-wave") &&
        style.includes("@keyframes nexbot-mascot-excited")
);
check(
    "bubble sapaan NexBot tersedia pada markup statis dan widget lintas halaman",
    index.includes('id="nexbotSpeechBubble"') &&
        index.includes("Hii, NexBot di sini!") &&
        nexbot.includes('id="nexbotSpeechBubble"') &&
        nexbot.includes('showNexBotPetBubble("Hii, NexBot di sini!"') &&
        style.includes(".nexbot-speech-bubble::after")
);
check(
    "pet NexBot bereaksi terhadap gestur elus, mood, partikel, dan waktu idle",
    nexbot.includes("petTravel += Math.hypot") &&
        nexbot.includes('floatBtn.classList.add("is-petted")') &&
        nexbot.includes("emitNexBotPetSparks(floatBtn") &&
        nexbot.includes("scheduleNexBotPetIdle()") &&
        nexbot.includes("NEXBOT_PET_IDLE_LINES") &&
        style.includes('[data-pet-mood="curious"]') &&
        style.includes("@keyframes nexbot-pet-happy") &&
        style.includes("@keyframes nexbot-pet-spark")
);
check(
    "maskot memiliki status visual berpikir dan selesai menjawab",
    nexbot.includes('windowEl.classList.add("is-thinking")') &&
        nexbot.includes('msgDiv.classList.add("nexbot-msg--arriving")') &&
        style.includes("@keyframes nexbot-mascot-think") &&
        style.includes("@keyframes nexbot-mascot-answer")
);
check(
    "seluruh animasi maskot menghormati preferensi reduced motion",
    style.includes("@keyframes nexbot-mascot-idle") &&
        style.includes("@media (prefers-reduced-motion: reduce)") &&
        style.includes("animation: none !important")
);
check(
    "tombol maskot transparan tanpa lingkaran warna bawaan",
    /\.nexbot-float-btn\s*\{[\s\S]*?background:\s*transparent;[\s\S]*?border:\s*0;[\s\S]*?box-shadow:\s*none;/.test(style) &&
        style.includes("overflow: visible")
);

if (!process.exitCode) {
    console.log(`\nRINGKASAN: ${passed} pengujian lolos.`);
}
