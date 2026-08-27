"use strict";

function evaluateAdminOrderAction(order, action) {
    const normalizedAction = String(action || "").trim().toLowerCase();
    const type = order?.orderType;
    const status = String(order?.status || "").toLowerCase();
    const paymentMethod = String(order?.paymentMethod || "").toLowerCase();
    const amount = Number(order?.amount || 0);

    if (!["regular", "topup"].includes(type)) {
        return { allowed: false, code: "INVALID_ORDER_TYPE", message: "Jenis pesanan tidak valid" };
    }
    if (!["cancel", "refund"].includes(normalizedAction)) {
        return { allowed: false, code: "INVALID_ACTION", message: "Aksi pesanan tidak valid" };
    }

    if (normalizedAction === "cancel") {
        const cancellable = type === "topup"
            ? ["pending", "failed"]
            : ["pending", "failed", "expired"];
        if (["cancelled", "refunded"].includes(status)) {
            return { allowed: true, mode: "already_done" };
        }
        if (!cancellable.includes(status)) {
            return { allowed: false, code: "ORDER_NOT_CANCELLABLE", message: "Pesanan sudah diproses atau sudah final sehingga tidak bisa dibatalkan" };
        }
        return { allowed: true, mode: "status_only" };
    }

    if (type !== "topup") {
        return { allowed: false, code: "GATEWAY_REFUND_UNAVAILABLE", message: "Refund order marketplace belum tersedia karena pembayaran gateway belum punya jalur refund terverifikasi" };
    }
    if (["refunded"].includes(status) || order?.refundedAt) {
        return { allowed: true, mode: "already_done" };
    }
    if (!["gagal", "failed", "cancelled"].includes(status)) {
        return { allowed: false, code: "ORDER_NOT_REFUNDABLE", message: "Refund hanya boleh setelah transaksi final gagal atau dibatalkan" };
    }
    if (!["wallet", "reseller_wallet"].includes(paymentMethod)) {
        return { allowed: false, code: "GATEWAY_REFUND_UNAVAILABLE", message: "Pembayaran gateway belum memiliki jalur refund otomatis yang terverifikasi" };
    }
    if (!order?.userId) {
        return { allowed: false, code: "GUEST_REFUND_UNAVAILABLE", message: "Pesanan guest tidak dapat di-refund ke saldo wallet" };
    }
    if (!Number.isFinite(amount) || amount <= 0) {
        return { allowed: false, code: "INVALID_REFUND_AMOUNT", message: "Nominal refund tidak valid" };
    }
    return { allowed: true, mode: "wallet" };
}

module.exports = { evaluateAdminOrderAction };
