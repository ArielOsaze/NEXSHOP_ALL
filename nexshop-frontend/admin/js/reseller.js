// ===========================================================
// PANEL RESELLER (dashboard admin)
//
// Dipisah dari dashboard.js karena file itu udah kelewat besar. Semua
// pemanggilan API lewat apiFetch() milik dashboard.js, jadi gerbang akses
// (verifikasi role + Security PIN) dan batas sesi idle otomatis berlaku
// di sini juga.
//
// Catatan penting soal harga: file ini CUMA ngatur persen diskon per
// tingkatan. Perhitungan harga resellernya sendiri ada di server
// (utils/resellerPricing.js) dan selalu dijaga supaya gak pernah turun di
// bawah harga modal -- jadi menaikkan persen di sini gak bisa bikin produk
// kejual rugi.
// ===========================================================

let resellerTiers = [];
let resellerLoaded = false;

function rsPersen(nilai) {
    return `${Number(nilai || 0).toFixed(2).replace(/\.?0+$/, "")}%`;
}

function rsTanggal(nilai) {
    if (!nilai) return "-";
    return new Date(nilai).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

// Tabel reseller belum dibuat (migration 008 belum dijalankan). Backend
// balas 503 + code RESELLER_NOT_SETUP -- ditampilkan sebagai peringatan
// yang menjelaskan langkahnya, bukan toast error yang bikin bingung.
function rsTampilkanSetupWarning(pesan) {
    const box = document.getElementById("resellerSetupWarning");
    const teks = document.getElementById("resellerSetupWarningText");
    if (!box || !teks) return;
    teks.textContent = pesan || "Fitur reseller belum di-setup di database.";
    box.classList.remove("d-none");
}

function rsSembunyikanSetupWarning() {
    document.getElementById("resellerSetupWarning")?.classList.add("d-none");
}

async function rsFetch(path, options) {
    const res = await apiFetch(path, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        if (data.code === "RESELLER_NOT_SETUP") {
            rsTampilkanSetupWarning(data.message);
            const err = new Error(data.message || "Fitur reseller belum di-setup");
            err.notSetup = true;
            throw err;
        }
        throw new Error(data.message || "Permintaan gagal");
    }
    return data;
}

// ── Tingkatan ────────────────────────────────────────────────────────
async function loadResellerTiers() {
    const body = document.getElementById("resellerTiersBody");
    if (!body) return;

    try {
        resellerTiers = await rsFetch("/reseller/admin/tiers");
        rsSembunyikanSetupWarning();

        body.innerHTML = resellerTiers.map((t) => `
            <tr data-tier="${escapeHtml(t.code)}">
                <td class="fw-semibold">${escapeHtml(t.name)}<div class="text-muted small">${escapeHtml(t.code)}</div></td>
                <td>
                    <input type="number" class="form-control form-control-sm" min="0" max="30" step="0.25"
                        value="${Number(t.discount_percent)}" id="rsTierPercent-${escapeHtml(t.code)}">
                </td>
                <td><input type="text" class="form-control form-control-sm" maxlength="200"
                        value="${escapeHtml(t.description || "")}" id="rsTierDesc-${escapeHtml(t.code)}"></td>
                <td><span class="badge bg-secondary">${t.jumlah_reseller || 0}</span></td>
                <td>
                    <div class="form-check form-switch mb-0">
                        <input class="form-check-input" type="checkbox" id="rsTierActive-${escapeHtml(t.code)}" ${t.is_active ? "checked" : ""}>
                    </div>
                </td>
                <td class="text-end">
                    <button class="btn btn-sm btn-primary" onclick="simpanResellerTier('${escapeHtml(t.code)}')">Simpan</button>
                </td>
            </tr>
        `).join("");

        const tertinggi = resellerTiers.filter((t) => t.is_active).reduce((max, t) => Math.max(max, Number(t.discount_percent) || 0), 0);
        document.getElementById("rsStatDiskon").textContent = tertinggi ? rsPersen(tertinggi) : "-";
    } catch (err) {
        if (err.message === "unauthorized") return;
        body.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-3">${escapeHtml(err.message)}</td></tr>`;
    }
}

async function simpanResellerTier(code) {
    const persen = document.getElementById(`rsTierPercent-${code}`).value;
    const deskripsi = document.getElementById(`rsTierDesc-${code}`).value;
    const aktif = document.getElementById(`rsTierActive-${code}`).checked;

    try {
        const data = await rsFetch(`/reseller/admin/tiers/${encodeURIComponent(code)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ discount_percent: Number(persen), description: deskripsi, is_active: aktif })
        });
        showToast(data.message || "Tingkatan diperbarui");
        loadResellerTiers();
    } catch (err) {
        if (err.message === "unauthorized" || err.notSetup) return;
        showToast(err.message, true);
    }
}

// ── Pengajuan ────────────────────────────────────────────────────────
async function loadResellerApplications() {
    const body = document.getElementById("resellerAppBody");
    if (!body) return;
    const filter = document.getElementById("resellerAppFilter")?.value ?? "pending";

    body.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-3"><span class="spinner-border spinner-border-sm"></span></td></tr>`;

    try {
        const rows = await rsFetch(`/reseller/admin/applications${filter ? `?status=${encodeURIComponent(filter)}` : ""}`);
        rsSembunyikanSetupWarning();

        document.getElementById("rsStatPending").textContent =
            filter === "pending" ? rows.length : document.getElementById("rsStatPending").textContent;

        if (!rows.length) {
            body.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">Belum ada pengajuan di kategori ini.</td></tr>`;
            return;
        }

        const opsiTier = resellerTiers
            .filter((t) => t.is_active)
            .map((t) => `<option value="${escapeHtml(t.code)}">${escapeHtml(t.name)} (${rsPersen(t.discount_percent)})</option>`)
            .join("");

        body.innerHTML = rows.map((a) => {
            const waHref = `https://wa.me/${String(a.whatsapp || "").replace(/\D/g, "")}`;
            const aksi = a.status === "pending"
                ? `
                    <div class="d-flex flex-column gap-1">
                        <select class="form-select form-select-sm" id="rsAppTier-${a.id}">
                            ${opsiTier || `<option value="">Tidak ada tingkatan aktif</option>`}
                        </select>
                        <div class="d-flex gap-1">
                            <button class="btn btn-sm btn-success flex-grow-1" onclick="putusanReseller('${a.id}', 'approve')" ${opsiTier ? "" : "disabled"}>
                                <i class="bi bi-check-lg"></i> Setujui
                            </button>
                            <button class="btn btn-sm btn-outline-danger" onclick="putusanReseller('${a.id}', 'reject')">Tolak</button>
                        </div>
                    </div>`
                : `<span class="badge ${a.status === "approved" ? "bg-success" : "bg-secondary"}">${a.status === "approved" ? "Disetujui" : "Ditolak"}</span>
                   ${a.reviewed_by ? `<div class="text-muted small mt-1">oleh ${escapeHtml(a.reviewed_by)}</div>` : ""}
                   ${a.admin_note ? `<div class="text-muted small">"${escapeHtml(a.admin_note)}"</div>` : ""}`;

            return `
                <tr>
                    <td>
                        <div class="fw-semibold">${escapeHtml(a.fullname)}</div>
                        <div class="text-muted small">${escapeHtml(a.email || "-")}</div>
                        ${a.store_name ? `<div class="text-muted small"><i class="bi bi-shop me-1"></i>${escapeHtml(a.store_name)}</div>` : ""}
                    </td>
                    <td><a href="${waHref}" target="_blank" rel="noopener" class="text-decoration-none">
                        <i class="bi bi-whatsapp text-success me-1"></i>${escapeHtml(a.whatsapp)}</a></td>
                    <td>
                        <div>${escapeHtml(a.channel || "-")}</div>
                        <div class="text-muted small">${escapeHtml(a.monthly_estimate || "-")}</div>
                    </td>
                    <td class="small" style="max-width:220px;">${escapeHtml(a.note || "-")}</td>
                    <td class="small text-muted">${rsTanggal(a.created_at)}</td>
                    <td>${aksi}</td>
                </tr>
            `;
        }).join("");
    } catch (err) {
        if (err.message === "unauthorized") return;
        body.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-3">${escapeHtml(err.message)}</td></tr>`;
    }
}

async function putusanReseller(id, action) {
    let tierCode = "";
    let adminNote = "";

    if (action === "approve") {
        tierCode = document.getElementById(`rsAppTier-${id}`)?.value || "";
        if (!tierCode) return showToast("Pilih tingkatan dulu", true);
        const tier = resellerTiers.find((t) => t.code === tierCode);
        if (!confirm(`Setujui pemohon ini sebagai reseller ${tier ? tier.name : tierCode} (diskon ${rsPersen(tier?.discount_percent)})?`)) return;
    } else {
        const alasan = prompt("Alasan penolakan (opsional, akan terlihat oleh pemohon):", "");
        if (alasan === null) return; // batal
        adminNote = alasan.trim();
    }

    try {
        const data = await rsFetch(`/reseller/admin/applications/${encodeURIComponent(id)}/decision`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action, tier_code: tierCode, admin_note: adminNote })
        });
        showToast(data.message || "Pengajuan diproses");
        loadResellerAll();
    } catch (err) {
        if (err.message === "unauthorized" || err.notSetup) return;
        showToast(err.message, true);
    }
}

// ── Reseller terdaftar ───────────────────────────────────────────────
async function loadResellerList() {
    const body = document.getElementById("resellerListBody");
    if (!body) return;

    try {
        const rows = await rsFetch("/reseller/admin/resellers");
        rsSembunyikanSetupWarning();

        document.getElementById("rsStatAktif").textContent = rows.filter((r) => r.reseller_status === "approved").length;
        document.getElementById("rsStatBeku").textContent = rows.filter((r) => r.reseller_status === "suspended").length;

        if (!rows.length) {
            body.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">Belum ada reseller terdaftar.</td></tr>`;
            return;
        }

        body.innerHTML = rows.map((r) => {
            const opsi = resellerTiers
                .map((t) => `<option value="${escapeHtml(t.code)}" ${r.reseller_tier === t.code ? "selected" : ""}>${escapeHtml(t.name)} (${rsPersen(t.discount_percent)})</option>`)
                .join("");
            const dibekukan = r.reseller_status === "suspended";
            return `
                <tr>
                    <td class="fw-semibold">${escapeHtml(r.fullname || "-")}</td>
                    <td class="small">${escapeHtml(r.email || "-")}</td>
                    <td><select class="form-select form-select-sm" id="rsUserTier-${r.id}">${opsi}</select></td>
                    <td class="small text-muted">${rsTanggal(r.reseller_since)}</td>
                    <td><span class="badge ${dibekukan ? "bg-warning text-dark" : "bg-success"}">${dibekukan ? "Dibekukan" : "Aktif"}</span></td>
                    <td>
                        <div class="d-flex gap-1 flex-wrap">
                            <button class="btn btn-sm btn-primary" onclick="simpanTierReseller('${r.id}')">Simpan tier</button>
                            <button class="btn btn-sm btn-outline-${dibekukan ? "success" : "warning"}"
                                onclick="ubahStatusReseller('${r.id}', '${dibekukan ? "approved" : "suspended"}')">
                                ${dibekukan ? "Aktifkan" : "Bekukan"}
                            </button>
                            <button class="btn btn-sm btn-outline-danger" onclick="ubahStatusReseller('${r.id}', 'none')">Cabut</button>
                        </div>
                    </td>
                </tr>
            `;
        }).join("");
    } catch (err) {
        if (err.message === "unauthorized") return;
        body.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-3">${escapeHtml(err.message)}</td></tr>`;
    }
}

async function simpanTierReseller(id) {
    const tierCode = document.getElementById(`rsUserTier-${id}`)?.value;
    if (!tierCode) return;
    try {
        const data = await rsFetch(`/reseller/admin/resellers/${encodeURIComponent(id)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tier_code: tierCode })
        });
        showToast(data.message || "Tingkatan reseller diperbarui");
        loadResellerList();
    } catch (err) {
        if (err.message === "unauthorized" || err.notSetup) return;
        showToast(err.message, true);
    }
}

async function ubahStatusReseller(id, status) {
    const pesan = {
        approved: "Aktifkan kembali reseller ini?",
        suspended: "Bekukan reseller ini? Harga khususnya langsung berhenti berlaku.",
        none: "Cabut status reseller ini sepenuhnya? Dia balik jadi pembeli biasa."
    };
    if (!confirm(pesan[status] || "Ubah status reseller ini?")) return;

    try {
        const data = await rsFetch(`/reseller/admin/resellers/${encodeURIComponent(id)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status })
        });
        showToast(data.message || "Status reseller diperbarui");
        loadResellerList();
    } catch (err) {
        if (err.message === "unauthorized" || err.notSetup) return;
        showToast(err.message, true);
    }
}

// Tingkatan dimuat DULUAN karena dropdown di dua tabel lain butuh daftarnya.
async function loadResellerAll() {
    await loadResellerTiers();
    await Promise.all([loadResellerApplications(), loadResellerList()]);
    resellerLoaded = true;
}

window.loadResellerAll = loadResellerAll;
window.loadResellerApplications = loadResellerApplications;
