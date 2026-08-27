"use strict";

const CONTRACT_VERSION = "tokovoucher-v1";

function lower(value) {
    return String(value || "").trim().toLowerCase();
}

function normalizeFormatForm(value) {
    const normalized = String(value == null ? "" : value).trim();
    return ["1", "2", "3"].includes(normalized) ? normalized : null;
}

function isGameProduct(product) {
    const values = [product?.kategori, product?.source_category_name, product?.source_jenis_name]
        .map(lower)
        .filter(Boolean);
    const nameValues = [product?.nama, product?.source_operator_name, product?.operator_nama]
        .map(lower)
        .filter(Boolean);
    const categoryIsGame = values.some((value) => /topup\s*game|game\s*topup|voucher\s*game|game\s*voucher|game\s*pass|gamepass|^gaming$|^games?$/.test(value));
    const explicitlyNamedGamePass = nameValues.some((value) => /\bgame\s*pass\b|\bgamepass\b/.test(value));
    return categoryIsGame || explicitlyNamedGamePass;
}

function getProductAdminCategory(product) {
    return isGameProduct(product) ? "orders" : "catalog-sales";
}

function isGameVoucher(product) {
    const categoryValues = [product?.kategori, product?.source_category_name, product?.source_jenis_name]
        .map(lower)
        .filter(Boolean);
    const nameValues = [product?.nama, product?.source_operator_name, product?.operator_nama]
        .map(lower)
        .filter(Boolean);

    if (categoryValues.some((value) => /voucher\s*game|game\s*voucher/.test(value))) return true;

    // Beberapa hasil sync lama menyimpan Voucher Game sebagai kategori
    // "Gaming". Gunakan nama/operator hanya sebagai fallback bila konteks
    // kategorinya memang game, agar Voucher Pulsa/Data tidak ikut berubah.
    const gamingContext = categoryValues.some((value) => /topup\s*game|game\s*topup|^gaming$|^games?$/.test(value));
    return gamingContext && nameValues.some((value) => /\bvoucher\b/.test(value));
}

function isBankTransfer(product) {
    const values = [product?.kode_produk, product?.nama, product?.source_operator_name]
        .map(lower)
        .filter(Boolean);
    return values.some((value) => value.includes("tfbank") || value.includes("transfer bank") || value.includes("transfer dana"));
}

function inferTarget(product, formatForm) {
    if (isGameVoucher(product)) {
        // TokoVoucher tetap mewajibkan parameter `tujuan` pada transaksi.
        // Untuk voucher/game-code, tujuan bukan Player ID: gunakan nomor HP
        // penerima/notifikasi dan sembunyikan field Player ID dari customer.
        return {
            kind: "recipient_phone",
            source: "recipient_phone",
            visible: false,
            required: false,
            supplier_required: true,
            label: "Nomor HP Penerima Voucher",
            placeholder: "08xxxxxxxxxx",
            result_label: "Voucher Game"
        };
    }

    if (isGameProduct(product)) {
        return {
            kind: "player_id",
            source: "tujuan",
            visible: true,
            required: true,
            supplier_required: true,
            label: "Player ID / User ID",
            placeholder: "Masukkan Player ID",
            result_label: "Player ID / User ID"
        };
    }

    if (isBankTransfer(product)) {
        return {
            kind: "bank_account",
            source: "tujuan",
            visible: true,
            required: true,
            supplier_required: true,
            label: "Nomor Rekening",
            placeholder: "Masukkan Nomor Rekening Tujuan",
            result_label: "Nomor Rekening"
        };
    }

    const category = lower(product?.kategori || product?.source_category_name);
    if (category === "pln" || category === "tagihan" || /pascabayar/.test(category)) {
        return {
            kind: "customer_id",
            source: "tujuan",
            visible: true,
            required: true,
            supplier_required: true,
            label: category === "pln" ? "ID Pelanggan PLN" : "ID Pelanggan / Nomor Tujuan",
            placeholder: category === "pln" ? "Masukkan ID Pelanggan PLN" : "Masukkan ID Pelanggan",
            result_label: "ID Pelanggan"
        };
    }

    if (category === "pulsa" || category === "paket data" || category === "voucher data" || category === "e-wallet" || category === "e-money") {
        return {
            kind: "phone",
            source: "tujuan",
            visible: true,
            required: true,
            supplier_required: true,
            label: category === "e-wallet" || category === "e-money" ? "Nomor HP / Akun E-Wallet Tujuan" : "Nomor HP Tujuan",
            placeholder: "08xxxxxxxxxx",
            result_label: "Nomor Tujuan"
        };
    }

    if (category === "hiburan" || /voucher/.test(category)) {
        return {
            kind: "recipient_phone",
            source: "recipient_phone",
            visible: false,
            required: false,
            supplier_required: true,
            label: "Nomor HP Penerima",
            placeholder: "08xxxxxxxxxx",
            result_label: "Penerima Voucher"
        };
    }

    return {
        kind: "custom",
        source: "tujuan",
        visible: true,
        required: true,
        supplier_required: true,
        label: "Data Tujuan Produk",
        placeholder: "Masukkan data tujuan sesuai instruksi produk",
        result_label: "Data Tujuan"
    };
}

function getProductContract(product = {}) {
    const formatForm = normalizeFormatForm(
        product.source_format_form ?? product.jenis_format_form ?? product.format_form
    );
    const target = inferTarget(product, formatForm);

    // format_form=2 adalah sinyal resmi jenis produk TokoVoucher yang
    // membutuhkan server_id. Jika metadata resmi tersedia, jangan menimpa
    // keputusan ini dengan heuristic nama game atau toggle lama.
    const explicitServerRequirement = Boolean(product.source_requires_server_id ?? product.butuh_server_id);
    // Legacy rows may have server=true solely because the old code inferred
    // it from the operator name. Voucher Game must not inherit that heuristic.
    const requiresServerId = formatForm
        ? (formatForm === "2" || isBankTransfer(product))
        : (isBankTransfer(product) || (!isGameVoucher(product) && explicitServerRequirement));

    const server = {
        kind: "server_id",
        visible: requiresServerId,
        required: requiresServerId,
        supplier_required: requiresServerId,
        label: isBankTransfer(product) ? "Bank ID / Kode Bank" : "Server ID",
        placeholder: isBankTransfer(product) ? "Pilih Bank ID" : "Masukkan Server ID"
    };

    return {
        version: CONTRACT_VERSION,
        format_form: formatForm,
        order_category: getProductAdminCategory(product),
        review_required: formatForm === "3" || target.kind === "custom",
        target,
        server_id: server
    };
}

function buildSupplierTransactionInput(contract, values = {}) {
    if (!contract || !contract.target) throw new Error("Kontrak produk tidak tersedia");

    const targetValue = contract.target.source === "recipient_phone"
        ? String(values.recipient_phone || "").trim()
        : String(values.tujuan || "").trim();
    if (contract.target.supplier_required && !targetValue) {
        throw new Error(contract.target.source === "recipient_phone"
            ? "Nomor HP penerima voucher wajib tersedia"
            : `${contract.target.label} wajib diisi`);
    }

    const serverValue = String(values.server_id || "").trim();
    if (contract.server_id.required && !serverValue) {
        throw new Error(`${contract.server_id.label} wajib diisi`);
    }

    const payload = {
        produk: String(values.kode_produk || "").trim(),
        tujuan: targetValue
    };
    if (!payload.produk) throw new Error("Kode produk wajib diisi");
    if (serverValue) payload.server_id = serverValue;
    return payload;
}

module.exports = {
    CONTRACT_VERSION,
    getProductContract,
    getProductAdminCategory,
    buildSupplierTransactionInput,
    isGameProduct,
    isGameVoucher
};
