// catalogSync.js
// Pengelolaan katalog Topup TokoVoucher di dashboard admin.
//
// CATATAN PENTING soal versi sebelumnya:
// Filter kategori dulu dikerjain DI BROWSER pakai variabel `categoryMap`
// yang cuma diisi kalau admin kebetulan buka modal "Mapping Kategori".
// Karena modal itu jarang dibuka, `categoryMap` hampir selalu kosong, jadi
// SEMUA produk dipetakan ke "Lainnya" -- begitu admin klik kategori mana
// pun (E-Wallet, Gaming, ...), tabelnya nampilin "Tidak ada produk
// ditemukan" padahal produknya ada belasan ribu di database.
//
// Sekarang mapping kategori, filter, dan paginasi dikerjain DI SERVER
// (GET /topup/admin/products), jadi apa yang keliatan di sidebar dan apa
// yang keliatan di tabel dijamin datang dari perhitungan yang sama.

let catalogProducts = [];      // produk pada halaman yang lagi tampil
let catalogSummary = {};       // ringkasan per kategori dari server
let catalogTotalMatched = 0;   // total produk yang cocok filter (lintas halaman)
let catalogPage = 0;
let catalogLoading = false;
let syncInterval = null;

const CATALOG_PAGE_SIZE = 200;

const catalogFilter = {
    category: "",
    operator: "",
    status: "",
    q: ""
};

// ===========================================================
// Util
// ===========================================================
function formatNumber(n) {
    return new Intl.NumberFormat("id-ID").format(Number(n) || 0);
}

function formatRupiah(n) {
    return "Rp " + new Intl.NumberFormat("id-ID").format(Number(n) || 0);
}

function el(id) {
    return document.getElementById(id);
}

// ===========================================================
// Sinkronisasi katalog
// ===========================================================
async function syncFullCatalog() {
    const btn = el("btnSyncFull");
    const overlay = el("syncProgressOverlay");
    const area = el("catalogManagerArea");

    try {
        if (btn) btn.disabled = true;
        if (overlay) overlay.classList.remove("d-none");
        if (area) {
            area.classList.add("opacity-50");
            area.style.pointerEvents = "none";
        }

        const res = await apiFetch("/topup/admin/sync-full", { method: "POST" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Gagal sinkronisasi katalog");

        showToast(data.message || "Proses sinkronisasi berjalan…");

        if (!syncInterval) syncInterval = setInterval(checkSyncStatus, 3000);
    } catch (err) {
        if (err.message === "unauthorized") return;
        showToast(err.message, true);
        resetSyncUI();
    }
}

function setSyncChip(variant, html) {
    const indicator = el("syncStatusIndicator");
    if (!indicator) return;
    indicator.className = `badge rounded-pill status-chip status-chip-${variant}`;
    indicator.innerHTML = html;
}

async function checkSyncStatus() {
    try {
        // polling tiap 3 detik selama sync -> latar, bukan aktivitas admin
        const res = await apiFetch("/topup/admin/sync-status", { background: true });
        if (!res.ok) return;
        const data = await res.json();

        if (data.is_running) {
            setSyncChip("running", '<span class="spinner-border spinner-border-sm me-1" role="status"></span> Sedang sync…');
            const btn = el("btnSyncFull");
            if (btn) btn.disabled = true;
            const overlay = el("syncProgressOverlay");
            if (overlay) overlay.classList.remove("d-none");
            return;
        }

        if (syncInterval) {
            clearInterval(syncInterval);
            syncInterval = null;
        }
        resetSyncUI();

        const log = data.last_log;
        if (!log) {
            setSyncChip("idle", "Belum pernah sync");
            return;
        }

        if (log.status === "success") {
            setSyncChip("success", `<i class="bi bi-check-circle me-1"></i>${new Date(log.completed_at).toLocaleString("id-ID")}`);
            showToast(`Sync selesai. Baru: ${log.products_added}, Update: ${log.products_updated}`);
            loadCatalogSummary();
            window.loadTopupProducts();
        } else if (log.status === "error") {
            setSyncChip("error", `<i class="bi bi-exclamation-triangle me-1"></i>Gagal`);
            showToast(`Sync gagal: ${log.error_message}`, true);
        } else {
            setSyncChip("running", '<span class="spinner-border spinner-border-sm me-1" role="status"></span> Sedang sync…');
        }
    } catch (err) {
        console.error("Gagal cek status sync", err);
    }
}

function resetSyncUI() {
    const btn = el("btnSyncFull");
    if (btn) btn.disabled = false;
    const overlay = el("syncProgressOverlay");
    if (overlay) overlay.classList.add("d-none");
    const area = el("catalogManagerArea");
    if (area) {
        area.classList.remove("opacity-50");
        area.style.pointerEvents = "auto";
    }
}

// ===========================================================
// Ringkasan katalog + isi dropdown kategori/operator
// ===========================================================
async function loadCatalogSummary() {
    try {
        const res = await apiFetch("/topup/admin/catalog-summary");
        if (!res.ok) throw new Error("Gagal memuat ringkasan katalog");
        const data = await res.json();

        const setText = (id, value) => {
            const node = el(id);
            if (node) node.textContent = value;
        };

        setText("statCatTotal", formatNumber(data.current.total));
        setText("statCatActive", formatNumber(data.current.active));
        setText("statCatInactive", formatNumber(data.current.inactive));
        setText("statCatForeign", formatNumber(data.current.foreign));

        if (data.sync) {
            setText("statSyncTime", data.sync.completed_at
                ? new Date(data.sync.completed_at).toLocaleString("id-ID")
                : "Sedang berjalan…");
            setText("statSyncFound", formatNumber(data.sync.products_found));
            setText("statSyncAdded", formatNumber(data.sync.products_added));
            setText("statSyncUpdated", formatNumber(data.sync.products_updated));
            setText("statSyncForeign", formatNumber(data.sync.products_skipped_foreign));
        }

        catalogSummary = data.categories || {};
        renderCategorySelect();
        renderOperatorSelect();
    } catch (err) {
        if (err.message === "unauthorized") return;
        console.error(err);
        showToast(err.message, true);
    }
}

function renderCategorySelect() {
    const select = el("catalogCategorySelect");
    if (!select) return;

    const categories = Object.keys(catalogSummary).sort((a, b) => a.localeCompare(b, "id"));
    if (!categories.length) {
        select.innerHTML = '<option value="">Belum ada data — sync dulu</option>';
        return;
    }

    const options = ['<option value="">Semua kategori</option>'];
    categories.forEach((cat) => {
        const info = catalogSummary[cat];
        options.push(
            `<option value="${escapeHtml(cat)}">${escapeHtml(cat)} — ${formatNumber(info.total)} produk (${formatNumber(info.active)} aktif)</option>`
        );
    });

    select.innerHTML = options.join("");
    select.value = catalogFilter.category;
    // Kalau kategori tersimpan udah gak ada lagi (mis. mapping berubah),
    // jangan biarin filter nyangkut ke nilai hantu yang gak match apa pun.
    if (select.value !== catalogFilter.category) catalogFilter.category = "";
}

function renderOperatorSelect() {
    const select = el("catalogOperatorSelect");
    if (!select) return;

    const cat = catalogFilter.category;
    const operators = cat && catalogSummary[cat] ? catalogSummary[cat].operators || {} : {};
    const ids = Object.keys(operators).sort((a, b) =>
        String(operators[a].name).localeCompare(String(operators[b].name), "id")
    );

    if (!cat) {
        select.innerHTML = '<option value="">Pilih kategori dulu</option>';
        select.disabled = true;
        catalogFilter.operator = "";
        return;
    }

    select.disabled = false;
    const options = ['<option value="">Semua game / operator</option>'];
    ids.forEach((id) => {
        const op = operators[id];
        const state = op.state === "ON" ? "ON" : op.state === "MIXED" ? "SEBAGIAN" : "OFF";
        options.push(
            `<option value="${escapeHtml(id)}">${escapeHtml(op.name)} — ${formatNumber(op.total)} produk [${state}]</option>`
        );
    });

    select.innerHTML = options.join("");
    select.value = catalogFilter.operator;
    if (select.value !== catalogFilter.operator) catalogFilter.operator = "";
}

// ===========================================================
// Muat produk (filter + paginasi dikerjain server)
// ===========================================================
function buildCatalogQuery(extra = {}) {
    const params = new URLSearchParams();
    if (catalogFilter.category) params.set("category", catalogFilter.category);
    if (catalogFilter.operator) params.set("operator", catalogFilter.operator);
    if (catalogFilter.status) params.set("status", catalogFilter.status);
    if (catalogFilter.q) params.set("q", catalogFilter.q);
    Object.entries(extra).forEach(([key, value]) => params.set(key, value));
    return params.toString();
}

window.loadTopupProducts = async function loadTopupProducts() {
    const tbody = el("topupProducts");
    if (!tbody) return;
    if (catalogLoading) return;
    catalogLoading = true;

    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-5"><div class="spinner-border spinner-border-sm text-primary me-2"></div>Memuat produk…</td></tr>`;

    try {
        const query = buildCatalogQuery({
            limit: CATALOG_PAGE_SIZE,
            offset: catalogPage * CATALOG_PAGE_SIZE
        });
        const res = await apiFetch(`/topup/admin/products?${query}`);
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.message || "Gagal mengambil data produk topup");
        }

        const payload = await res.json();
        // Toleran ke bentuk lama (array telanjang) kalau backend belum ke-deploy.
        catalogProducts = Array.isArray(payload) ? payload : payload.data || [];
        catalogTotalMatched = Array.isArray(payload) ? catalogProducts.length : Number(payload.total) || 0;

        // Halaman kosong tapi total > 0 artinya offset-nya kelewat (mis. abis
        // ganti filter) — balik ke halaman pertama.
        if (!catalogProducts.length && catalogTotalMatched > 0 && catalogPage > 0) {
            catalogPage = 0;
            catalogLoading = false;
            return window.loadTopupProducts();
        }

        renderProductTable();
        renderBulkFilterPanel();
        renderPager();
        refreshTopupUndoRedoButtons();
    } catch (err) {
        if (err.message === "unauthorized") return;
        tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger py-4">${escapeHtml(err.message)}</td></tr>`;
    } finally {
        catalogLoading = false;
    }
};

function renderProductTable() {
    const tbody = el("topupProducts");
    if (!tbody) return;

    const header = el("productTableHeader");
    if (header) header.textContent = `Daftar Produk (${formatNumber(catalogTotalMatched)})`;

    const note = el("topupTableNote");
    if (note) {
        note.textContent = catalogTotalMatched > catalogProducts.length
            ? `Menampilkan ${formatNumber(catalogProducts.length)} dari ${formatNumber(catalogTotalMatched)}`
            : "";
    }

    if (!catalogProducts.length) {
        const hasFilter = catalogFilter.category || catalogFilter.operator || catalogFilter.q || catalogFilter.status;
        tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-5">
            <i class="bi bi-inbox fs-2 d-block mb-2 text-secondary"></i>
            ${hasFilter ? "Tidak ada produk yang cocok dengan filter ini." : "Belum ada produk. Klik <b>Sync Katalog</b> di langkah 1."}
        </td></tr>`;
        updateTopupSelectedCount();
        return;
    }

    tbody.innerHTML = catalogProducts.map((p) => {
        const isChecked = topupSelectedIds.has(p.id) ? "checked" : "";
        const rowClass = topupSelectedIds.has(p.id) ? "table-active" : (p.is_active ? "" : "row-inactive");

        const modalRp = Number(p.harga_beli) || 0;
        const jualRp = Number(p.harga_jual) || 0;
        const untungRp = jualRp - modalRp;
        const profitClass = untungRp > 0 ? "text-success" : (untungRp < 0 ? "text-danger" : "text-muted");
        const noPrice = jualRp <= 0;

        return `
            <tr class="${rowClass}">
                <td class="text-center">
                    <input class="form-check-input topup-checkbox" type="checkbox" value="${p.id}" ${isChecked}
                        onchange="toggleTopupSelect(${JSON.stringify(p.id)}, this.checked)">
                </td>
                <td>
                    <div class="fw-semibold mb-1">${highlightSearchMatch(p.nama || "-")}</div>
                    <div class="d-flex gap-2 flex-wrap align-items-center meta-badges">
                        <span class="badge badge-code font-monospace">${escapeHtml(p.kode_produk || "-")}</span>
                        ${p.operator_name ? `<span class="badge badge-meta">${escapeHtml(p.operator_name)}</span>` : ""}
                        ${p.source_jenis_name ? `<span class="badge badge-meta">${escapeHtml(p.source_jenis_name)}</span>` : ""}
                        ${p.butuh_server_id ? `<span class="badge badge-server"><i class="bi bi-person-vcard"></i> Server ID</span>` : ""}
                    </div>
                </td>
                <td class="font-monospace small text-muted text-nowrap">${formatRupiah(modalRp)}</td>
                <td class="font-monospace fw-semibold text-nowrap">
                    ${noPrice ? '<span class="text-danger">Belum diatur</span>' : formatRupiah(jualRp)}
                    ${noPrice ? "" : `<div class="small fw-normal ${profitClass}">${untungRp >= 0 ? "+" : ""}${formatRupiah(untungRp)}</div>`}
                </td>
                <td class="text-center small text-nowrap">
                    ${p.is_active
                        ? '<span class="badge bg-success">Aktif</span>'
                        : '<span class="badge bg-secondary">Nonaktif</span>'}
                </td>
                <td class="text-end">
                    <button class="btn btn-sm btn-outline-primary" onclick="openProductDrawer(${JSON.stringify(p.id)})">
                        <i class="bi bi-pencil-square"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join("");

    updateTopupSelectedCount();
}

// ===========================================================
// Seleksi checkbox
//
// Fungsi ini SEBELUMNYA gak pernah didefinisikan di mana pun, padahal tiap
// checkbox produk manggil onchange="toggleTopupSelect(...)". Jadi tiap
// admin nyentang produk, browser cuma ngelempar ReferenceError diam-diam
// dan seleksi selalu kosong -- semua tombol aksi massal jawabnya "Pilih
// minimal 1 produk dulu" walaupun udah dicentang banyak.
// ===========================================================
function toggleTopupSelect(id, checked) {
    if (checked) topupSelectedIds.add(id);
    else topupSelectedIds.delete(id);
    updateTopupSelectedCount();
}

function updateTopupSelectedCount() {
    const countEl = el("topupSelectedCount");
    if (countEl) countEl.textContent = `${formatNumber(topupSelectedIds.size)} dipilih`;

    const selectAll = el("topupSelectAll");
    if (selectAll) {
        const visible = catalogProducts.map((p) => p.id);
        selectAll.checked = visible.length > 0 && visible.every((id) => topupSelectedIds.has(id));
        selectAll.indeterminate = !selectAll.checked && visible.some((id) => topupSelectedIds.has(id));
    }
}

// ===========================================================
// Panel aksi massal berbasis filter (langkah 4)
// ===========================================================
function renderBulkFilterPanel() {
    const summary = el("bulkFilterSummary");
    const card = el("bulkFilterCard");
    if (!card) return;

    const hasFilter = Boolean(catalogFilter.category || catalogFilter.operator || catalogFilter.q || catalogFilter.status);
    card.querySelectorAll(".bulk-filter-actions button").forEach((btn) => {
        btn.disabled = !hasFilter || catalogTotalMatched === 0;
    });

    if (!summary) return;

    if (!hasFilter) {
        summary.textContent = "Pilih kategori dulu di langkah 3 — aksi massal sengaja dikunci supaya gak kena ke seluruh katalog.";
        return;
    }

    const parts = [];
    if (catalogFilter.category) parts.push(catalogFilter.category);
    if (catalogFilter.operator) {
        const op = catalogSummary[catalogFilter.category]?.operators?.[catalogFilter.operator];
        parts.push(op ? op.name : catalogFilter.operator);
    }
    if (catalogFilter.status) parts.push(catalogFilter.status === "active" ? "hanya aktif" : "hanya nonaktif");
    if (catalogFilter.q) parts.push(`cari "${catalogFilter.q}"`);

    summary.innerHTML = `Aksi di bawah bakal kena ke <b>${formatNumber(catalogTotalMatched)} produk</b> — ${escapeHtml(parts.join(" · "))}`;
}

async function applyToFilter(action) {
    if (!catalogTotalMatched) return showToast("Gak ada produk yang cocok sama filter ini", true);

    const labels = {
        activate: "Aktifkan",
        deactivate: "Nonaktifkan",
        "auto-markup": "Hitung ulang harga jual",
        "server-id-on": "Tandai butuh Server ID",
        "server-id-off": "Tandai tanpa Server ID"
    };

    const confirmed = await Swal.fire({
        title: `${labels[action]} ${formatNumber(catalogTotalMatched)} produk?`,
        html: `<div class="text-start small">Berlaku untuk <b>semua produk</b> yang cocok dengan filter sekarang, bukan cuma yang tampil di halaman ini.</div>`,
        icon: "warning",
        showCancelButton: true,
        confirmButtonText: labels[action],
        cancelButtonText: "Batal"
    });
    if (!confirmed.isConfirmed) return;

    try {
        const res = await apiFetch("/topup/admin/products/apply-filter", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action, filter: catalogFilter })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Gagal menerapkan aksi massal");

        showToast(data.message);
        topupSelectedIds.clear();
        await loadCatalogSummary();
        await window.loadTopupProducts();
    } catch (err) {
        if (err.message === "unauthorized") return;
        showToast(err.message, true);
    }
}

// ===========================================================
// Paginasi
// ===========================================================
function renderPager() {
    const bar = el("topupPagerBar");
    if (!bar) return;

    const totalPages = Math.max(1, Math.ceil(catalogTotalMatched / CATALOG_PAGE_SIZE));
    if (totalPages <= 1) {
        bar.classList.add("d-none");
        return;
    }

    bar.classList.remove("d-none");
    const info = el("topupPagerInfo");
    if (info) info.textContent = `Halaman ${catalogPage + 1} dari ${totalPages}`;

    const prev = el("topupPrevPage");
    const next = el("topupNextPage");
    if (prev) prev.disabled = catalogPage === 0;
    if (next) next.disabled = catalogPage >= totalPages - 1;
}

function changeCatalogPage(delta) {
    const totalPages = Math.max(1, Math.ceil(catalogTotalMatched / CATALOG_PAGE_SIZE));
    const nextPage = Math.min(Math.max(0, catalogPage + delta), totalPages - 1);
    if (nextPage === catalogPage) return;
    catalogPage = nextPage;
    window.loadTopupProducts();
}

// ===========================================================
// Drawer edit produk
// ===========================================================
function openProductDrawer(id) {
    const p = catalogProducts.find((x) => x.id === id);
    if (!p) return;

    const body = el("productDrawerBody");
    if (!body) return;

    const suggested = Math.round((Number(p.harga_beli) || 0) * 1.05);

    body.innerHTML = `
        <div class="mb-4">
            <h6 class="fw-bold text-muted mb-1">Nama Produk</h6>
            <div class="fs-5 fw-bold">${escapeHtml(p.nama || "-")}</div>
            <div class="badge badge-code font-monospace mt-1">${escapeHtml(p.kode_produk || "-")}</div>
        </div>

        <div class="card drawer-info-card mb-4">
            <div class="card-body p-3">
                <div class="row g-3">
                    <div class="col-6">
                        <span class="text-muted small d-block">Game / Operator</span>
                        <span class="fw-medium">${escapeHtml(p.operator_name || "-")}</span>
                    </div>
                    <div class="col-6">
                        <span class="text-muted small d-block">Kategori</span>
                        <span class="fw-medium">${escapeHtml(p.nexshop_category || p.kategori || "-")}</span>
                    </div>
                    <div class="col-6">
                        <span class="text-muted small d-block">Jenis</span>
                        <span class="fw-medium">${escapeHtml(p.source_jenis_name || "-")}</span>
                    </div>
                    <div class="col-6">
                        <span class="text-muted small d-block">Harga Modal</span>
                        <span class="fw-medium font-monospace">${formatRupiah(p.harga_beli)}</span>
                    </div>
                </div>
            </div>
        </div>

        <form id="productEditForm" onsubmit="return false;">
            <input type="hidden" id="drawProdId" value="${escapeHtml(String(p.id))}">

            <div class="mb-3">
                <label class="form-label fw-bold" for="drawHargaJual">Harga Jual</label>
                <div class="input-group">
                    <span class="input-group-text">Rp</span>
                    <input type="number" class="form-control" id="drawHargaJual" value="${Number(p.harga_jual) || 0}" min="0">
                    <button class="btn btn-outline-secondary" type="button" onclick="document.getElementById('drawHargaJual').value=${suggested}">
                        Saran ${formatRupiah(suggested)}
                    </button>
                </div>
                <div class="form-text">Harga jual 0 berarti produk gak bisa tayang di toko.</div>
            </div>

            <div class="mb-3 form-check form-switch">
                <input class="form-check-input" type="checkbox" role="switch" id="drawIsActive" ${p.is_active ? "checked" : ""}>
                <label class="form-check-label fw-bold" for="drawIsActive">Status Aktif</label>
                <div class="form-text mt-0">Hanya produk aktif yang tampil di toko.</div>
            </div>

            <div class="mb-3 form-check form-switch">
                <input class="form-check-input" type="checkbox" role="switch" id="drawButuhServer" ${p.butuh_server_id ? "checked" : ""}>
                <label class="form-check-label fw-bold" for="drawButuhServer">Butuh Server ID</label>
                <div class="form-text mt-0">Aktifkan kalau game ini minta Server ID / Zone ID (contoh: MLBB).</div>
            </div>
        </form>
    `;

    const saveBtn = el("btnSaveProductDrawer");
    if (saveBtn) saveBtn.onclick = saveProductDrawer;

    bootstrap.Offcanvas.getOrCreateInstance(el("productDrawer")).show();
}

async function saveProductDrawer() {
    const idField = el("drawProdId");
    if (!idField) return;

    // id produk itu integer di database; kirim balik sebagai angka biar
    // cocok sama tipe kolomnya.
    const rawId = idField.value;
    const id = /^\d+$/.test(rawId) ? Number(rawId) : rawId;

    const harga_jual = parseInt(el("drawHargaJual").value, 10);
    const is_active = el("drawIsActive").checked;
    const butuh_server_id = el("drawButuhServer").checked;

    if (!Number.isFinite(harga_jual) || harga_jual < 0) {
        return showToast("Harga jual harus angka >= 0", true);
    }
    if (is_active && harga_jual === 0) {
        return showToast("Produk gak bisa diaktifkan kalau harga jualnya masih 0", true);
    }

    const saveBtn = el("btnSaveProductDrawer");
    try {
        if (saveBtn) saveBtn.disabled = true;
        const res = await apiFetch(`/topup/admin/products/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ harga_jual, is_active, butuh_server_id })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Gagal update produk");

        showToast("Produk berhasil diperbarui");
        bootstrap.Offcanvas.getInstance(el("productDrawer"))?.hide();

        await window.loadTopupProducts();
        loadCatalogSummary();
    } catch (err) {
        if (err.message === "unauthorized") return;
        showToast(err.message, true);
    } finally {
        if (saveBtn) saveBtn.disabled = false;
    }
}

// ===========================================================
// Modal mapping kategori
// ===========================================================
let categoryMap = [];

async function openCategoryMapModal() {
    try {
        const res = await apiFetch("/topup/admin/category-map");
        if (!res.ok) throw new Error("Gagal memuat mapping kategori");
        categoryMap = await res.json();

        renderCategoryMapTable();
        bootstrap.Modal.getOrCreateInstance(el("categoryMapModal")).show();
    } catch (err) {
        if (err.message === "unauthorized") return;
        showToast(err.message, true);
    }
}

function renderCategoryMapTable() {
    const tbody = el("categoryMapTableBody");
    if (!tbody) return;

    if (!categoryMap.length) {
        tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted py-3">Belum ada mapping</td></tr>';
        return;
    }

    tbody.innerHTML = categoryMap.map((m) => `
        <tr>
            <td class="fw-semibold">${escapeHtml(m.tokovoucher_category_name)}</td>
            <td><span class="badge badge-meta">${escapeHtml(m.nexshop_category_name)}</span></td>
            <td class="text-end">
                <button class="btn btn-sm btn-link p-0 text-decoration-none"
                    onclick="prefillCategoryMap(${JSON.stringify(m.tokovoucher_category_name)}, ${JSON.stringify(m.nexshop_category_name)})"
                    title="Ubah mapping ini">
                    <i class="bi bi-pencil"></i>
                </button>
            </td>
        </tr>
    `).join("");
}

// Tombol pensil di tabel mapping dulunya cuma ikon mati tanpa aksi apa pun.
function prefillCategoryMap(tokovoucherName, nexshopName) {
    const tv = el("mapInputTv");
    const ns = el("mapInputNs");
    if (tv) tv.value = tokovoucherName;
    if (ns) {
        ns.value = nexshopName;
        ns.focus();
    }
}

// ===========================================================
// Init
// ===========================================================
function bindCatalogFilters() {
    const categorySelect = el("catalogCategorySelect");
    if (categorySelect) {
        categorySelect.addEventListener("change", (e) => {
            catalogFilter.category = e.target.value;
            catalogFilter.operator = "";
            catalogPage = 0;
            topupSelectedIds.clear();
            renderOperatorSelect();
            window.loadTopupProducts();
        });
    }

    const operatorSelect = el("catalogOperatorSelect");
    if (operatorSelect) {
        operatorSelect.addEventListener("change", (e) => {
            catalogFilter.operator = e.target.value;
            catalogPage = 0;
            topupSelectedIds.clear();
            window.loadTopupProducts();
        });
    }

    const statusSelect = el("catalogStatusSelect");
    if (statusSelect) {
        statusSelect.addEventListener("change", (e) => {
            catalogFilter.status = e.target.value;
            catalogPage = 0;
            window.loadTopupProducts();
        });
    }

    const searchInput = el("topupSearchInput");
    if (searchInput) {
        let debounce = null;
        searchInput.addEventListener("input", (e) => {
            const value = e.target.value.trim();
            clearTimeout(debounce);
            // Pencarian sekarang jalan di server, jadi jangan nembak tiap
            // ketukan keyboard.
            debounce = setTimeout(() => {
                catalogFilter.q = value;
                topupSearchQuery = value; // dipakai highlightSearchMatch
                catalogPage = 0;
                window.loadTopupProducts();
            }, 350);
        });
    }

    const selectAll = el("topupSelectAll");
    if (selectAll) {
        selectAll.addEventListener("change", (e) => {
            if (e.target.checked) catalogProducts.forEach((p) => topupSelectedIds.add(p.id));
            else catalogProducts.forEach((p) => topupSelectedIds.delete(p.id));
            renderProductTable();
        });
    }

    const mapForm = el("addCategoryMapForm");
    if (mapForm) {
        mapForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const tv = el("mapInputTv").value.trim();
            const ns = el("mapInputNs").value.trim();
            if (!tv || !ns) return;

            try {
                const res = await apiFetch("/topup/admin/category-map", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ tokovoucher_category_name: tv, nexshop_category_name: ns })
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.message || "Gagal menyimpan mapping");

                showToast("Mapping berhasil disimpan");
                el("mapInputTv").value = "";
                el("mapInputNs").value = "";

                // Mapping ngubah kategori tiap produk, jadi ringkasan +
                // tabelnya wajib dimuat ulang biar gak beda sama server.
                const refreshed = await apiFetch("/topup/admin/category-map");
                if (refreshed.ok) {
                    categoryMap = await refreshed.json();
                    renderCategoryMapTable();
                }
                await loadCatalogSummary();
                await window.loadTopupProducts();
            } catch (err) {
                if (err.message === "unauthorized") return;
                showToast(err.message, true);
            }
        });
    }
}

let catalogInitialized = false;

// Dipanggil dashboard.js waktu tab Topup dibuka pertama kali.
window.initTopupCatalog = function initTopupCatalog() {
    if (catalogInitialized) return;
    catalogInitialized = true;
    checkSyncStatus();
    loadCatalogSummary().then(() => window.loadTopupProducts());
};

document.addEventListener("DOMContentLoaded", () => {
    bindCatalogFilters();
});
