const supabase = require("../config/db");
const { updateStoreSettings } = require("../config/settings");
const { notify } = require("../config/notify");
const walletService = require("./walletService");

const APPROVABLE_STORE_FIELDS = Object.freeze([
    "store_name",
    "tagline",
    "contact_whatsapp",
    "contact_phone",
    "contact_email",
    "contact_instagram",
    "address",
    "trust_bar_enabled",
    "trust_bar_orders_offset",
    "trust_bar_games_offset",
    "ticker_text",
    "ticker_speed_seconds",
    "faq",
    "terms_content",
    "refund_content",
    "event_mascot"
]);

function normalizeStoreSettingsPayload(payload = {}) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("Data pengaturan tidak valid.");
    }

    const result = {};
    for (const field of APPROVABLE_STORE_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(payload, field)) continue;
        const value = payload[field];
        if (typeof value === "string" && value.length > 12000) {
            throw new Error(`Field ${field} terlalu panjang.`);
        }
        if (["faq", "event_mascot"].includes(field) && value !== null && typeof value !== "object") {
            throw new Error(`Field ${field} harus berupa objek atau array.`);
        }
        if (["trust_bar_orders_offset", "trust_bar_games_offset", "ticker_speed_seconds"].includes(field)) {
            const numberValue = Number(value);
            if (!Number.isInteger(numberValue) || numberValue < 0 || numberValue > 10000000) {
                throw new Error(`Nilai ${field} tidak valid.`);
            }
            result[field] = numberValue;
            continue;
        }
        if (field === "trust_bar_enabled") {
            if (typeof value !== "boolean") throw new Error("Nilai trust_bar_enabled tidak valid.");
            result[field] = value;
            continue;
        }
        result[field] = value;
    }

    if (!Object.keys(result).length) throw new Error("Tidak ada perubahan pengaturan yang diajukan.");
    return result;
}

function summarizeChanges(payload) {
    return Object.keys(payload).join(", ");
}

async function createStoreSettingsApproval({ requester, payload, note }) {
    if (!requester || requester.role !== "staff") {
        const error = new Error("Hanya staff yang dapat mengajukan approval.");
        error.status = 403;
        throw error;
    }

    const proposedChanges = normalizeStoreSettingsPayload(payload);
    const { data, error } = await supabase
        .from("admin_approval_requests")
        .insert([{
            requester_id: requester.id,
            request_type: "store_settings",
            proposed_changes: proposedChanges,
            request_note: String(note || "").trim().slice(0, 1000) || null,
            status: "pending"
        }])
        .select("*")
        .single();

    if (error) {
        if (error.code === "23505") {
            const duplicate = new Error("Masih ada pengajuan pengaturan yang menunggu approval admin.");
            duplicate.status = 409;
            throw duplicate;
        }
        throw error;
    }

    const displayName = String(requester.fullname || requester.email || "Staff").trim().slice(0, 100);
    const email = String(requester.email || "tidak tersedia").trim().slice(0, 160);
    const message = `🛂 *Approval Pengaturan Baru*\n\nStaff: ${displayName}\nEmail: ${email}\nField: ${summarizeChanges(proposedChanges)}\nCatatan: ${String(note || "-").trim().slice(0, 500) || "-"}\n\nBuka Dashboard > Approval untuk meninjau.`;
    notify("approval", message, { recipientRole: "admin" }).catch((notifyError) => {
        console.log("Gagal mengirim notif approval:", notifyError.message);
    });

    return data;
}

async function createWalletAdjustmentApproval({ requester, payload, note }) {
    if (!requester || requester.role !== "staff") {
        const error = new Error("Hanya staff yang dapat mengajukan approval.");
        error.status = 403;
        throw error;
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("Data penyesuaian wallet tidak valid.");
    }
    const userId = Number(payload.user_id);
    const amount = Number(payload.amount);
    const direction = String(payload.direction || "").toUpperCase();
    const reason = String(payload.reason || "").trim().slice(0, 500);
    if (!Number.isSafeInteger(userId) || userId <= 0 || !Number.isFinite(amount) || amount <= 0 || amount > 1000000000 || !["IN", "OUT"].includes(direction) || reason.length < 5) {
        throw new Error("user_id, amount, direction, dan reason penyesuaian wallet wajib valid.");
    }

    const proposedChanges = { user_id: userId, amount, direction, reason };
    const { data, error } = await supabase
        .from("admin_approval_requests")
        .insert([{
            requester_id: requester.id,
            request_type: "wallet_adjustment",
            proposed_changes: proposedChanges,
            request_note: String(note || "").trim().slice(0, 1000) || null,
            status: "pending"
        }])
        .select("*")
        .single();
    if (error) {
        if (error.code === "23505") {
            const duplicate = new Error("Masih ada pengajuan wallet yang menunggu approval admin.");
            duplicate.status = 409;
            throw duplicate;
        }
        throw error;
    }

    notify("approval", `🛂 *Approval Penyesuaian Wallet Baru*\\n\\nStaff: ${String(requester.fullname || requester.email || "Staff").slice(0, 100)}\\nTarget user ID: ${userId}\\nArah: ${direction}\\nNominal: ${amount}\\nAlasan: ${reason}\\n\\nBuka Dashboard > Approval untuk meninjau.`, { recipientRole: "admin" }).catch((notifyError) => {
        console.log("Gagal mengirim notif approval wallet:", notifyError.message);
    });
    return data;
}

async function normalizeWalletApprovalPayload(payload) {
    const candidate = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
    const userId = Number(candidate.user_id);
    const amount = Number(candidate.amount);
    const direction = String(candidate.direction || "").toUpperCase();
    const reason = String(candidate.reason || "").trim().slice(0, 500);
    if (!Number.isSafeInteger(userId) || userId <= 0 || !Number.isFinite(amount) || amount <= 0 || amount > 1000000000 || !["IN", "OUT"].includes(direction) || reason.length < 5) {
        throw new Error("Data penyesuaian wallet tidak valid.");
    }
    return { userId, amount, direction, reason };
}

async function getApprovalById(id) {
    const { data, error } = await supabase
        .from("admin_approval_requests")
        .select("*")
        .eq("id", id)
        .maybeSingle();
    if (error) throw error;
    return data;
}

async function applyApprovedRequest(request, reviewer) {
    if (!request || !["store_settings", "wallet_adjustment"].includes(request.request_type)) throw new Error("Jenis approval tidak didukung.");
    if (request.request_type === "wallet_adjustment") {
        const { userId, amount, direction, reason } = await normalizeWalletApprovalPayload(request.proposed_changes);
        const referenceId = `APPROVAL-WALLET-${request.id}`;
        const mutation = direction === "IN"
            ? walletService.creditWallet({
                userId,
                type: "ADMIN_ADJUSTMENT",
                amount,
                referenceId,
                description: `Penyesuaian saldo melalui approval Admin: ${reason}`,
                metadata: { approval_id: request.id, requester_id: request.requester_id, reviewer_id: reviewer.id, reason }
            })
            : walletService.debitWallet({
                userId,
                type: "ADMIN_ADJUSTMENT",
                amount,
                referenceId,
                description: `Pengurangan saldo melalui approval Admin: ${reason}`,
                metadata: { approval_id: request.id, requester_id: request.requester_id, reviewer_id: reviewer.id, reason }
            });
        await mutation;
    } else {
        const proposedChanges = normalizeStoreSettingsPayload(request.proposed_changes);
        const { error: applyError } = await updateStoreSettings(proposedChanges);
        if (applyError) throw applyError;
    }

    const { data, error } = await supabase
        .from("admin_approval_requests")
        .update({
            status: "approved",
            reviewed_by: reviewer.id,
            reviewed_at: new Date().toISOString(),
            applied_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        })
        .eq("id", request.id)
        .eq("status", "pending")
        .select("*")
        .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Approval sudah diproses oleh admin lain.");
    return data;
}

async function rejectRequest(request, reviewer, reviewNote) {
    const { data, error } = await supabase
        .from("admin_approval_requests")
        .update({
            status: "rejected",
            reviewed_by: reviewer.id,
            review_note: String(reviewNote || "").trim().slice(0, 1000) || null,
            reviewed_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        })
        .eq("id", request.id)
        .eq("status", "pending")
        .select("*")
        .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Approval sudah diproses oleh admin lain.");
    return data;
}

module.exports = {
    APPROVABLE_STORE_FIELDS,
    normalizeStoreSettingsPayload,
    summarizeChanges,
    createStoreSettingsApproval,
    createWalletAdjustmentApproval,
    getApprovalById,
    applyApprovedRequest,
    rejectRequest
};
