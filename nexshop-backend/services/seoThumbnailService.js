"use strict";

const fs = require("fs");
const path = require("path");
const { getStoreSettings } = require("../config/settings");

const THUMBNAIL_WIDTH = 1200;
const THUMBNAIL_HEIGHT = 630;
const CACHE_TTL_MS = 5 * 60 * 1000;
const DOCS_PDF_CACHE_TTL_MS = 15 * 60 * 1000;

const PAGE_TARGETS = Object.freeze({
  home: { pathname: "/", readySelector: "body" },
  marketplace: { pathname: "/marketplace", readySelector: ".mkt-nav" },
  reseller: { pathname: "/reseller", readySelector: "body" },
  "docs-reseller": { pathname: "/docs-reseller", readySelector: ".docs-layout" },
  "portal-reseller": { pathname: "/portal-reseller", readySelector: ".tv-console-layout" },
  berita: { pathname: "/berita", readySelector: ".news-nav" },
});

const thumbnailCache = new Map();
const inFlightRenders = new Map();
let browserPromise = null;
let renderQueue = Promise.resolve();
let docsPdfCache = null;
let docsPdfInFlight = null;

// Puppeteer hanya dibutuhkan saat crawler meminta thumbnail. Jangan require
// saat server startup: deployment yang belum menjalankan `npm install` harus
// tetap bisa melayani login/order, sementara endpoint SEO jatuh ke gambar
// fallback statis lewat seoController.
function getPuppeteer() {
  try {
    return require("puppeteer-core");
  } catch (error) {
    const dependencyError = new Error("puppeteer-core belum terpasang. Jalankan npm install di nexshop-backend.");
    dependencyError.code = "SEO_BROWSER_DEPENDENCY_MISSING";
    dependencyError.cause = error;
    throw dependencyError;
  }
}

function normalizePageKey(value) {
  const key = String(value || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(PAGE_TARGETS, key) ? key : null;
}

async function getSeoRuntimeSettings() {
  const settings = await getStoreSettings();
  return {
    baseUrl: settings?.seo_screenshot_base_url
      || process.env.SEO_SCREENSHOT_BASE_URL
      || process.env.FRONTEND_URL
      || "https://nexshop.cloud",
    executablePath: settings?.chrome_executable_path
      || process.env.CHROME_EXECUTABLE_PATH
      || "",
  };
}

async function getScreenshotBaseUrl() {
  const runtimeSettings = await getSeoRuntimeSettings();
  const raw = runtimeSettings.baseUrl;
  const parsed = new URL(raw);

  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error("SEO_SCREENSHOT_BASE_URL harus berupa origin HTTP(S) tanpa kredensial");
  }

  return parsed.origin;
}

function buildTargetUrl(pageKey, baseUrl = "https://nexshop.cloud") {
  const key = normalizePageKey(pageKey);
  if (!key) return null;
  return new URL(PAGE_TARGETS[key].pathname, `${baseUrl}/`).toString();
}

async function resolveChromeExecutable() {
  const runtimeSettings = await getSeoRuntimeSettings();
  const configured = runtimeSettings.executablePath;
  if (configured) {
    if (fs.existsSync(configured)) return configured;
    // Path dashboard/.env bisa tertinggal setelah paket browser diganti
    // (mis. google-chrome-stable -> chromium). Jangan langsung menggagalkan
    // semua thumbnail/PDF; lanjutkan ke kandidat sistem yang aman.
    console.warn(`CHROME_EXECUTABLE_PATH tidak ditemukan: ${configured}. Mencoba deteksi otomatis.`);
  }

  const candidates = process.platform === "win32"
    ? [
      path.join(process.env.PROGRAMFILES || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
      path.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
      path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
      path.join(process.env.PROGRAMFILES || "C:\\Program Files", "Microsoft", "Edge", "Application", "msedge.exe"),
    ]
    : process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      : [
        "/usr/bin/google-chrome-stable",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
      ];

  const executable = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  if (!executable) {
    const configuredInfo = configured ? ` Path tersimpan juga tidak ditemukan: ${configured}.` : "";
    throw new Error(`Chrome/Chromium tidak ditemukan.${configuredInfo} Atur CHROME_EXECUTABLE_PATH di dashboard admin.`);
  }
  return executable;
}

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = (async () => {
      const executablePath = await resolveChromeExecutable();
      const puppeteer = getPuppeteer();
      return puppeteer.launch({
        executablePath,
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
        ],
      });
    })().then((browser) => {
      browser.once("disconnected", () => {
        browserPromise = null;
      });
      return browser;
    }).catch((error) => {
      browserPromise = null;
      throw error;
    });
  }
  return browserPromise;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function renderPage(pageKey) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  const target = PAGE_TARGETS[pageKey];
  const targetUrl = buildTargetUrl(pageKey, await getScreenshotBaseUrl());

  try {
    await page.setViewport({ width: THUMBNAIL_WIDTH, height: THUMBNAIL_HEIGHT, deviceScaleFactor: 1 });
    await page.setCookie({
      name: "nexshop_cookie_consent",
      value: "v1.all",
      url: targetUrl,
      sameSite: "Lax",
      secure: targetUrl.startsWith("https://"),
    });
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForSelector(target.readySelector, { timeout: 8000 }).catch(() => undefined);
    await page.waitForFunction(
      () => !document.querySelector(".app-loader.is-visible"),
      { timeout: 13000 },
    ).catch(() => undefined);
    await Promise.race([
      page.evaluate(() => document.fonts && document.fonts.ready),
      delay(2500),
    ]).catch(() => undefined);

    await page.addStyleTag({
      content: `
        *, *::before, *::after { animation: none !important; transition: none !important; }
        .app-loader, .nexshop-cookie-banner, .nexshop-cookie-manage { display: none !important; }
      `,
    });
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      document.documentElement.style.scrollBehavior = "auto";
    });
    await delay(250);

    const screenshot = await page.screenshot({
      type: "jpeg",
      quality: 88,
      fullPage: false,
      captureBeyondViewport: false,
    });
    return Buffer.from(screenshot);
  } finally {
    await page.close().catch(() => undefined);
  }
}

function enqueueRender(pageKey) {
  const task = renderQueue.then(() => renderPage(pageKey));
  renderQueue = task.catch(() => undefined);
  return task;
}

async function getPageThumbnail(value) {
  const pageKey = normalizePageKey(value);
  if (!pageKey) {
    const error = new Error("Halaman SEO tidak dikenal");
    error.code = "SEO_PAGE_NOT_FOUND";
    throw error;
  }

  const now = Date.now();
  const cached = thumbnailCache.get(pageKey);
  if (cached && now - cached.createdAt < CACHE_TTL_MS) {
    return { buffer: cached.buffer, status: "cache-hit", pageKey };
  }

  if (inFlightRenders.has(pageKey)) {
    return inFlightRenders.get(pageKey);
  }

  const pending = enqueueRender(pageKey)
    .then((buffer) => {
      thumbnailCache.set(pageKey, { buffer, createdAt: Date.now() });
      return { buffer, status: "rendered", pageKey };
    })
    .catch((error) => {
      if (cached) {
        return { buffer: cached.buffer, status: "stale-cache", pageKey, renderError: error };
      }
      throw error;
    })
    .finally(() => {
      inFlightRenders.delete(pageKey);
    });

  inFlightRenders.set(pageKey, pending);
  return pending;
}

async function renderResellerDocsPdf() {
  const browser = await getBrowser();
  const page = await browser.newPage();
  const targetUrl = new URL(PAGE_TARGETS["docs-reseller"].pathname, `${await getScreenshotBaseUrl()}/`);
  targetUrl.searchParams.set("pdf", "1");

  try {
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    await page.setCookie({
      name: "nexshop_cookie_consent",
      value: "v1.all",
      url: targetUrl.toString(),
      sameSite: "Lax",
      secure: targetUrl.protocol === "https:",
    });
    await page.goto(targetUrl.toString(), { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector(".docs-layout", { timeout: 10000 });
    await Promise.race([
      page.evaluate(() => document.fonts && document.fonts.ready),
      delay(3000),
    ]).catch(() => undefined);

    await page.evaluate(() => {
      document.querySelectorAll("details").forEach((details) => { details.open = true; });
      document.documentElement.style.scrollBehavior = "auto";
      window.scrollTo(0, 0);
    });
    await page.emulateMediaType("print");
    await page.addStyleTag({
      content: `
        .mkt-nav, .mkt-nav-scrim, .docs-sidebar, .docs-mobile-toc,
        .nx-footer, .nexshop-cookie-banner, .nexshop-cookie-manage,
        .docs-pdf-download { display: none !important; }
        body { background: #fff !important; color: #111827 !important; }
        .mkt-bg-layer { display: none !important; }
        header { max-width: none !important; padding: 18mm 14mm 8mm !important; }
        .docs-layout { display: block !important; max-width: none !important; padding: 0 14mm 14mm !important; }
        .docs-content { gap: 12mm !important; }
        .docs-section { break-inside: auto; }
        .docs-card, .docs-endpoint-card, .docs-step, .docs-callout,
        pre, table, details { break-inside: avoid; }
        .docs-tab-pane { display: block !important; margin-bottom: 6mm !important; }
        * { box-shadow: none !important; text-shadow: none !important; }
      `,
    });

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "12mm", right: "10mm", bottom: "14mm", left: "10mm" },
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: '<div style="width:100%;font-size:8px;color:#6b7280;text-align:center;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
    });
    return Buffer.from(pdf);
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function getResellerDocsPdf() {
  const now = Date.now();
  if (docsPdfCache && now - docsPdfCache.createdAt < DOCS_PDF_CACHE_TTL_MS) {
    return { buffer: docsPdfCache.buffer, status: "cache-hit" };
  }
  if (docsPdfInFlight) return docsPdfInFlight;

  docsPdfInFlight = renderResellerDocsPdf()
    .then((buffer) => {
      docsPdfCache = { buffer, createdAt: Date.now() };
      return { buffer, status: "rendered" };
    })
    .finally(() => { docsPdfInFlight = null; });
  return docsPdfInFlight;
}

async function closeThumbnailBrowser() {
  const pendingBrowser = browserPromise;
  browserPromise = null;
  if (pendingBrowser) {
    const browser = await pendingBrowser.catch(() => null);
    if (browser) await browser.close().catch(() => undefined);
  }
}

async function resetSeoThumbnailRuntime() {
  thumbnailCache.clear();
  docsPdfCache = null;
  await closeThumbnailBrowser();
}

module.exports = {
  CACHE_TTL_MS,
  DOCS_PDF_CACHE_TTL_MS,
  PAGE_TARGETS,
  THUMBNAIL_HEIGHT,
  THUMBNAIL_WIDTH,
  buildTargetUrl,
  closeThumbnailBrowser,
  getPageThumbnail,
  getResellerDocsPdf,
  normalizePageKey,
  resetSeoThumbnailRuntime,
  resolveChromeExecutable,
};
