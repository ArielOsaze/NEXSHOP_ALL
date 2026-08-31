const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "nexshop-frontend/index.html"), "utf8").replace(/\r\n/g, "\n");
const script = fs.readFileSync(path.join(root, "nexshop-frontend/script.js"), "utf8").replace(/\r\n/g, "\n");
const nginx = fs.readFileSync(path.join(root, "nginx-nexshop.conf"), "utf8").replace(/\r\n/g, "\n");

// SEO homepage must sell the product, not expose contact/address as the primary snippet.
assert.match(html, /<title>NexShop \| Top Up Game Murah, Cepat &amp; Aman/);
assert.match(html, /<meta name="description" content="Top up game murah dan instan di NexShop/);
assert.match(html, /"alternateName": \["NexShop Gaming Marketplace", "NexShop Top Up Game"\]/);
assert.match(html, /"potentialAction":/);
assert.doesNotMatch(html, /"@type": "LocalBusiness"/, "Homepage tidak boleh memberi sinyal alamat sebagai identitas utama");

// Non-critical libraries must not block HTML parsing; the music shell is CSS/HTML-only on first paint.
assert.match(html, /<script defer src="\/product-description\.js/);
assert.match(html, /<script defer src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/qrcodejs/);
assert.match(html, /<audio id="heroAudioPlayer" src="" preload="none"(?: crossorigin="anonymous")?><\/audio>/);
assert.doesNotMatch(script, /heroAudioPlayer\.src = data\.music\.audio_url;/);
assert.match(script, /const ensureAudioSource = \(\) =>/);
assert.match(script, /if \(!ensureAudioSource\(\)\)[\s\S]{0,300}heroAudioPlayer\.play\(/);
assert.match(script, /function ensureAuthCaptcha\(\)/);
assert.match(script, /if \(id === "authOverlay"\) void ensureAuthCaptcha\(\);/);
assert.doesNotMatch(script, /async function initAuthSecurity\(\) \{[\s\S]{0,700}security\.mountCaptcha/, "Captcha tidak boleh dimount saat homepage baru dibuka");
assert.match(html, /id="musicCoverImg"[^>]*src=""/, "cover hero harus dimulai kosong dan diisi dari API upload admin");
assert.match(script, /const coverUrl = typeof data\.music\.cover_url === "string"/);
assert.match(script, /musicCoverImg\.src\s*=\s*getResponsiveImageUrl\(coverUrl/);
assert.doesNotMatch(script, /aida-public\//, "hero tidak boleh memakai artwork generate lama");
assert.match(html, /class="[^"]*music-disc-shell[^"]*"/);
assert.match(html, /style\.css\?v=/);
assert.match(html, /script\.js\?v=/);
assert.match(html, /<img src="\/images\/oss-logo\.webp" width="180" height="101" alt="OSS Logo" loading="lazy" decoding="async">/);
assert.match(html, /<img data-src="\/images\/nexbot-mascot-128\.webp"/);
assert.match(html, /<img data-src="\/images\/nexbot-mascot-wave-128\.webp"/);
assert.match(script, /function hydratePromoSlide\(index\)/);
assert.match(script, /data-srcset=/);
assert.match(script, /function loadDeferredNexBotImages\(\)/);
assert.doesNotMatch(html, /src="https:\/\/lh3\.googleusercontent\.com\//, "Aset cover Google lama tidak boleh kembali ke player");
assert.match(html, /fonts\/homepage-fonts\.css/, "Font homepage harus di-self-host dan tidak bergantung pada Google Fonts");
assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/);

// First paint must not wait for the secondary data fan-out.
assert.match(script, /let initialBackgroundLoading = true;/);
assert.match(script, /const refreshedUserPromise = refreshCurrentUserProfile\(\);/);
assert.match(script, /hideAppLoader\(\);[\s\S]{0,500}initialRequests\.finally/);
assert.doesNotMatch(script, /new Promise\(\(resolve\) => setTimeout\(\(\) => resolve\(false\), 12000\)\)/, "Loader tidak boleh menahan first render 12 detik");

const bootstrapSource = script.slice(script.indexOf("async function bootstrapApp"), script.indexOf("function startApp"));
assert.match(script, /function loadSectionWhenNear\(/);
assert.match(script, /function runBackgroundTask\(/);
assert.match(bootstrapSource, /initDeferredHomepageData\(\);/);
assert.doesNotMatch(bootstrapSource, /loadProducts\(\)|loadTopupProducts\(\)|loadNexshopNews\(\)|loadTestimonials\(\)|loadLeaderboard\(\)/, "Data section bawah tidak boleh bersaing pada first render");

// Static assets are compressible and should be served with compression enabled.
assert.match(nginx, /gzip\s+on;/);
assert.match(nginx, /application\/javascript/);
assert.match(nginx, /image\/svg\+xml/);
assert.match(nginx, /expires 30d;/);
assert.match(nginx, /server_name www\.nexshop\.cloud;/);
assert.match(nginx, /return 301 https:\/\/nexshop\.cloud\$request_uri;/);

console.log("sim39_performance_seo_critical_path: passed");
