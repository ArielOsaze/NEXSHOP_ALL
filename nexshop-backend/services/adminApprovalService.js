const supabase = require("../config/db");
const { updateStoreSettings } = require("../config/settings");
const { notify } = require("../config/notify");

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
    if (!request || request.request_type !== "store_settings") throw new Error("Jenis approval tidak didukung.");
    const proposedChanges = normalizeStoreSettingsPayload(request.proposed_changes);
    const { error: applyError } = await updateStoreSettings(proposedChanges);
    if (applyError) throw applyError;

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
    getApprovalById,
    applyApprovedRequest,
    rejectRequest
};
