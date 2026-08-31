"use strict";

const {
    cleanProductName,
    hitungMarkupWajar,
    isCheckerUtilityProduct,
    isForeignProduct
} = require("../utils/topupHelpers");
const { hitungHargaReseller } = require("../utils/resellerPricing");

const PORTAL_PRODUCT_COLUMNS = [
    "id",
    "nama",
    "kode_produk",
    "kategori",
    "source_operator_name",
    "harga_beli",
    "harga_jual",
    "butuh_server_id",
    "is_active",
    "source_status",
    "operator_logo",
    "item_icon"
].join(", ");

function isSellablePortalProduct(product) {
    if (!product || product.is_active !== true) return false;
    if (product.source_status && String(product.source_status).toLowerCase() !== "active") return false;
    if (isForeignProduct(product.kategori, product.kode_produk, product.nama)) return false;
    if (isCheckerUtilityProduct(product.nama)) return false;
    return true;
}

function filterSellablePortalProducts(products) {
    return (products || []).filter(isSellablePortalProduct);
}

function formatPortalProduct(product, resellerContext) {
    let hargaNormal = Number(product.harga_jual) || 0;
    if (hargaNormal <= 0) {
        hargaNormal = hitungMarkupWajar(product.harga_beli || 0, product.kategori, product.source_operator_name);
    }

    const isReseller = Boolean(resellerContext?.isReseller);
    const discountPercent = isReseller ? Number(resellerContext.discountPercent) || 0 : 0;
    const calculated = hitungHargaReseller(hargaNormal, product.harga_beli || 0, discountPercent);

    return {
        id: product.id,
        kode_produk: product.kode_produk,
        nama: cleanProductName(product.nama),
        kategori: product.kategori,
        operator: product.source_operator_name || product.kategori,
        harga_normal: calculated.harga_normal,
        harga_modal_reseller: calculated.harga,
        diskon_persen: discountPercent,
        hemat: calculated.hemat,
        persen_efektif: calculated.persen_efektif,
        kena_lantai_margin: calculated.kena_lantai,
        butuh_server_id: Boolean(product.butuh_server_id),
        status: "tersedia",
        operator_logo: product.operator_logo || null,
        item_icon: product.item_icon || null
    };
}

function filterPortalProducts(products, { q = "", kategori = "all", operator = "all" } = {}) {
    const query = String(q || "").trim().toLowerCase();
    const category = String(kategori || "all").trim().toLowerCase();
    const operatorName = String(operator || "all").trim().toLowerCase();

    return (products || []).filter((product) => {
        const productCategory = String(product.kategori || "").trim().toLowerCase();
        const productOperator = String(product.operator || product.kategori || "").trim().toLowerCase();
        const matchesCategory = category === "all" || productCategory === category;
        const matchesOperator = operatorName === "all" || productOperator === operatorName;
        const haystack = [product.kode_produk, product.nama, product.operator, product.kategori]
            .map((value) => String(value || "").toLowerCase())
            .join(" ");
        return matchesCategory && matchesOperator && (!query || haystack.includes(query));
    });
}

function paginatePortalProducts(products, { page = 1, limit = 250 } = {}) {
    const safeLimit = Math.min(250, Math.max(1, Number(limit) || 250));
    const safePage = Math.max(1, Number(page) || 1);
    const start = (safePage - 1) * safeLimit;
    const items = (products || []).slice(start, start + safeLimit);
    const total = (products || []).length;

    return {
        page: safePage,
        limit: safeLimit,
        total,
        total_pages: Math.ceil(total / safeLimit),
        has_more: start + items.length < total,
        items
    };
}

function buildPortalFacets(products) {
    const categories = new Map();
    const operators = new Map();
    (products || []).forEach((product) => {
        const category = String(product.kategori || "Lainnya").trim() || "Lainnya";
        const operator = String(product.operator || category).trim() || category;
        categories.set(category, (categories.get(category) || 0) + 1);
        operators.set(operator, (operators.get(operator) || 0) + 1);
    });
    return {
        categories: [...categories.entries()].sort((a, b) => a[0].localeCompare(b[0], "id-ID")).map(([name, count]) => ({ name, count })),
        operators: [...operators.entries()].sort((a, b) => a[0].localeCompare(b[0], "id-ID")).map(([name, count]) => ({ name, count }))
    };
}

module.exports = {
    PORTAL_PRODUCT_COLUMNS,
    isSellablePortalProduct,
    filterSellablePortalProducts,
    formatPortalProduct,
    filterPortalProducts,
    paginatePortalProducts,
    buildPortalFacets
};
