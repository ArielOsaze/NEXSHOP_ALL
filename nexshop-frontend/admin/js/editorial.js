/**
 * editorial.js
 * NexShop News Editorial System — Admin Dashboard JS
 *
 * Depends on: dashboard.js (API_BASE, token, showToast, apiFetch pattern)
 * Swal: loaded via sweetalert2@11 in dashboard.html
 */

// ────────────────────────────────────────────────────────────
// Constants — resolve EDITORIAL_API after dashboard.js has set API_BASE
// ────────────────────────────────────────────────────────────
(function () {
    "use strict";

    // Wait until dashboard.js globals are available
    function getEditorialApiBase() {
        // API_BASE is defined in dashboard.js (global)
        if (typeof API_BASE !== "undefined") return `${API_BASE}/news/admin/articles`;
        // Fallback
        const h = window.location.hostname;
        const base = (h === "localhost" || h === "127.0.0.1")
            ? "http://localhost:3000/api"
            : "/api";
        return `${base}/news/admin/articles`;
    }

    // ── State ─────────────────────────────────────────────
    const _state = {
        page:           1,
        totalPages:     1,
        total:          0,
        articles:       [],
        selected:       new Set(),
        slugLocked:     false,
        currentId:      null   // null = create, number = edit
    };

    let _searchTimer = null;

    // ── Helpers ─────────────────────────────────────────────
    function editorialApiBase() {
        return getEditorialApiBase();
    }

    function editToken() {
        // token is a global const set at the top of dashboard.js (sessionStorage)
        if (typeof token !== "undefined") return token;
        return sessionStorage.getItem("nexshop-admin-token") || localStorage.getItem("nexshop-admin-token");
    }

    function toast(msg, isError = false) {
        if (typeof showToast === "function") {
            // dashboard.js showToast(message, isError:boolean)
            showToast(msg, isError);
        } else {
            alert(msg);
        }
    }

    function editFmtDate(iso) {
        if (!iso) return "—";
        return new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
    }

    function editSafe(str, max) {
        if (!str) return "";
        const d = document.createElement("div");
        d.textContent = str;
        return d.innerHTML.slice(0, max || 99999);
    }

    function slugify(title) {
        return String(title || "")
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9\s\-]/g, " ")
            .replace(/\s+/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 100);
    }

    function setError(msg) {
        const el = document.getElementById("editorialError");
        if (el) el.textContent = msg || "";
    }

    // ── statusBadge ─────────────────────────────────────────────
    function statusBadge(status) {
        if (status === "published") return `<span class="badge bg-success">Published</span>`;
        if (status === "scheduled") return `<span class="badge bg-info text-dark">Terjadwal</span>`;
        return `<span class="badge bg-warning text-dark">Draft</span>`;
    }

    // ── apiFetch wrapper ─────────────────────────────────────────────
    async function callApi(url, options = {}) {
        const tok = editToken();
        const headers = {
            "Content-Type": "application/json",
            ...(tok ? { "Authorization": `Bearer ${tok}` } : {}),
            ...(options.headers || {})
        };
        try {
            const res  = await fetch(url, { ...options, headers });
            const json = await res.json().catch(() => ({ success: false, message: `HTTP ${res.status}` }));
            return { ok: res.ok, status: res.status, json };
        } catch (err) {
            console.error("editorial callApi error:", err);
            return { ok: false, status: 0, json: { success: false, message: "Kesalahan jaringan" } };
        }
    }

    // ── Confirmation dialog ─────────────────────────────────────────────
    async function confirmDanger(title, text) {
        if (typeof Swal !== "undefined") {
            const r = await Swal.fire({
                title, text,
                icon:  "warning",
                showCancelButton:  true,
                confirmButtonText: "Ya, Lanjutkan",
                cancelButtonText:  "Batal",
                confirmButtonColor: "#dc3545"
            });
            return r.isConfirmed;
        }
        return window.confirm(`${title}\n${text}`);
    }

    // ─────────────────────────────────────────────────────────────────
    // Tab switching inside modal
    // ─────────────────────────────────────────────────────────────────
    function initTabs() {
        document.querySelectorAll("[data-editorial-tab]").forEach(btn => {
            btn.addEventListener("click", () => {
                const tab = btn.dataset.editorialTab;

                document.querySelectorAll("[data-editorial-tab]").forEach(b => b.classList.remove("active"));
                document.querySelectorAll(".editorial-tab-pane").forEach(p => p.classList.add("d-none"));

                btn.classList.add("active");
                const key  = tab.charAt(0).toUpperCase() + tab.slice(1);
                const pane = document.getElementById(`editorialTab${key}`);
                if (pane) pane.classList.remove("d-none");

                if (tab === "sources" && _state.currentId) {
                    loadSources(_state.currentId);
                }
            });
        });
    }

    // ─────────────────────────────────────────────────────────────────
    // Load stats
    // ─────────────────────────────────────────────────────────────────
    async function loadStats() {
        const base   = editorialApiBase();
        const counts = await Promise.all([
            callApi(`${base}?limit=1`),
            callApi(`${base}?limit=1&status=published`),
            callApi(`${base}?limit=1&status=draft`),
            callApi(`${base}?limit=1&status=scheduled`)
        ]);
        const n = r => (r.ok && r.json.meta ? r.json.meta.total : "?");
        const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        setEl("editStatTotal",     n(counts[0]));
        setEl("editStatPublished", n(counts[1]));
        setEl("editStatDraft",     n(counts[2]));
        setEl("editStatScheduled", n(counts[3]));
    }

    // ─────────────────────────────────────────────────────────────────
    // Load article list
    // ─────────────────────────────────────────────────────────────────
    async function editorialLoadArticles(page) {
        if (page) _state.page = page;

        const search   = document.getElementById("editSearchInput")?.value.trim()   || "";
        const status   = document.getElementById("editStatusFilter")?.value          || "";
        const category = document.getElementById("editCategoryFilter")?.value        || "";

        const tbody = document.getElementById("editorialTableBody");
        if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-4"><span data-csp-style="s443072299c4fef">Memuat...</span></td></tr>`;

        const params = new URLSearchParams({ page: _state.page, limit: 20 });
        if (search)   params.set("search",   search);
        if (status)   params.set("status",   status);
        if (category) params.set("category", category);

        const { ok, json } = await callApi(`${editorialApiBase()}?${params}`);

        if (!ok || !json.success) {
            if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="text-center text-danger py-4">${editSafe(json.message || "Gagal memuat", 200)}</td></tr>`;
            return;
        }

        _state.articles   = json.data   || [];
        _state.total      = json.meta?.total      || 0;
        _state.totalPages = json.meta?.total_pages || 1;
        _state.selected   = new Set();

        renderTable();
        updatePagination();
        updateBulkBar();

        const lbl = document.getElementById("editorialCountLabel");
        if (lbl) lbl.textContent = `${_state.total} artikel`;

        loadStats().catch(() => {});
    }
    window.editorialLoadArticles = editorialLoadArticles;

    // ─────────────────────────────────────────────────────────────────
    // Render table
    // ─────────────────────────────────────────────────────────────────
    function renderTable() {
        const tbody = document.getElementById("editorialTableBody");
        if (!tbody) return;
        if (!_state.articles.length) {
            tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-4">Tidak ada artikel ditemukan.</td></tr>`;
            return;
        }
        tbody.innerHTML = _state.articles.map(art => `
            <tr>
                <td><input type="checkbox" class="form-check-input edit-row-check" data-id="${art.id}" data-csp-onchange="editorialRowCheck(this)" ${_state.selected.has(art.id) ? "checked" : ""}></td>
                <td data-csp-style="sc388235ac6981b">
                    <div class="fw-semibold" data-csp-style="sa76891724bd566" title="${editSafe(art.title,200)}">${editSafe(art.title,80)}</div>
                    ${art.excerpt ? `<div class="text-muted small" data-csp-style="sa76891724bd566">${editSafe(art.excerpt,80)}</div>` : ""}
                    <div class="small mt-1 font-monospace" data-csp-style="s4a17b70ac0d765">/berita/${editSafe(art.slug,60)}</div>
                </td>
                <td><span class="badge bg-dark-subtle border" data-csp-style="s500708668cdda3">${editSafe(art.category,40)}</span></td>
                <td class="text-muted small text-nowrap">${editSafe(art.author,40)}</td>
                <td>${statusBadge(art.status)}</td>
                <td class="text-muted small text-nowrap">${editFmtDate(art.published_at || art.created_at)}</td>
                <td class="text-muted small text-nowrap">${art.view_count || 0}</td>
                <td>
                    <div class="d-flex gap-1 flex-nowrap">
                        <button class="btn btn-xs btn-outline-primary" data-csp-onclick="editorialOpenEdit(${art.id})" title="Edit"><i class="bi bi-pencil"></i></button>
                        ${art.status !== "published"
                            ? `<button class="btn btn-xs btn-outline-success" data-csp-onclick="editorialPublishOne(${art.id})" title="Publish"><i class="bi bi-send-check"></i></button>`
                            : `<button class="btn btn-xs btn-outline-secondary" data-csp-onclick="editorialUnpublishOne(${art.id})" title="Draft"><i class="bi bi-file-earmark"></i></button>`
                        }
        <a class="btn btn-xs btn-outline-light" href="/berita/${encodeURIComponent(art.slug)}" target="_blank" title="Lihat publik"><i class="bi bi-box-arrow-up-right"></i></a>
                        <button class="btn btn-xs btn-outline-danger" data-csp-onclick="editorialDeleteOne(${art.id},'${editSafe(art.title,60)}')" title="Hapus"><i class="bi bi-trash"></i></button>
                    </div>
                </td>
            </tr>
        `).join("");
    }

    // ─────────────────────────────────────────────────────────────────
    // Pagination
    // ─────────────────────────────────────────────────────────────────
    function updatePagination() {
        const prev = document.getElementById("editPrevBtn");
        const next = document.getElementById("editNextBtn");
        const info = document.getElementById("editPageInfo");
        if (prev) prev.disabled = _state.page <= 1;
        if (next) next.disabled = _state.page >= _state.totalPages;
        if (info) info.textContent = `Halaman ${_state.page} / ${_state.totalPages} (${_state.total} artikel)`;
    }

    function editorialChangePage(delta) {
        const n = _state.page + delta;
        if (n < 1 || n > _state.totalPages) return;
        editorialLoadArticles(n);
    }
    window.editorialChangePage = editorialChangePage;

    // ─────────────────────────────────────────────────────────────────
    // Selection / bulk
    // ─────────────────────────────────────────────────────────────────
    function editorialRowCheck(checkbox) {
        const id = parseInt(checkbox.dataset.id);
        checkbox.checked ? _state.selected.add(id) : _state.selected.delete(id);
        updateBulkBar();
    }
    window.editorialRowCheck = editorialRowCheck;

    function editorialToggleAll(checked) {
        _state.articles.forEach(a => checked ? _state.selected.add(a.id) : _state.selected.delete(a.id));
        document.querySelectorAll(".edit-row-check").forEach(cb => cb.checked = checked);
        updateBulkBar();
    }
    window.editorialToggleAll = editorialToggleAll;

    function updateBulkBar() {
        const bar = document.getElementById("editBulkBar");
        const cnt = document.getElementById("editBulkCount");
        if (!bar) return;
        const n = _state.selected.size;
        bar.classList.toggle("d-none", n === 0);
        if (cnt) cnt.textContent = `${n} dipilih`;
    }

    // ─────────────────────────────────────────────────────────────────
    // Debounce search
    // ─────────────────────────────────────────────────────────────────
    function editorialDebouncedLoad() {
        clearTimeout(_searchTimer);
        _searchTimer = setTimeout(() => editorialLoadArticles(1), 380);
    }
    window.editorialDebouncedLoad = editorialDebouncedLoad;

    // ─────────────────────────────────────────────────────────────────
    // Delete single
    // ─────────────────────────────────────────────────────────────────
    async function editorialDeleteOne(id, title) {
        const ok = await confirmDanger("Hapus Artikel?", `"${title}" akan dihapus permanen beserta semua sumber riset-nya.`);
        if (!ok) return;
        const { ok: resOk, json } = await callApi(`${editorialApiBase()}/${id}`, { method: "DELETE" });
        if (resOk && json.success) {
            toast("Artikel berhasil dihapus");
            editorialLoadArticles();
        } else {
            toast(json.message || "Gagal menghapus artikel", true);
        }
    }
    window.editorialDeleteOne = editorialDeleteOne;

    // ─────────────────────────────────────────────────────────────────
    // Publish / unpublish single
    // ─────────────────────────────────────────────────────────────────
    async function editorialPublishOne(id) {
        const { ok, json } = await callApi(`${editorialApiBase()}/${id}/publish`, { method: "PATCH" });
        if (ok && json.success) {
            toast("Artikel berhasil dipublikasikan");
            editorialLoadArticles();
        } else {
            toast(json.message || "Gagal mempublikasikan", true);
        }
    }
    window.editorialPublishOne = editorialPublishOne;

    async function editorialUnpublishOne(id) {
        const { ok, json } = await callApi(`${editorialApiBase()}/${id}/unpublish`, { method: "PATCH" });
        if (ok && json.success) {
            toast("Artikel dikembalikan ke draft");
            editorialLoadArticles();
        } else {
            toast(json.message || "Gagal mengubah status", true);
        }
    }
    window.editorialUnpublishOne = editorialUnpublishOne;

    // ─────────────────────────────────────────────────────────────────
    // Bulk action
    // ─────────────────────────────────────────────────────────────────
    async function editorialBulkAction(action) {
        const ids = [..._state.selected];
        if (!ids.length) return;

        if (action === "delete") {
            const confirmed = await confirmDanger(`Hapus ${ids.length} Artikel?`, "Tindakan ini tidak dapat dibatalkan.");
            if (!confirmed) return;
        }

        // Bulk endpoint: /api/news/admin/articles/bulk
        const base = editorialApiBase().replace(/\/admin\/articles$/, "");
        const { ok, json } = await callApi(`${base}/admin/articles/bulk`, {
            method: "PATCH",
            body:   JSON.stringify({ ids, action })
        });

        if (ok && json.success) {
            toast(json.message || `${ids.length} artikel berhasil diperbarui`);
            _state.selected = new Set();
            editorialLoadArticles();
        } else {
            toast(json.message || "Gagal menjalankan aksi bulk", true);
        }
    }
    window.editorialBulkAction = editorialBulkAction;

    // ─────────────────────────────────────────────────────────────────
    // Modal: open create
    // ─────────────────────────────────────────────────────────────────
    function editorialOpenCreate() {
        _state.currentId  = null;
        _state.slugLocked = false;

        const fields = {
            "editArticleId": "", "editTitle": "", "editSlug": "",
            "editAuthor": "NexShop Editorial", "editExcerpt": "",
            "editImageUrl": "", "editImageAlt": "", "editImageCredit": "",
            "editTags": "", "editKeywords": "", "editSeoTitle": "",
            "editSeoDesc": "", "editScheduledAt": ""
        };
        Object.entries(fields).forEach(([id, val]) => {
            const el = document.getElementById(id);
            if (el) el.value = val;
        });

        const catEl = document.getElementById("editCategory");
        if (catEl) catEl.value = "Gaming";

        const editorEl = document.getElementById("editContentEditor");
        if (editorEl) editorEl.innerHTML = "";

        const featEl = document.getElementById("editIsFeatured");
        if (featEl) featEl.checked = false;
        const pinEl = document.getElementById("editIsPinned");
        if (pinEl) pinEl.checked = false;

        // Clear sources
        const srcList = document.getElementById("editSourcesList");
        if (srcList) srcList.innerHTML = `<p class="text-muted small text-center py-3">Simpan artikel terlebih dahulu, lalu tambah sumber di sini.</p>`;

        const imgWrap = document.getElementById("editImagePreviewWrap");
        if (imgWrap) imgWrap.style.display = "none";

        setError("");
        updateWordCount();
        updateSeoCounters();

        const titleSpan = document.getElementById("editorialModalTitleText");
        if (titleSpan) titleSpan.textContent = "Tulis Artikel Baru";

        document.querySelector("[data-editorial-tab='content']")?.click();

        bootstrap.Modal.getOrCreateInstance(document.getElementById("editorialModal")).show();
    }
    window.editorialOpenCreate = editorialOpenCreate;

    // ─────────────────────────────────────────────────────────────────
    // Modal: open edit
    // ─────────────────────────────────────────────────────────────────
    async function editorialOpenEdit(id) {
        const { ok, json } = await callApi(`${editorialApiBase()}/${id}`);
        if (!ok || !json.success) {
            toast(json.message || "Gagal memuat artikel", true);
            return;
        }

        const art = json.data;
        _state.currentId  = art.id;
        _state.slugLocked = true;

        const setVal = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val ?? ""; };
        setVal("editArticleId",    art.id);
        setVal("editTitle",         art.title);
        setVal("editSlug",          art.slug);
        setVal("editCategory",      art.category   || "Gaming");
        setVal("editAuthor",        art.author     || "NexShop Editorial");
        setVal("editExcerpt",       art.excerpt    || "");
        setVal("editImageUrl",      art.image_url  || "");
        setVal("editImageAlt",      art.image_alt  || "");
        setVal("editImageCredit",   art.image_credit || "");
        setVal("editTags",          (art.tags     || []).join(", "));
        setVal("editKeywords",      (art.keywords || []).join(", "));
        setVal("editSeoTitle",      art.seo_title        || "");
        setVal("editSeoDesc",       art.seo_description  || "");

        const editorEl = document.getElementById("editContentEditor");
        if (editorEl) editorEl.innerHTML = art.content || "";

        const featEl = document.getElementById("editIsFeatured");
        if (featEl) featEl.checked = !!art.is_featured;
        const pinEl = document.getElementById("editIsPinned");
        if (pinEl) pinEl.checked = !!art.is_pinned;

        if (art.scheduled_at) {
            const d = new Date(art.scheduled_at);
            const pad = n => n.toString().padStart(2, '0');
            const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
            setVal("editScheduledAt", local);
        } else {
            setVal("editScheduledAt", "");
        }

        previewImage();
        setError("");
        updateWordCount();
        updateSeoCounters();

        // Render sources if already loaded with article
        if (art.sources && art.sources.length) {
            renderSources(art.sources);
        } else {
            const srcList = document.getElementById("editSourcesList");
            if (srcList) srcList.innerHTML = `<p class="text-muted small text-center py-3">Belum ada sumber ditambahkan.</p>`;
        }

        const titleSpan = document.getElementById("editorialModalTitleText");
        if (titleSpan) {
            const t = art.title.slice(0, 50);
            titleSpan.textContent = `Edit: ${t}${art.title.length > 50 ? "…" : ""}`;
        }

        document.querySelector("[data-editorial-tab='content']")?.click();
        bootstrap.Modal.getOrCreateInstance(document.getElementById("editorialModal")).show();
    }
    window.editorialOpenEdit = editorialOpenEdit;

    // ─────────────────────────────────────────────────────────────────
    // Save article
    // ─────────────────────────────────────────────────────────────────
    async function editorialSave(action = "draft") {
        setError("");

        const title = document.getElementById("editTitle")?.value.trim() || "";
        if (!title) { setError("Judul artikel wajib diisi."); return; }

        const content     = document.getElementById("editContentEditor")?.innerHTML || "";
        const excerpt     = document.getElementById("editExcerpt")?.value.trim() || "";
        const category    = document.getElementById("editCategory")?.value || "Gaming";
        const author      = document.getElementById("editAuthor")?.value.trim() || "NexShop Editorial";
        const slugRaw     = document.getElementById("editSlug")?.value.trim() || "";
        const imageUrl    = document.getElementById("editImageUrl")?.value.trim() || "";
        const imageAlt    = document.getElementById("editImageAlt")?.value.trim() || "";
        const imageCredit = document.getElementById("editImageCredit")?.value.trim() || "";
        const tags        = (document.getElementById("editTags")?.value || "").split(",").map(t => t.trim()).filter(Boolean);
        const keywords    = (document.getElementById("editKeywords")?.value || "").split(",").map(t => t.trim()).filter(Boolean);
        const seoTitle    = document.getElementById("editSeoTitle")?.value.trim() || "";
        const seoDesc     = document.getElementById("editSeoDesc")?.value.trim() || "";
        const isFeatured  = document.getElementById("editIsFeatured")?.checked || false;
        const isPinned    = document.getElementById("editIsPinned")?.checked || false;
        const schedRaw    = document.getElementById("editScheduledAt")?.value || "";

        let scheduledAt = null;
        if (schedRaw) {
            const d = new Date(schedRaw);
            if (!isNaN(d.getTime())) scheduledAt = d.toISOString();
        }

        const payload = {
            title, content, excerpt, category, author, tags, keywords,
            seo_title: seoTitle, seo_description: seoDesc,
            image_url: imageUrl || null, image_alt: imageAlt || null, image_credit: imageCredit || null,
            is_featured: isFeatured, is_pinned: isPinned,
            scheduled_at: scheduledAt
        };
        if (slugRaw) payload.slug = slugRaw;

        const saveBtn    = document.getElementById("editorialSaveDraftBtn");
        const pubBtn     = document.getElementById("editorialPublishBtn");
        if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Menyimpan...'; }
        if (pubBtn)  { pubBtn.disabled  = true; }

        try {
            const id  = _state.currentId;
            const url = id ? `${editorialApiBase()}/${id}` : editorialApiBase();
            const method = id ? "PUT" : "POST";

            const { ok, json } = await callApi(url, { method, body: JSON.stringify(payload) });

            if (!ok || !json.success) {
                setError(json.message || "Gagal menyimpan artikel.");
                return;
            }

            const savedId = json.data?.id;

            // If action = publish → publish after save
            if (action === "publish" && savedId) {
                const { ok: pOk, json: pJson } = await callApi(`${editorialApiBase()}/${savedId}/publish`, { method: "PATCH" });
                if (!pOk || !pJson.success) {
                    toast(`Disimpan, tapi gagal publish: ${pJson.message || ""}`, true);
                } else {
                    toast("Artikel berhasil dipublikasikan!");
                }
            }
            // If scheduledAt → schedule
            else if (scheduledAt && savedId) {
                const { ok: sOk } = await callApi(`${editorialApiBase()}/${savedId}/schedule`, {
                    method: "PATCH",
                    body:   JSON.stringify({ scheduled_at: scheduledAt })
                });
                if (sOk) toast("Artikel berhasil dijadwalkan!");
            }
            else {
                toast(id ? "Artikel diperbarui (draft)" : "Artikel disimpan sebagai draft");
            }

            // Update state if newly created
            if (!id && savedId) {
                _state.currentId = savedId;
                document.getElementById("editArticleId").value = savedId;
            }

            bootstrap.Modal.getOrCreateInstance(document.getElementById("editorialModal")).hide();
            editorialLoadArticles();

        } catch (err) {
            setError("Terjadi kesalahan. Coba lagi.");
            console.error("editorialSave error:", err);
        } finally {
            if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="bi bi-floppy me-1"></i>Simpan Draft'; }
            if (pubBtn)  { pubBtn.disabled  = false; }
        }
    }
    window.editorialSave = editorialSave;

    // ─────────────────────────────────────────────────────────────────
    // Editor toolbar
    // ─────────────────────────────────────────────────────────────────
    function editFmt(command) {
        document.getElementById("editContentEditor")?.focus();
        document.execCommand(command, false, null);
        updateWordCount();
    }
    window.editFmt = editFmt;

    function editInsertBlock(tag) {
        document.getElementById("editContentEditor")?.focus();
        document.execCommand("formatBlock", false, tag);
        updateWordCount();
    }
    window.editInsertBlock = editInsertBlock;

    function editInsertHr() {
        document.getElementById("editContentEditor")?.focus();
        document.execCommand("insertHTML", false, "<hr>");
    }
    window.editInsertHr = editInsertHr;

    function editInsertLink() {
        const url  = prompt("URL link:");
        const text = prompt("Teks (kosongkan = pakai teks yang dipilih):");
        if (!url) return;
        document.getElementById("editContentEditor")?.focus();
        if (text) {
            const escaped = text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
            document.execCommand("insertHTML", false, `<a href="${url.replace(/"/g,'&quot;')}" target="_blank" rel="noopener noreferrer">${escaped}</a>`);
        } else {
            document.execCommand("createLink", false, url);
        }
    }
    window.editInsertLink = editInsertLink;

    // ─────────────────────────────────────────────────────────────────
    // Slug / SEO / word count
    // ─────────────────────────────────────────────────────────────────
    function editorialAutoSlug() {
        if (_state.slugLocked) return;
        const title  = document.getElementById("editTitle")?.value || "";
        const slugEl = document.getElementById("editSlug");
        if (slugEl) slugEl.value = slugify(title);
    }
    window.editorialAutoSlug = editorialAutoSlug;

    function editorialSlugManual() {
        const slugEl = document.getElementById("editSlug");
        if (!slugEl) return;
        const raw = slugEl.value.toLowerCase().replace(/[^a-z0-9\-]/g, "-").replace(/-+/g, "-");
        slugEl.value = raw;
        _state.slugLocked = raw.length > 0;
    }
    window.editorialSlugManual = editorialSlugManual;

    function updateWordCount() {
        const editor  = document.getElementById("editContentEditor");
        const counter = document.getElementById("editWordCount");
        if (!editor || !counter) return;
        const text  = (editor.innerText || editor.textContent || "").trim();
        const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
        counter.textContent = `${words} kata`;
    }

    function updateSeoCounters() {
        const t = document.getElementById("editSeoTitle")?.value.length || 0;
        const d = document.getElementById("editSeoDesc")?.value.length  || 0;
        const tc = document.getElementById("editSeoTitleCount");
        const dc = document.getElementById("editSeoDescCount");
        if (tc) tc.textContent = t;
        if (dc) dc.textContent = d;
    }

    function editorialPreviewImage() {
        previewImage();
    }
    window.editorialPreviewImage = editorialPreviewImage;

    function previewImage() {
        const url  = document.getElementById("editImageUrl")?.value.trim() || "";
        const img  = document.getElementById("editImagePreview");
        const wrap = document.getElementById("editImagePreviewWrap");
        if (!img || !wrap) return;
        if (!url || !url.startsWith("https://")) { wrap.style.display = "none"; return; }
        img.src = url;
        img.onerror = () => { wrap.style.display = "none"; };
        img.onload  = () => { wrap.style.display = ""; };
        wrap.style.display = "";
    }

    // ─────────────────────────────────────────────────────────────────
    // Sources
    // ─────────────────────────────────────────────────────────────────
    async function loadSources(articleId) {
        const { ok, json } = await callApi(`${editorialApiBase()}/${articleId}/sources`);
        if (!ok || !json.success) return;
        renderSources(json.data || []);
    }

    function renderSources(sources) {
        const list = document.getElementById("editSourcesList");
        if (!list) return;
        if (!sources.length) {
            list.innerHTML = `<p class="text-muted small text-center py-3">Belum ada sumber ditambahkan.</p>`;
            return;
        }
        list.innerHTML = sources.map(s => `
            <div class="card p-3 position-relative" id="src-${s.id}" data-csp-style="s31a951a799f3cf">
                <button class="btn btn-xs btn-outline-danger position-absolute top-0 end-0 m-2" data-csp-onclick="editorialDeleteSource(${s.id})" title="Hapus sumber"><i class="bi bi-trash"></i></button>
                <div class="small fw-semibold mb-1">${editSafe(s.source_name, 80)}</div>
                <a href="${editSafe(s.source_url, 500)}" target="_blank" rel="noopener noreferrer" class="small text-violet" data-csp-style="s96c1ef40ed3d51">${editSafe(s.source_url, 80)}</a>
                ${s.source_title ? `<div class="small text-muted fst-italic mt-1">${editSafe(s.source_title, 100)}</div>` : ""}
                ${s.notes ? `<div class="small text-muted mt-1 pt-1" data-csp-style="s63137008f00be2"><i class="bi bi-lock me-1"></i>${editSafe(s.notes, 200)}</div>` : ""}
            </div>
        `).join("");
    }

    async function editorialAddSource() {
        const articleId = _state.currentId;
        if (!articleId) {
            toast("Simpan artikel terlebih dahulu sebelum menambah sumber.", true);
            return;
        }
        const name  = document.getElementById("addSourceName")?.value.trim() || "";
        const url   = document.getElementById("addSourceUrl")?.value.trim()  || "";
        const title = document.getElementById("addSourceTitle")?.value.trim() || "";
        const date  = document.getElementById("addSourceDate")?.value || "";
        const notes = document.getElementById("addSourceNotes")?.value.trim() || "";

        if (!name) { toast("Nama media wajib diisi.", true); return; }
        if (!url || !url.startsWith("https://")) { toast("Source URL harus berupa HTTPS URL yang valid.", true); return; }

        const { ok, json } = await callApi(`${editorialApiBase()}/${articleId}/sources`, {
            method: "POST",
            body:   JSON.stringify({
                source_name: name, source_url: url,
                source_title: title || null,
                source_published_at: date || null,
                notes: notes || null
            })
        });

        if (ok && json.success) {
            toast("Sumber ditambahkan");
            ["addSourceName","addSourceUrl","addSourceTitle","addSourceDate","addSourceNotes"].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = "";
            });
            loadSources(articleId);
        } else {
            toast(json.message || "Gagal menambah sumber", true);
        }
    }
    window.editorialAddSource = editorialAddSource;

    async function editorialDeleteSource(sourceId) {
        const id = _state.currentId;
        if (!id) return;
        const { ok, json } = await callApi(`${editorialApiBase()}/${id}/sources/${sourceId}`, { method: "DELETE" });
        if (ok && json.success) {
            document.getElementById(`src-${sourceId}`)?.remove();
            toast("Sumber dihapus");
        } else {
            toast(json.message || "Gagal menghapus sumber", true);
        }
    }
    window.editorialDeleteSource = editorialDeleteSource;

    // ─────────────────────────────────────────────────────────────────
    // Attach field events
    // ─────────────────────────────────────────────────────────────────
    function attachFieldEvents() {
        document.getElementById("editContentEditor")?.addEventListener("input", updateWordCount);
        document.getElementById("editSeoTitle")?.addEventListener("input", updateSeoCounters);
        document.getElementById("editSeoDesc") ?.addEventListener("input", updateSeoCounters);
        document.getElementById("editImageUrl")?.addEventListener("blur",  previewImage);
    }

    // ─────────────────────────────────────────────────────────────────
    // switchView integration
    // ─────────────────────────────────────────────────────────────────
    function onViewOpen() {
        editorialLoadArticles(1);
    }

    // ─────────────────────────────────────────────────────────────────
    // DOMContentLoaded init
    // ─────────────────────────────────────────────────────────────────
    document.addEventListener("DOMContentLoaded", function () {
        initTabs();
        attachFieldEvents();

        // Hook into switchView if it exists in dashboard.js
        if (typeof window.switchView === "function") {
            const _orig = window.switchView;
            window.switchView = function (viewName) {
                _orig.call(this, viewName);
                if (viewName === "editorial") onViewOpen();
            };
        }

        // Also listen directly on nav links for editorial view
        document.querySelectorAll("[data-view='editorial']").forEach(link => {
            link.addEventListener("click", function () {
                setTimeout(onViewOpen, 80);
            });
        });
    });

})();
