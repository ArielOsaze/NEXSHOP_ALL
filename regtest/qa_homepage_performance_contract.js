const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "nexshop-frontend/index.html"), "utf8").replace(/\r\n/g, "\n");
const script = fs.readFileSync(path.join(root, "nexshop-frontend/script.js"), "utf8").replace(/\r\n/g, "\n");
const nginx = fs.readFileSync(path.join(root, "nginx-nexshop.conf"), "utf8").replace(/\r\n/g, "\n");

// The homepage must not eagerly download a non-critical music cover before the
// public music API responds, and Supabase media must request display-sized data.
assert.match(html, /id="musicCoverImg"[^>]*src=""[^>]*loading="eager"[^>]*fetchpriority="high"/,
    "cover musik hero harus tetap eager setelah URL API tersedia");
assert.match(script, /function getResponsiveImageUrl\(url, width, height, quality\)/,
    "URL gambar Supabase harus punya helper transformasi ukuran");
assert.match(script, /getResponsiveImageUrl\(coverUrl/,
    "cover musik harus memakai transformasi ukuran");
assert.match(script, /getResponsiveImageSrcset\(mobileImage/,
    "gambar promo mobile harus memakai transformasi ukuran");

// Only the first visible promo is eligible for initial loading. Other slides
// remain lazy and continue to hydrate when selected/near the carousel.
assert.match(script, /const pictureMarkup = \(alt, className, isFirstSlide\)/,
    "carousel harus membedakan slide pertama dari slide lazy");
assert.match(script, /fetchpriority=\"high\"/,
    "slide promo pertama harus mendapat priority hint");
assert.match(script, /loading=\"\$\{isFirstSlide \? 'eager' : 'lazy'\}\"/,
    "hanya slide promo pertama yang eager");

// Non-critical fan-out should be scheduled after the critical shell is ready.
assert.match(script, /function scheduleNonCriticalHomepageWork\(\)/,
    "pekerjaan homepage non-kritis harus dijadwalkan setelah shell");
assert.match(script, /scheduleNonCriticalHomepageWork\(\);/,
    "bootstrap harus menggunakan scheduler non-kritis");
assert.doesNotMatch(script, /const initialRequests = Promise\.allSettled\(\[[\s\S]*loadPromo\(\)[\s\S]*initMusicPlayer\(\)[\s\S]*\]\);/,
    "promo dan music tidak boleh menjadi initial fan-out blocking group");

// Reserve media geometry to keep the hero and footer stable.
assert.match(html, /id="musicCoverImg"[^>]*width="640"[^>]*height="640"/,
    "cover musik harus punya intrinsic dimensions");
assert.match(html, /src="\/images\/oss-logo\.webp" width="180" height="101" alt="OSS Logo" loading="lazy"/,
    "logo OSS harus punya intrinsic dimensions");

// Homepage-specific font manifest must be small and still local/self-hosted.
assert.match(html, /fonts\/homepage-fonts\.css/,
    "homepage harus memakai manifest font minimal");
assert.match(html, /<link[^>]*rel="preload"[^>]*font-153fc85b70298bee\.woff2[^>]*>/,
    "font inti homepage harus dipreload secara eksplisit");
assert.match(html, /<link[^>]*as="font"[^>]*type="font\/woff2"[^>]*>/,
    "preload harus ditandai sebagai font WOFF2");
assert.match(html, /<link[^>]*rel="preload"[^>]*href="\/api\/promo"[^>]*as="fetch"[^>]*crossorigin[^>]*>/,
    "API promo harus bisa ditemukan sebelum bundle selesai dieksekusi");
assert.doesNotMatch(html, /fonts\/google-fonts\.css/,
    "homepage tidak boleh memuat manifest semua halaman");

// Versioned static assets should be cacheable for a long time at the edge.
assert.match(nginx, /location ~\* \\.\(\?:css\|js\|mjs\|woff2\?\|svg\|webp\|png\|jpe\?g\|gif\|ico\)\$/);
assert.match(nginx, /add_header Cache-Control "public, max-age=2592000, immutable" always;/,
    "asset berversi harus dikirim dengan cache immutable");

for (const scriptName of ["nexbot.js", "auth-security.js", "checkout-identity.js", "script.js"]) {
    assert.match(html, new RegExp(`<script[^>]*defer[^>]*src="/${scriptName}`),
        `${scriptName} harus defer agar parser tidak terblokir`);
}

console.log("qa_homepage_performance_contract: passed");
