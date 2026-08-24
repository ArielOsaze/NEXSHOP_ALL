"use strict";

function normalisasiIdProduk(value) {
    return String(value == null ? "" : value).trim();
}

function cariProdukTumpangTindih(items, requestedProductIds) {
    const diminta = new Set((requestedProductIds || []).map(normalisasiIdProduk).filter(Boolean));
    if (!diminta.size) return [];

    const ditemukan = new Set();
    for (const item of Array.isArray(items) ? items : []) {
        const id = normalisasiIdProduk(item && item.id);
        if (id && diminta.has(id)) ditemukan.add(id);
    }
    return [...ditemukan];
}

async function cariCheckoutProdukPending(supabase, userId, requestedProductIds) {
    if (!userId) return null;

    const { data, error } = await supabase
        .from("orders")
        .select("id, items, created_at")
        .eq("user_id", userId)
        .eq("status", "pending")
        .order("created_at", { ascending: false });

    if (error) throw error;

    for (const order of data || []) {
        const productIds = cariProdukTumpangTindih(order.items, requestedProductIds);
        if (productIds.length) return { ...order, product_ids: productIds };
    }
    return null;
}

async function cariCheckoutTopupPending(supabase, userId, kodeProduk) {
    if (!userId || !kodeProduk) return null;

    const { data, error } = await supabase
        .from("topup_orders")
        .select("id, kode_produk, nama_produk, created_at")
        .eq("user_id", userId)
        .eq("kode_produk", kodeProduk)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) throw error;
    return data || null;
}

function responsCheckoutPending(order, namaProduk) {
    const nama = String(namaProduk || order?.nama_produk || "produk ini").trim();
    return {
        code: "DUPLICATE_PENDING_CHECKOUT",
        message: `Anda masih memiliki pembayaran yang belum diselesaikan untuk ${nama} (Order ${order.id}). Selesaikan pembayaran tersebut atau tunggu hingga statusnya kedaluwarsa sebelum checkout produk yang sama.`,
        existing_order_id: order.id
    };
}

module.exports = {
    cariCheckoutProdukPending,
    cariCheckoutTopupPending,
    cariProdukTumpangTindih,
    responsCheckoutPending
};
