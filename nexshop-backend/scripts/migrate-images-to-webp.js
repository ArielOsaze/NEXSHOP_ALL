/*
 * Migrates every raster image currently referenced by the storefront.
 *
 * Run an audit first:
 *   npm run optimize:existing-images
 * Apply database URL changes and upload the WebP files:
 *   npm run optimize:existing-images -- --execute
 *
 * The original objects are deliberately retained for rollback. Remove them
 * only after the migrated storefront has been checked.
 */
const axios = require("axios");
const supabase = require("../config/db");
const { createWebpFileName, optimizeImageToWebp } = require("../utils/imageOptimizer");

const EXECUTE = process.argv.includes("--execute");
const MAX_DOWNLOAD_BYTES = 15 * 1024 * 1024;

const TARGETS = [
    { table: "products", fields: [{ name: "image", bucket: "products", preset: "product" }] },
    {
        table: "promo_slides",
        fields: [
            { name: "image_url", bucket: "promo", preset: "promo" },
            { name: "mobile_image_url", bucket: "promo", preset: "promoMobile" }
        ]
    },
    { table: "store_settings", fields: [{ name: "logo_url", bucket: "logos", preset: "logo" }] },
    {
        table: "topup_products",
        fields: [
            { name: "operator_logo", bucket: "logos", preset: "logo" },
            { name: "item_icon", bucket: "logos", preset: "logo" }
        ]
    }
];

function isOptimizedWebpUrl(url) {
    try {
        const parsed = new URL(url);
        return /\/webp\/.+\.webp$/i.test(decodeURIComponent(parsed.pathname));
    } catch {
        return false;
    }
}

async function downloadImage(url) {
    if (/\.svg(?:[?#]|$)/i.test(url)) return null;

    const response = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: 30000,
        maxContentLength: MAX_DOWNLOAD_BYTES,
        maxBodyLength: MAX_DOWNLOAD_BYTES,
        validateStatus: (status) => status >= 200 && status < 300
    });
    const contentType = String(response.headers["content-type"] || "").toLowerCase();
    if (contentType.includes("image/svg+xml")) return null;

    const data = Buffer.from(response.data);
    if (!data.length) throw new Error("Image file is empty");
    return data;
}

async function convertSource(sourceUrl, field) {
    const source = await downloadImage(sourceUrl);
    if (!source) return null;

    const optimized = await optimizeImageToWebp(source, field.preset);
    if (!EXECUTE) return optimized;

    const fileName = createWebpFileName();
    const { error } = await supabase.storage
        .from(field.bucket)
        .upload(fileName, optimized.buffer, {
            contentType: optimized.contentType,
            cacheControl: "31536000",
            upsert: false
        });
    if (error) throw error;

    const { data } = supabase.storage.from(field.bucket).getPublicUrl(fileName);
    return { ...optimized, url: data.publicUrl };
}

async function migrateTarget(target, conversionCache, summary) {
    const columns = ["id"].concat(target.fields.map((field) => field.name)).join(",");
    const { data: rows, error } = await supabase.from(target.table).select(columns);
    if (error) throw new Error(target.table + ": " + error.message);

    for (const row of rows || []) {
        const updates = {};
        for (const field of target.fields) {
            const sourceUrl = row[field.name];
            if (!sourceUrl) continue;
            if (isOptimizedWebpUrl(sourceUrl)) {
                summary.skipped += 1;
                continue;
            }

            const cacheKey = field.bucket + ":" + field.preset + ":" + sourceUrl;
            try {
                let converted;
                if (conversionCache.has(cacheKey)) {
                    converted = conversionCache.get(cacheKey);
                } else {
                    converted = await convertSource(sourceUrl, field);
                    conversionCache.set(cacheKey, converted);
                }
                if (!converted) {
                    summary.skipped += 1;
                    continue;
                }

                if (EXECUTE) updates[field.name] = converted.url;
                summary.converted += 1;
                summary.originalBytes += converted.originalBytes;
                summary.optimizedBytes += converted.optimizedBytes;
                console.log(
                    target.table + "." + field.name + " id=" + row.id + ": " +
                    converted.originalBytes + "B -> " + converted.optimizedBytes + "B"
                );
            } catch (error) {
                summary.failed += 1;
                console.error(target.table + "." + field.name + " id=" + row.id + " failed: " + error.message);
            }
        }

        if (EXECUTE && Object.keys(updates).length) {
            const { error } = await supabase.from(target.table).update(updates).eq("id", row.id);
            if (error) throw new Error(target.table + " id=" + row.id + ": " + error.message);
        }
    }
}

async function main() {
    if (!EXECUTE) {
        console.log("Audit mode: storage and database URLs will not be changed. Add --execute to migrate.");
    }

    const summary = { converted: 0, skipped: 0, failed: 0, originalBytes: 0, optimizedBytes: 0 };
    const conversionCache = new Map();
    for (const target of TARGETS) {
        await migrateTarget(target, conversionCache, summary);
    }

    const savedBytes = summary.originalBytes - summary.optimizedBytes;
    const savedPercent = summary.originalBytes
        ? ((savedBytes / summary.originalBytes) * 100).toFixed(1)
        : "0.0";
    console.log(
        "Done: " + summary.converted + " references converted, " +
        summary.skipped + " skipped, " + summary.failed + " failed."
    );
    console.log(
        "Size: " + summary.originalBytes + "B -> " + summary.optimizedBytes +
        "B (" + savedPercent + "% saved)."
    );
    if (summary.failed) process.exitCode = 1;
}

main().catch((error) => {
    console.error("Migration failed:", error.message);
    process.exitCode = 1;
});
