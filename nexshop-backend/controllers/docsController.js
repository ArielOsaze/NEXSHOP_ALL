"use strict";

const { getResellerDocsPdf } = require("../services/seoThumbnailService");

exports.downloadResellerPdf = async (_req, res) => {
    try {
        const result = await getResellerDocsPdf();
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", 'attachment; filename="NexShop-API-Reseller.pdf"');
        res.setHeader("Cache-Control", "public, max-age=300");
        res.setHeader("X-NexShop-PDF-Cache", result.status);
        return res.send(result.buffer);
    } catch (error) {
        console.error("Gagal membuat PDF dokumentasi reseller:", error.message);
        return res.status(503).json({
            message: "PDF dokumentasi belum dapat dibuat. Pastikan Chrome/Chromium backend sudah dikonfigurasi.",
            code: "DOCS_PDF_UNAVAILABLE"
        });
    }
};
