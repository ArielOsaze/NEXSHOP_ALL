"use strict";

const supabase = require("../config/db");
const walletService = require("./walletService");
const { evaluateAdminOrderAction } = require("../utils/orderAdminPolicy");

function isDuplicate(error) {
    return String(error?.code || "") === "23505";
}

function isSchemaUnavailable(error) {
    return ["42P01", "42703", "PGRST204", "PGRST205"].includes(String(error?.code || ""));
}

function tableFor(orderType) {
    return orderType === "topup" ? "topup_orders" : "orders";
}

function actionLabel(action) {
    return action === "refund" ? "refund" : "cancel";
}

async function readOrder(orderType, orderId) {
    const { data, error } = await supabase
        .from(tableFor(orderType))
        .select("*")
        .eq("id", orderId)
        .maybeSingle();
    if (error) throw error;
    return data || null;
}

async function claimAction({ orderType, orderId, action, adminUserId, reason, amount }) {
    const row = {
        order_type: orderType,
        order_id: String(orderId),
        action: actionLabel(action),
        status: "started",
        admin_user_id: adminUserId || null,
        reason: reason || null,
        amount: Number(amount) || 0
    };
    const { data, error } = await supabase
        .from("order_admin_actions")
        .insert([row])
        .select()
        .maybeSingle();

    if (!error) return { claimed: true, action: data };
    if (!isDuplicate(error)) throw error;

    const { data: existing, error: existingError } = await supabase
        .from("order_admin_actions")
        .select("*")
        .eq("order_type", orderType)
        .eq("order_id", String(orderId))
        .eq("action", actionLabel(action))
        .maybeSingle();
    if (existingError) throw existingError;
    if (existing?.status === "failed") {
        const { data: retried, error: retryError } = await supabase
            .from("order_admin_actions")
            .update({
                status: "started",
                admin_user_id: adminUserId || null,
                reason: reason || null,
                amount: Number(amount) || 0,
                error_message: null,
                updated_at: new Date().toISOString()
            })
            .eq("id", existing.id)
            .eq("status", "failed")
            .select()
            .maybeSingle();
        if (retryError) throw retryError;
        if (retried) return { claimed: true, action: retried };
    }
    return { claimed: false, action: existing };
}

async function finishAction(id, status, errorMessage = null) {
    const { error } = await supabase
        .from("order_admin_actions")
        .update({ status, error_message: errorMessage, updated_at: new Date().toISOString() })
        .eq("id", id);
    if (error) throw error;
}

async function performAdminOrderAction({ orderType, orderId, action, adminUserId, reason }) {
    const order = await readOrder(orderType, orderId);
    if (!order) return { ok: false, httpStatus: 404, code: "ORDER_NOT_FOUND", message: "Pesanan tidak ditemukan" };

    const policy = evaluateAdminOrderAction({
        orderType,
        status: order.status,
        paymentMethod: order.payment_method,
        userId: order.user_id,
        amount: order.harga ?? order.total,
        refundedAt: order.refunded_at
    }, action);
    if (!policy.allowed) {
        return { ok: false, httpStatus: 409, code: policy.code, message: policy.message };
    }
    if (policy.mode === "already_done") {
        return { ok: true, alreadyDone: true, order };
    }

    const amount = Number(order.harga ?? order.total) || 0;
    let claim;
    try {
        claim = await claimAction({ orderType, orderId, action, adminUserId, reason, amount });
    } catch (error) {
        if (isSchemaUnavailable(error)) {
            return {
                ok: false,
                httpStatus: 503,
                code: "ORDER_ACTION_SCHEMA_UNAVAILABLE",
                message: "Aksi order belum siap. Jalankan migration 021_tokovoucher_contract_and_order_actions.sql terlebih dahulu."
            };
        }
        throw error;
    }
    if (!claim.claimed) {
        if (claim.action?.status === "succeeded") return { ok: true, alreadyDone: true, order, action: claim.action };
        return { ok: false, httpStatus: 409, code: "ACTION_IN_PROGRESS", message: "Aksi admin untuk pesanan ini sedang diproses" };
    }

    try {
        if (action === "refund") {
            const refundResult = await walletService.refundWallet({
                userId: order.user_id,
                amount,
                referenceId: `ADM-${orderType}-${orderId}`,
                refundReferenceId: `RF-ADM-${orderType}-${orderId}`,
                originalOrderId: orderId,
                reason: reason || `Manual refund oleh admin ${adminUserId || ""}`
            });
            const { data: updated, error: updateError } = await supabase
                .from(tableFor(orderType))
                .update({
                    status: "refunded",
                    refunded_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                })
                .eq("id", orderId)
                .in("status", ["gagal", "failed", "cancelled"])
                .select()
                .maybeSingle();
            if (updateError) throw updateError;
            if (!updated) throw new Error("Status pesanan berubah sebelum refund selesai");
            await finishAction(claim.action.id, "succeeded");
            return { ok: true, order: updated, refund: refundResult, action: claim.action };
        }

        const { data: updated, error: updateError } = await supabase
            .from(tableFor(orderType))
            .update({
                status: "cancelled",
                updated_at: new Date().toISOString()
            })
            .eq("id", orderId)
            .in("status", orderType === "topup" ? ["pending", "failed"] : ["pending", "failed", "expired"])
            .select()
            .maybeSingle();
        if (updateError) throw updateError;
        if (!updated) throw new Error("Status pesanan berubah sebelum pembatalan selesai");
        await finishAction(claim.action.id, "succeeded");
        return { ok: true, order: updated, action: claim.action };
    } catch (error) {
        try { await finishAction(claim.action.id, "failed", error.message); } catch (_) { /* preserve original error */ }
        throw error;
    }
}

module.exports = { performAdminOrderAction };
