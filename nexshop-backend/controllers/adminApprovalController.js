const supabase = require("../config/db");
const {
    createStoreSettingsApproval,
    getApprovalById,
    applyApprovedRequest,
    rejectRequest
} = require("../services/adminApprovalService");
const { notify } = require("../config/notify");

function isAdmin(role) {
    return role === "admin";
}

function visibleRequest(request, requesterMap, reviewerMap) {
    return {
        id: request.id,
        request_type: request.request_type,
        proposed_changes: request.proposed_changes,
        request_note: request.request_note,
        status: request.status,
        review_note: request.review_note,
        created_at: request.created_at,
        reviewed_at: request.reviewed_at,
        applied_at: request.applied_at,
        requester: requesterMap.get(String(request.requester_id)) || { id: request.requester_id },
        reviewer: request.reviewer_id ? reviewerMap.get(String(request.reviewer_id)) || { id: request.reviewer_id } : null
    };
}

async function attachPeople(requests) {
    const requesterIds = [...new Set(requests.map((item) => item.requester_id).filter(Boolean))];
    const reviewerIds = [...new Set(requests.map((item) => item.reviewed_by).filter(Boolean))];
    const ids = [...new Set([...requesterIds, ...reviewerIds])];
    if (!ids.length) return requests.map((item) => visibleRequest(item, new Map(), new Map()));

    const { data: users, error } = await supabase
        .from("users")
        .select("id, fullname, email, role")
        .in("id", ids);
    if (error) throw error;
    const people = new Map((users || []).map((user) => [String(user.id), user]));
    return requests.map((item) => visibleRequest(item, people, people));
}

exports.list = async (req, res) => {
    try {
        let query = supabase
            .from("admin_approval_requests")
            .select("*")
            .order("created_at", { ascending: false })
            .limit(100);
        if (!isAdmin(req.user.role)) query = query.eq("requester_id", req.user.id);
        if (req.query.status && ["pending", "approved", "rejected"].includes(req.query.status)) {
            query = query.eq("status", req.query.status);
        }
        const { data, error } = await query;
        if (error) return res.status(503).json({ message: "Fitur approval belum siap. Jalankan migration 019 terlebih dahulu.", code: "APPROVAL_SCHEMA_UNAVAILABLE" });
        const requests = await attachPeople(data || []);
        return res.json({ requests, pendingCount: (data || []).filter((item) => item.status === "pending").length });
    } catch (error) {
        console.error("approval list:", error.message);
        return res.status(500).json({ message: "Gagal memuat pengajuan approval." });
    }
};

exports.create = async (req, res) => {
    try {
        const request = await createStoreSettingsApproval({
            requester: req.user,
            payload: req.body?.proposed_changes,
            note: req.body?.request_note
        });
        return res.status(201).json({ message: "Pengajuan berhasil dikirim ke admin.", request: visibleRequest(request, new Map(), new Map()) });
    } catch (error) {
        const status = Number(error.status) || 500;
        if (status === 500) console.error("approval create:", error.message);
        return res.status(status).json({ message: error.message || "Gagal membuat pengajuan approval." });
    }
};

exports.approve = async (req, res) => {
    if (!isAdmin(req.user.role)) return res.status(403).json({ message: "Hanya Admin yang dapat menyetujui pengajuan." });
    try {
        const request = await getApprovalById(req.params.id);
        if (!request) return res.status(404).json({ message: "Pengajuan tidak ditemukan." });
        if (request.status !== "pending") return res.status(409).json({ message: "Pengajuan ini sudah diproses." });
        const approved = await applyApprovedRequest(request, req.user);
        notify("approval", `✅ Approval pengaturan disetujui oleh Admin ${req.user.fullname || req.user.email}. Field: ${Object.keys(request.proposed_changes || {}).join(", ")}`, { recipientRole: "staff" }).catch(() => { });
        return res.json({ message: "Pengajuan disetujui dan pengaturan sudah diterapkan.", request: approved });
    } catch (error) {
        console.error("approval approve:", error.message);
        return res.status(500).json({ message: error.message || "Gagal menyetujui pengajuan." });
    }
};

exports.reject = async (req, res) => {
    if (!isAdmin(req.user.role)) return res.status(403).json({ message: "Hanya Admin yang dapat menolak pengajuan." });
    try {
        const request = await getApprovalById(req.params.id);
        if (!request) return res.status(404).json({ message: "Pengajuan tidak ditemukan." });
        if (request.status !== "pending") return res.status(409).json({ message: "Pengajuan ini sudah diproses." });
        const rejected = await rejectRequest(request, req.user, req.body?.review_note);
        notify("approval", `❌ Pengajuan pengaturan ditolak oleh Admin ${req.user.fullname || req.user.email}.`, { recipientRole: "staff" }).catch(() => { });
        return res.json({ message: "Pengajuan ditolak.", request: rejected });
    } catch (error) {
        console.error("approval reject:", error.message);
        return res.status(500).json({ message: error.message || "Gagal menolak pengajuan." });
    }
};
