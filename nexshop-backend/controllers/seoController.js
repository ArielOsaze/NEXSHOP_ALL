"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  getPageThumbnail,
  normalizePageKey,
} = require("../services/seoThumbnailService");

const FALLBACK_IMAGE_PATH = path.join(__dirname, "..", "..", "nexshop-frontend", "images", "nexshop-og-v2.jpg");
let fallbackImagePromise = null;

function getFallbackImage() {
  if (!fallbackImagePromise) {
    fallbackImagePromise = fs.promises.readFile(FALLBACK_IMAGE_PATH).catch((error) => {
      fallbackImagePromise = null;
      throw error;
    });
  }
  return fallbackImagePromise;
}

function createEtag(buffer) {
  return `"${crypto.createHash("sha256").update(buffer).digest("hex")}"`;
}

function sendImage(req, res, buffer, status, maxAgeSeconds) {
  const etag = createEtag(buffer);
  res.set({
    "Content-Type": "image/jpeg",
    "Content-Length": String(buffer.length),
    "Cache-Control": `public, max-age=${maxAgeSeconds}, stale-while-revalidate=86400`,
    ETag: etag,
    "X-NexShop-SEO-Thumbnail": status,
  });

  if (req.get("If-None-Match") === etag) {
    return res.status(304).end();
  }
  return res.status(200).send(buffer);
}

async function thumbnail(req, res, next) {
  const pageKey = normalizePageKey(req.query.page);
  if (!pageKey) {
    return res.status(404).json({
      success: false,
      code: "SEO_PAGE_NOT_FOUND",
      message: "Thumbnail SEO untuk halaman tersebut tidak tersedia.",
    });
  }

  try {
    const result = await getPageThumbnail(pageKey);
    if (result.renderError) {
      console.warn(`[SEO Thumbnail] Memakai cache lama untuk ${pageKey}:`, result.renderError.message);
    }
    return sendImage(req, res, result.buffer, result.status, 300);
  } catch (error) {
    console.error(`[SEO Thumbnail] Render ${pageKey} gagal, memakai fallback statis:`, error.message);
    try {
      const fallback = await getFallbackImage();
      return sendImage(req, res, fallback, "static-fallback", 60);
    } catch (fallbackError) {
      return next(fallbackError);
    }
  }
}

module.exports = { thumbnail };
