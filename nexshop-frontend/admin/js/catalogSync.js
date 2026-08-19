// catalogSync.js
// Handles the new Topup Catalog Sync and Management UI

let catalogProducts = [];
let catalogSummary = {};
let categoryMap = [];
let currentCategory = "";
let currentOperator = "";
let topupSearchQueryCatalog = "";
let operatorSearchQuery = "";
let operatorStateFilter = "Semua";
let syncInterval = null;

async function syncFullCatalog() {
    try {
        document.getElementById("btnSyncFull").disabled = true;
        document.getElementById("syncProgressOverlay").classList.remove("d-none");
        document.getElementById("catalogManagerArea").classList.add("opacity-50");
        document.getElementById("catalogManagerArea").style.pointerEvents = "none";

        const res = await apiFetch("/topup/admin/sync-full", { method: "POST" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Gagal sinkronisasi katalog");

        showToast(data.message || "Proses sinkronisasi berjalan...");
        
        // Start polling for status
        if (!syncInterval) {
            syncInterval = setInterval(checkSyncStatus, 3000);
        }
    } catch (err) {
        if (err.message === "unauthorized") return;
        showToast(err.message, true);
        resetSyncUI();
    }
}

async function checkSyncStatus() {
    try {
        const res = await apiFetch("/topup/admin/sync-status");
        if (!res.ok) return;
        const data = await res.json();

        const indicator = document.getElementById("syncStatusIndicator");
        
        if (data.is_running) {
            indicator.className = "badge bg-warning text-dark border";
            indicator.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status"></span> Sedang Sync...';
            document.getElementById("btnSyncFull").disabled = true;
            document.getElementById("syncProgressOverlay").classList.remove("d-none");
        } else {
            // Done
            if (syncInterval) {
                clearInterval(syncInterval);
                syncInterval = null;
            }
            resetSyncUI();
            
            if (data.last_log) {
                const log = data.last_log;
                if (log.status === 'success') {
                    indicator.className = "badge bg-success-subtle text-success border border-success-subtle";
                    indicator.innerHTML = `<i class="bi bi-check-circle"></i> Terakhir: ${new Date(log.completed_at).toLocaleString('id-ID')}`;
                    showToast(`Sync selesai! Baru: ${log.products_added}, Update: ${log.products_updated}`);
                    loadCatalogSummary();
                    window.loadTopupProducts(); // Refresh table
                } else if (log.status === 'error') {
                    indicator.className = "badge bg-danger-subtle text-danger border border-danger-subtle";
                    indicator.innerHTML = `<i class="bi bi-exclamation-triangle"></i> Gagal: ${log.error_message}`;
                    showToast(`Sync gagal: ${log.error_message}`, true);
                }
            }
        }
    } catch (err) {
        console.error("Gagal cek status sync", err);
    }
}

function resetSyncUI() {
    document.getElementById("btnSyncFull").disabled = false;
    document.getElementById("syncProgressOverlay").classList.add("d-none");
    document.getElementById("catalogManagerArea").classList.remove("opacity-50");
    document.getElementById("catalogManagerArea").style.pointerEvents = "auto";
}

async function loadCatalogSummary() {
    try {
        const res = await apiFetch("/topup/admin/catalog-summary");
        if (!res.ok) throw new Error("Gagal load summary");
        const data = await res.json();
        
        // Render Global Stats
        document.getElementById('statCatTotal').textContent = formatNumber(data.current.total);
        document.getElementById('statCatActive').textContent = formatNumber(data.current.active);
        document.getElementById('statCatInactive').textContent = formatNumber(data.current.inactive);
        document.getElementById('statCatForeign').textContent = formatNumber(data.current.foreign);

        if (data.sync) {
            document.getElementById('statSyncTime').textContent = new Date(data.sync.completed_at).toLocaleString('id-ID');
            document.getElementById('statSyncFound').textContent = formatNumber(data.sync.products_found);
            document.getElementById('statSyncAdded').textContent = formatNumber(data.sync.products_added);
            document.getElementById('statSyncUpdated').textContent = formatNumber(data.sync.products_updated);
            document.getElementById('statSyncForeign').textContent = formatNumber(data.sync.products_skipped_foreign);
        }

        catalogSummary = data.categories;
        renderCategoryNav();
    } catch (err) {
        console.error(err);
    }
}

function formatNumber(n) {
    return new Intl.NumberFormat('id-ID').format(n || 0);
}

function renderCategoryNav() {
    const nav = document.getElementById("catalogCategoryNav");
    if (!nav) return;
    
    let html = '';
    const categories = Object.keys(catalogSummary).sort();
    
    if (categories.length === 0) {
        nav.innerHTML = '<div class="text-muted small">Belum ada data. Silakan klik Sync Semua Produk.</div>';
        return;
    }

    if (!currentCategory && categories.length > 0) currentCategory = categories[0];

    categories.forEach(cat => {
        const isActive = cat === currentCategory;
        let totalCat = 0;
        Object.values(catalogSummary[cat].operators).forEach(o => totalCat += o.total);

        html += `
            <button class="btn btn-sm ${isActive ? 'btn-primary fw-bold' : 'btn-outline-secondary'} rounded-pill text-nowrap px-3" 
                onclick="selectCategory('${cat.replace(/'/g, "\\'")}')">
                ${cat} <span class="badge bg-${isActive ? 'light text-primary' : 'secondary'} ms-1 rounded-pill">${totalCat}</span>
            </button>
        `;
    });
    
    nav.innerHTML = html;
    renderOperatorList();
}

function selectCategory(cat) {
    currentCategory = cat;
    currentOperator = ""; // Reset operator when category changes
    renderCategoryNav();
    window.loadTopupProducts();
}

function renderOperatorList() {
    const list = document.getElementById("catalogOperatorList");
    const bulkArea = document.getElementById("operatorBulkToggleArea");
    if (!list) return;

    if (!currentCategory || !catalogSummary[currentCategory]) {
        list.innerHTML = '<div class="text-muted small">Pilih kategori...</div>';
        if (bulkArea) bulkArea.classList.add('d-none');
        return;
    }

    const ops = catalogSummary[currentCategory].operators;
    let opIds = Object.keys(ops).sort((a, b) => ops[a].name.localeCompare(ops[b].name));
    
    // Apply Operator State Filter
    if (operatorStateFilter && operatorStateFilter !== "Semua") {
        opIds = opIds.filter(id => ops[id].state === operatorStateFilter);
    }
    
    // Apply Operator Search Query
    if (operatorSearchQuery) {
        const q = operatorSearchQuery.toLowerCase();
        opIds = opIds.filter(id => ops[id].name.toLowerCase().includes(q));
    }
    
    let totalCat = 0;
    opIds.forEach(id => totalCat += ops[id].total);

    let html = `
        <button class="btn btn-sm text-start w-100 mb-1 ${currentOperator === '' ? 'btn-dark' : 'btn-light border'}" 
            onclick="selectOperator('')">
            Semua Operator <span class="badge bg-secondary float-end">${totalCat}</span>
        </button>
    `;

    if (opIds.length === 0) {
        html += `<div class="text-muted small mt-2">Tidak ada operator yang cocok.</div>`;
    }

    opIds.forEach(opId => {
        const opObj = ops[opId];
        const isActive = opId === currentOperator;
        
        let stateBadge = '';
        if (opObj.state === 'ON') stateBadge = '<span class="badge bg-success" style="font-size:0.6rem">ON</span>';
        else if (opObj.state === 'MIXED') stateBadge = '<span class="badge bg-warning text-dark" style="font-size:0.6rem">MIXED</span>';
        else stateBadge = '<span class="badge bg-secondary" style="font-size:0.6rem">OFF</span>';
        
        if (isActive) {
            // Expanded Card View
            html += `
                <div class="card border-primary shadow-sm mb-1">
                    <div class="card-body p-2">
                        <div class="d-flex justify-content-between align-items-center mb-2">
                            <span class="fw-bold text-primary text-truncate" style="max-width: 150px;" title="${opObj.name}">${opObj.name}</span>
                            ${stateBadge}
                        </div>
                        <div class="d-flex justify-content-between text-muted" style="font-size: 0.75rem;">
                            <span><b>${opObj.total}</b> products</span>
                        </div>
                        <div class="d-flex justify-content-between text-muted mb-2" style="font-size: 0.75rem;">
                            <span class="text-success">${opObj.active} Active</span>
                            <span class="text-secondary">${opObj.inactive} Inactive</span>
                        </div>
                        <div class="d-flex gap-1">
                            <button class="btn btn-sm btn-success flex-fill" style="font-size: 0.75rem;" onclick="bulkToggleOperator('${opId.replace(/'/g, "\\'")}', true)">[ ON ]</button>
                            <button class="btn btn-sm btn-outline-danger flex-fill" style="font-size: 0.75rem;" onclick="bulkToggleOperator('${opId.replace(/'/g, "\\'")}', false)">[ OFF ]</button>
                        </div>
                    </div>
                </div>
            `;
        } else {
            // Collapsed Button View
            html += `
                <button class="btn btn-sm text-start w-100 mb-1 btn-outline-secondary border" 
                    onclick="selectOperator('${opId.replace(/'/g, "\\'")}')">
                    <div class="d-flex justify-content-between align-items-center">
                        <span class="text-truncate" style="max-width: 120px;" title="${opObj.name}">${opObj.name}</span>
                        <div class="d-flex align-items-center gap-1">
                            ${stateBadge}
                            <span class="badge bg-secondary">${opObj.total}</span>
                        </div>
                    </div>
                </button>
            `;
        }
    });

    list.innerHTML = html;

    // Clear the old bulk area
    if (bulkArea) bulkArea.classList.add('d-none');
}

async function bulkToggleOperator(opId, activate) {
    const opObj = catalogSummary[currentCategory].operators[opId];
    if (!opObj) return;

    const actionText = activate ? "Aktifkan" : "Nonaktifkan";
    const protectedCount = opObj.auto_managed_false;
    const eligibleCount = opObj.total - opObj.foreign - protectedCount;
    const targetCount = activate ? (eligibleCount - opObj.active) : opObj.active;

    const res = await Swal.fire({
        title: `${actionText} ${opObj.name}?`,
        html: `
            <div class="text-start small">
                <div>Total produk: <b>${opObj.total}</b></div>
                <div>Akan diproses: <b>${targetCount > 0 ? targetCount : eligibleCount}</b></div>
                <div class="text-muted mt-2">
                    - Manual override (dilindungi): <b>${protectedCount}</b><br>
                    - Foreign/Deleted (diabaikan): <b>${opObj.foreign}</b>
                </div>
            </div>
        `,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: actionText,
        cancelButtonText: 'Batal',
        confirmButtonColor: activate ? '#198754' : '#dc3545'
    });

    if (!res.isConfirmed) return;

    try {
        const payload = {
            source_operator_id: opObj.source_operator_id,
            source_category_id: opObj.source_category_id,
            legacy_name: opObj.name,
            active: activate
        };

        const result = await apiFetch('/topup/admin/toggle-operator', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        const data = await result.json();
        if (!result.ok) throw new Error(data.message);

        showToast(data.message);
        loadCatalogSummary();
        window.loadTopupProducts();
    } catch (err) {
        showToast(err.message, true);
    }
}

function selectOperator(op) {
    currentOperator = op;
    renderOperatorList();
    window.loadTopupProducts();
}

// Override existing loadTopupProducts
window.loadTopupProducts = async function() {
    const tbody = document.getElementById("topupProducts");
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-5"><div class="spinner-border spinner-border-sm text-primary me-2"></div>Memuat produk...</td></tr>`;

    try {
        const res = await apiFetch("/topup/admin/products");
        if (!res.ok) throw new Error("Gagal mengambil data produk topup");

        catalogProducts = await res.json();
        renderProductTable();
        refreshTopupUndoRedoButtons();
    } catch (err) {
        if (err.message === "unauthorized") return;
        tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger py-4">${escapeHtml(err.message)}</td></tr>`;
    }
}

function renderProductTable() {
    const tbody = document.getElementById("topupProducts");
    if (!tbody) return;

    topupSearchQueryCatalog = document.getElementById("topupSearchInput")?.value || "";

    let list = catalogProducts;
    
    // Create a local category map dictionary for fast lookup
    const catDict = {};
    if (categoryMap && Array.isArray(categoryMap)) {
        categoryMap.forEach(m => catDict[m.tokovoucher_category_name] = m.nexshop_category_name);
    }

    list = list.map(p => {
        let cat = "Lainnya";
        if (p.manual_category_override) {
            cat = p.kategori || "Lainnya";
        } else if (p.source_category_name && catDict[p.source_category_name]) {
            cat = catDict[p.source_category_name];
        } else if (catDict[p.kategori]) {
            cat = catDict[p.kategori];
        }

        const opName = p.source_operator_name || p.kategori || "Unknown";
        const opId = p.source_operator_id || "LEGACY_OP_" + opName;

        return { ...p, _mappedCat: cat, _opId: opId };
    });

    // Filter by Category
    if (currentCategory) {
        list = list.filter(p => p._mappedCat === currentCategory);
    }
    
    // Filter by Operator (opId)
    if (currentOperator) {
        list = list.filter(p => p._opId === currentOperator);
    } else {
        // PERF: Don't render ALL products in the DOM if no operator is selected.
        // Cap it to avoid massive DOM slowdowns, or prompt them to pick an operator.
        if (list.length > 500) {
            tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-5">
                <i class="bi bi-list-task fs-2 d-block mb-2 text-secondary"></i>
                Silakan pilih Operator/Game di sebelah kiri untuk melihat produk.<br>
                <small class="text-secondary">(Menampilkan 10,000+ produk sekaligus dapat memberatkan browser)</small>
            </td></tr>`;
            document.getElementById("productTableHeader").textContent = `Daftar Produk`;
            return;
        }
    }

    // Filter by Search
    if (topupSearchQueryCatalog) {
        const q = topupSearchQueryCatalog.toLowerCase();
        list = list.filter(p => String(p.nama || "").toLowerCase().includes(q) || String(p.kode_produk || "").toLowerCase().includes(q));
    }

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-5">
            <i class="bi bi-inbox fs-2 d-block mb-2 text-secondary"></i>
            Tidak ada produk ditemukan.
        </td></tr>`;
        document.getElementById("productTableHeader").textContent = `Daftar Produk (0)`;
        return;
    }

    document.getElementById("productTableHeader").textContent = `Daftar Produk (${list.length})`;

    const formatRp = n => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(n);

    let html = '';
    list.forEach(p => {
        const activeClass = p.is_active ? 'text-success fw-bold' : 'text-muted';
        const activeText = p.is_active ? '<i class="bi bi-check-circle-fill text-success"></i> Aktif' : '<i class="bi bi-x-circle text-muted"></i> Nonaktif';
        const isChecked = topupSelectedIds.has(p.id) ? "checked" : "";
        const rowClass = topupSelectedIds.has(p.id) ? "table-active" : (p.is_active ? "" : "opacity-75");

        const modalRp = p.harga_beli || 0;
        const jualRp = p.harga_jual || 0;
        const untungRp = jualRp - modalRp;
        const profitClass = untungRp > 0 ? "text-success" : (untungRp < 0 ? "text-danger" : "text-muted");

        html += `
            <tr class="${rowClass}">
                <td class="text-center">
                    <input class="form-check-input topup-checkbox" type="checkbox" value="${p.id}" ${isChecked} onchange="toggleTopupSelect('${p.id}', this.checked)">
                </td>
                <td>
                    <div class="fw-bold mb-1" style="font-size: 0.95rem;">${highlightSearchMatch(p.nama || "-")}</div>
                    <div class="d-flex gap-2 text-muted small align-items-center">
                        <span class="badge bg-light border text-dark font-monospace">${escapeHtml(p.kode_produk)}</span>
                        ${p.source_jenis_name ? `<span class="badge bg-light border text-dark">${escapeHtml(p.source_jenis_name)}</span>` : ''}
                        ${p.butuh_server_id ? `<span class="badge bg-info-subtle border border-info-subtle text-info-emphasis"><i class="bi bi-person-vcard"></i> Srv ID</span>` : ''}
                    </div>
                </td>
                <td class="font-monospace small text-muted">${formatRp(modalRp)}</td>
                <td class="font-monospace fw-bold">${formatRp(jualRp)} <br><span class="small ${profitClass}">+${formatRp(untungRp)}</span></td>
                <td class="text-center small">${activeText}</td>
                <td class="text-end">
                    <button class="btn btn-sm btn-light border text-primary" onclick="openProductDrawer('${p.id}')">
                        <i class="bi bi-pencil-square"></i> Edit
                    </button>
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
    updateTopupSelectedCount();
}

function openProductDrawer(id) {
    const p = catalogProducts.find(x => x.id === id);
    if (!p) return;
    
    const body = document.getElementById("productDrawerBody");
    body.innerHTML = `
        <div class="mb-4">
            <h6 class="fw-bold text-muted mb-1">Nama Produk</h6>
            <div class="fs-5 fw-bold">${escapeHtml(p.nama)}</div>
            <div class="badge bg-dark mt-1 font-monospace">${escapeHtml(p.kode_produk)}</div>
        </div>

        <div class="card bg-light border-0 mb-4">
            <div class="card-body p-3">
                <div class="row g-2">
                    <div class="col-6">
                        <span class="text-muted small d-block">Operator</span>
                        <span class="fw-medium">${escapeHtml(p.source_operator_name || '-')}</span>
                    </div>
                    <div class="col-6">
                        <span class="text-muted small d-block">Kategori</span>
                        <span class="fw-medium">${escapeHtml(p.kategori || '-')}</span>
                    </div>
                    <div class="col-6">
                        <span class="text-muted small d-block">Jenis</span>
                        <span class="fw-medium">${escapeHtml(p.source_jenis_name || '-')}</span>
                    </div>
                    <div class="col-6">
                        <span class="text-muted small d-block">Harga Modal (TokoVoucher)</span>
                        <span class="fw-medium font-monospace">Rp ${new Intl.NumberFormat('id-ID').format(p.harga_beli || 0)}</span>
                    </div>
                </div>
            </div>
        </div>

        <form id="productEditForm">
            <input type="hidden" id="drawProdId" value="${p.id}">
            
            <div class="mb-3">
                <label class="form-label fw-bold">Harga Jual (Rp)</label>
                <div class="input-group">
                    <span class="input-group-text bg-light">Rp</span>
                    <input type="number" class="form-control" id="drawHargaJual" value="${p.harga_jual || p.harga_beli || 0}" min="0">
                </div>
            </div>
            
            <div class="mb-3 form-check form-switch">
                <input class="form-check-input" type="checkbox" role="switch" id="drawIsActive" ${p.is_active ? 'checked' : ''}>
                <label class="form-check-label fw-bold" for="drawIsActive">Status Aktif</label>
                <div class="form-text mt-0 text-muted">Hanya produk aktif yang tampil di toko.</div>
            </div>

            <div class="mb-3 form-check form-switch">
                <input class="form-check-input" type="checkbox" role="switch" id="drawButuhServer" ${p.butuh_server_id ? 'checked' : ''}>
                <label class="form-check-label fw-bold" for="drawButuhServer">Butuh Server ID</label>
                <div class="form-text mt-0 text-muted">Aktifkan jika game ini memerlukan Server ID / Zone ID (contoh: MLBB).</div>
            </div>
        </form>
    `;

    document.getElementById("btnSaveProductDrawer").onclick = saveProductDrawer;

    const bsOffcanvas = new bootstrap.Offcanvas(document.getElementById('productDrawer'));
    bsOffcanvas.show();
}

async function saveProductDrawer() {
    const id = document.getElementById("drawProdId").value;
    const harga_jual = parseInt(document.getElementById("drawHargaJual").value, 10);
    const is_active = document.getElementById("drawIsActive").checked;
    const butuh_server_id = document.getElementById("drawButuhServer").checked;

    try {
        document.getElementById("btnSaveProductDrawer").disabled = true;
        const res = await apiFetch(`/topup/admin/products/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ harga_jual, is_active, butuh_server_id })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Gagal update produk");

        showToast("Produk berhasil diupdate");
        const offcanvas = bootstrap.Offcanvas.getInstance(document.getElementById('productDrawer'));
        if (offcanvas) offcanvas.hide();
        
        window.loadTopupProducts();
        loadCatalogSummary();
    } catch (err) {
        showToast(err.message, true);
    } finally {
        document.getElementById("btnSaveProductDrawer").disabled = false;
    }
}

async function openCategoryMapModal() {
    try {
        const res = await apiFetch("/topup/admin/category-map");
        if (!res.ok) throw new Error("Gagal load mapping");
        categoryMap = await res.json();
        
        renderCategoryMapTable();
        const modal = new bootstrap.Modal(document.getElementById('categoryMapModal'));
        modal.show();
    } catch(err) {
        showToast(err.message, true);
    }
}

function renderCategoryMapTable() {
    const tbody = document.getElementById("categoryMapTableBody");
    if (!tbody) return;
    
    if (categoryMap.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">Belum ada mapping</td></tr>';
        return;
    }
    
    let html = '';
    categoryMap.forEach(m => {
        html += `
            <tr>
                <td class="fw-bold">${escapeHtml(m.tokovoucher_category_name)}</td>
                <td><span class="badge bg-primary-subtle text-primary border border-primary-subtle">${escapeHtml(m.nexshop_category_name)}</span></td>
                <td class="text-end">
                    <button class="btn btn-sm btn-link text-muted p-0" title="Klik tambah di bawah untuk menimpa nama ini"><i class="bi bi-pencil"></i></button>
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = html;
}

document.getElementById("addCategoryMapForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const tv = document.getElementById("mapInputTv").value.trim();
    const ns = document.getElementById("mapInputNs").value.trim();
    if (!tv || !ns) return;

    try {
        const res = await apiFetch("/topup/admin/category-map", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tokovoucher_category_name: tv, nexshop_category_name: ns })
        });
        if (!res.ok) throw new Error("Gagal menyimpan mapping");
        
        showToast("Mapping berhasil disimpan");
        document.getElementById("mapInputTv").value = "";
        document.getElementById("mapInputNs").value = "";
        
        // Reload modal table
        openCategoryMapModal();
    } catch (err) {
        showToast(err.message, true);
    }
});

// Hook into dashboard tab changes
document.addEventListener("DOMContentLoaded", () => {
    const searchInput = document.getElementById("topupSearchInput");
    if (searchInput) {
        searchInput.addEventListener("input", (e) => {
            topupSearchQueryCatalog = e.target.value;
            renderProductTable();
        });
    }

    const opSearchInput = document.getElementById("operatorSearchInput");
    if (opSearchInput) {
        opSearchInput.addEventListener("input", (e) => {
            operatorSearchQuery = e.target.value;
            renderOperatorList();
        });
    }

    const opStateRadios = document.querySelectorAll('input[name="op_state_filter"]');
    opStateRadios.forEach(radio => {
        radio.addEventListener("change", (e) => {
            if (e.target.checked) {
                operatorStateFilter = e.target.value;
                renderOperatorList();
            }
        });
    });

    // Call checkSyncStatus on load to see if it's currently running
    setTimeout(() => {
        checkSyncStatus();
        loadCatalogSummary();
    }, 1000);
});
