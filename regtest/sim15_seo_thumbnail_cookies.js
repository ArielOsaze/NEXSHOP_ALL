"use strict";

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");

const projectRoot = path.join(__dirname, "..");
const frontendRoot = path.join(projectRoot, "nexshop-frontend");
const thumbnailService = require(path.join(projectRoot, "nexshop-backend", "services", "seoThumbnailService"));

function assertStaticConfiguration() {
  const keys = Object.keys(thumbnailService.PAGE_TARGETS);
  assert.strictEqual(thumbnailService.CACHE_TTL_MS, 5 * 60 * 1000);
  assert.deepStrictEqual(keys, ["home", "marketplace", "reseller", "docs-reseller", "portal-reseller", "berita"]);
  assert.strictEqual(thumbnailService.normalizePageKey("https://evil.example"), null);
  assert.strictEqual(thumbnailService.normalizePageKey("../admin"), null);
  assert.strictEqual(thumbnailService.buildTargetUrl("marketplace", "https://nexshop.cloud"), "https://nexshop.cloud/marketplace");

  const expectedPages = {
    "index.html": "home",
    "marketplace.html": "marketplace",
    "reseller.html": "reseller",
    "docs-reseller.html": "docs-reseller",
    "portal-reseller.html": "portal-reseller",
    "berita.html": "berita",
  };
  for (const [file, key] of Object.entries(expectedPages)) {
    const html = fs.readFileSync(path.join(frontendRoot, file), "utf8");
    assert(html.includes(`https://nexshop.cloud/api/seo/thumbnail?page=${key}`), `${file}: thumbnail live belum dipasang`);
    assert(html.includes("/cookie-consent.js"), `${file}: consent cookie belum dipasang`);
  }

  for (const file of ["berita-artikel.html", "login.html"]) {
    const html = fs.readFileSync(path.join(frontendRoot, file), "utf8");
    assert(html.includes("/cookie-consent.js"), `${file}: consent cookie belum dipasang`);
  }

  const cookieScript = fs.readFileSync(path.join(frontendRoot, "cookie-consent.js"), "utf8");
  assert(cookieScript.includes("SameSite=Lax"));
  assert(cookieScript.includes("location.protocol === \"https:\""));
  assert(cookieScript.includes("v1.essential"));
  assert(cookieScript.includes("v1.all"));
  assert(!/token|jwt|authorization/i.test(cookieScript), "Consent script tidak boleh menangani token login");

  const adminHtml = fs.readFileSync(path.join(frontendRoot, "admin", "dashboard.html"), "utf8");
  const adminScript = fs.readFileSync(path.join(frontendRoot, "admin", "js", "dashboard.js"), "utf8");
  const adminLoginHtml = fs.readFileSync(path.join(frontendRoot, "admin", "login.html"), "utf8");
  const adminLoginScript = fs.readFileSync(path.join(frontendRoot, "admin", "js", "login.js"), "utf8");
  const seoServiceSource = fs.readFileSync(path.join(projectRoot, "nexshop-backend", "services", "seoThumbnailService.js"), "utf8");
  const settingsConfig = fs.readFileSync(path.join(projectRoot, "nexshop-backend", "config", "settings.js"), "utf8");
  const settingsController = fs.readFileSync(path.join(projectRoot, "nexshop-backend", "controllers", "settingsController.js"), "utf8");
  const migration = fs.readFileSync(path.join(projectRoot, "nexshop-backend", "migrations", "012_add_seo_thumbnail_settings.sql"), "utf8");
  for (const field of ["seo_screenshot_base_url", "chrome_executable_path"]) {
    assert(adminScript.includes(field), `Admin belum menyimpan/memuat ${field}`);
    assert(settingsConfig.includes(`\"${field}\"`), `store_settings belum mengizinkan ${field}`);
    assert(settingsController.includes(field), `controller admin belum menangani ${field}`);
    assert(migration.includes(field), `migration belum menambah ${field}`);
  }
  assert(adminHtml.includes("seoScreenshotBaseUrl"));
  assert(adminHtml.includes("chromeExecutablePath"));
  assert(adminLoginHtml.includes("../images/nexshop-logo.webp"), "Login admin harus memakai logo resmi NexShop");
  assert(!adminLoginHtml.includes("bi bi-shop"), "Ikon toko generik tidak boleh kembali ke login admin");
  assert(adminLoginScript.includes("Server NexShop sedang tidak tersedia"), "Login admin harus membedakan error server dari password salah");
  assert(!/^const puppeteer = require\("puppeteer-core"\);/m.test(seoServiceSource), "Puppeteer tidak boleh dimuat saat backend startup");
  assert(seoServiceSource.includes("function getPuppeteer()"), "Puppeteer harus di-load hanya saat thumbnail diminta");
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".webp")) return "image/webp";
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

function createStaticServer() {
  const routeFiles = {
    "/": "index.html",
    "/marketplace": "marketplace.html",
    "/reseller": "reseller.html",
    "/docs-reseller": "docs-reseller.html",
    "/portal-reseller": "portal-reseller.html",
    "/berita": "berita.html",
  };

  return http.createServer((req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    const requested = routeFiles[pathname] || pathname.replace(/^\/+/, "");
    const resolved = path.resolve(frontendRoot, requested || "index.html");
    if (!resolved.startsWith(`${path.resolve(frontendRoot)}${path.sep}`)) {
      res.writeHead(403).end();
      return;
    }
    fs.readFile(resolved, (error, buffer) => {
      if (error) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "Content-Type": contentType(resolved) });
      res.end(buffer);
    });
  });
}

async function main() {
  assertStaticConfiguration();

  if (process.argv.includes("--render")) {
    const server = createStaticServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    process.env.SEO_SCREENSHOT_BASE_URL = `http://127.0.0.1:${address.port}`;
    try {
      const first = await thumbnailService.getPageThumbnail("marketplace");
      assert.strictEqual(first.status, "rendered");
      assert(first.buffer.length > 10000, "JPEG hasil render terlalu kecil");
      assert.strictEqual(first.buffer[0], 0xff);
      assert.strictEqual(first.buffer[1], 0xd8);
      const sharpPath = require.resolve("sharp", { paths: [path.join(projectRoot, "nexshop-backend")] });
      const metadata = await require(sharpPath)(first.buffer).metadata();
      assert.strictEqual(metadata.width, 1200);
      assert.strictEqual(metadata.height, 630);
      const second = await thumbnailService.getPageThumbnail("marketplace");
      assert.strictEqual(second.status, "cache-hit");
    } finally {
      await thumbnailService.closeThumbnailBrowser();
      await new Promise((resolve) => server.close(resolve));
    }
  }

  console.log("sim15 PASS: SEO thumbnail allowlist/cache dan consent cookie terverifikasi");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
