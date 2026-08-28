"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8").replace(/\r\n/g, "\n");
const portal = read("nexshop-frontend/portal-reseller.html");
const index = read("nexshop-frontend/index.html");
const legalModal = read("nexshop-frontend/legal-modal.js");
const nexbot = read("nexshop-frontend/nexbot.js");
const style = read("nexshop-frontend/style.css");
const cookieConsent = read("nexshop-frontend/cookie-consent.js");
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
const mascotWavePath = path.join(root, "nexshop-frontend/images/nexbot-mascot-wave.webp");
const mascotHeader = fs.existsSync(mascotPath)
    ? fs.readFileSync(mascotPath).subarray(0, 12).toString("ascii")
    : "";
const mascotWaveHeader = fs.existsSync(mascotWavePath)
    ? fs.readFileSync(mascotWavePath).subarray(0, 12).toString("ascii")
    : "";
check(
    "pose diam dan lambaian NexBot tersimpan sebagai aset WebP lokal",
    mascotHeader.startsWith("RIFF") && mascotHeader.endsWith("WEBP") &&
        mascotWaveHeader.startsWith("RIFF") && mascotWaveHeader.endsWith("WEBP")
);
check(
    "avatar dan pose lambaian NexBot memakai aset terpusat",
    nexbot.includes('const NEXBOT_MASCOT_SRC = "/images/nexbot-mascot.webp"') &&
        nexbot.includes('const NEXBOT_MASCOT_WAVE_SRC = "/images/nexbot-mascot-wave.webp"') &&
        index.includes('class="nexbot-mascot-frame-stack"') &&
        !nexbot.includes("fa-robot") &&
        style.includes(".nexbot-mascot-image")
);
check(
    "shortcut NexBot memakai ikon bantuan tanpa ornamen petir generik",
    nexbot.includes('{ icon: "fa-circle-question", topic: "Cara top up?" }') &&
        !nexbot.includes('{ icon: "fa-bolt", topic: "Cara top up?" }')
);
check(
    "interaksi pointer tetap aktif tanpa menggeser seluruh badan maskot",
    nexbot.includes('floatBtn.addEventListener("pointermove"') &&
        nexbot.includes('floatBtn.classList.add("expanding", "is-reacting")') &&
        nexbot.includes('windowEl.classList.toggle("is-listening"') &&
        !nexbot.includes("--nexbot-look-x") &&
        style.includes(".nexbot-float-btn-icon") &&
        style.includes("transform: none") &&
        !style.includes("@keyframes nexbot-mascot-idle")
);
check(
    "bubble sapaan NexBot tersedia pada markup statis dan widget lintas halaman",
    index.includes('id="nexbotSpeechBubble"') &&
        index.includes("Hii, NexBot di sini!") &&
        nexbot.includes('id="nexbotSpeechBubble"') &&
        nexbot.includes('showNexBotPetBubble("Hii, NexBot di sini!"') &&
        style.includes(".nexbot-speech-bubble::after") &&
        !style.includes(".nexbot-speech-bubble::before")
);
check(
    "setiap bubble memicu pergantian frame lengan tanpa menggoyang badan",
    nexbot.includes("function triggerNexBotPetGreeting()") &&
        nexbot.includes('floatBtn.classList.add("is-bubble-greeting")') &&
        nexbot.includes("triggerNexBotPetGreeting();") &&
        style.includes(".nexbot-float-btn.is-bubble-greeting .nexbot-mascot-frame--wave") &&
        style.includes("@keyframes nexbot-arm-wave-rest-frame") &&
        style.includes("@keyframes nexbot-arm-wave-raised-frame") &&
        !style.includes("@keyframes nexbot-pet-bubble-greet")
);
check(
    "teks promosi memakai tanda baca natural tanpa strip pemisah",
    index.includes("topup instan, aman, cepat, dan terpercaya") &&
        !index.includes("topup instan — aman")
);
check(
    "pet NexBot bereaksi terhadap gestur elus, bubble, partikel, dan waktu idle tanpa animasi badan",
    nexbot.includes("petTravel += Math.hypot") &&
        nexbot.includes('floatBtn.classList.add("is-petted")') &&
        nexbot.includes("emitNexBotPetSparks(floatBtn") &&
        nexbot.includes("scheduleNexBotPetIdle()") &&
        nexbot.includes("NEXBOT_PET_IDLE_LINES") &&
        style.includes("@keyframes nexbot-pet-spark") &&
        !style.includes("@keyframes nexbot-pet-happy") &&
        !style.includes("@keyframes nexbot-pet-curious")
);
check(
    "maskot memiliki status visual berpikir dan selesai menjawab",
    nexbot.includes('windowEl.classList.add("is-thinking")') &&
        nexbot.includes('msgDiv.classList.add("nexbot-msg--arriving")') &&
        style.includes("@keyframes nexbot-mascot-think") &&
        style.includes("@keyframes nexbot-mascot-answer")
);
check(
    "animasi pergantian frame menghormati preferensi reduced motion",
    style.includes("@keyframes nexbot-arm-wave-raised-frame") &&
        style.includes("@media (prefers-reduced-motion: reduce)") &&
        style.includes("animation: none !important")
);
check(
    "tombol maskot transparan tanpa lingkaran warna bawaan",
    /\.nexbot-float-btn\s*\{[\s\S]*?background:\s*transparent;[\s\S]*?border:\s*0;[\s\S]*?box-shadow:\s*none;/.test(style) &&
    style.includes("overflow: visible")
);
check(
    "pilihan cookie tidak meninggalkan tombol mengambang di kiri bawah",
    !cookieConsent.includes("nexshop-cookie-manage") &&
        !cookieConsent.includes("manage.hidden = false") &&
        cookieConsent.includes("document.body.append(banner)") &&
        cookieConsent.includes("window.NexShopCookies")
);

if (!process.exitCode) {
    console.log(`\nRINGKASAN: ${passed} pengujian lolos.`);
}
