// ===========================================================
// PANEL WEBHOOK RELAY (dashboard admin — Settings > Webhook Relay)
//
// Dipisah dari dashboard.js karena file itu sudah kelewat besar. Semua
// pemanggilan API lewat apiFetch() milik dashboard.js, jadi gerbang akses
// (verifikasi role + Security PIN) dan batas sesi idle otomatis berlaku
// di sini juga.
//
// Konteks fiturnya: TokoVoucher cuma menyediakan SATU slot URL callback per
// akun member dan slot itu dipakai NexShop. Panel ini mendaftarkan URL
// toko/reseller lain supaya callback yang masuk ke NexShop diteruskan ke
// mereka. Logika kirim + retry-nya ada di backend
// (services/webhookRelayService.js).
//
// SEMUA akses DOM di file ini defensif (`?.` / cek null). Kalau panelnya
// belum ada di HTML — misalnya browser masih memegang dashboard.html versi
// lama dari cache — file ini diam saja dan tidak boleh menjatuhkan bagian
// dashboard yang lain.
// ===========================================================

(function () {
    "use strict";

    let whEndpoints = [];
    let whLoading = false;

    // dashboard.js yang punya helper-helper ini. Dibungkus supaya file ini
    // tetap aman kalau urutan <script> berubah.
    function toast(message, isError) {
        if (typeof showToast === "function") showToast(message, !!isError);
        else if (isError) console.error(message);
    }

    function esc(value) {
        if (typeof escapeHtml === "function") return escapeHtml(value);
        return String(value === null || value === undefined ? "" : value)
            .replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    }

    function el(id) {
        return document.getElementById(id);
    }

    function waktuSingkat(nilai) {
        if (!nilai) return "-";
        const d = new Date(nilai);
        if (Number.isNaN(d.getTime())) return "-";
        return d.toLocaleString("id-ID", {
            day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit"
        });
    }

    function potong(teks, panjang) {
        const value = String(teks || "");
        return value.length > panjang ? value.slice(0, panjang - 1) + "…" : value;
    }

    async function salinTeks(teks, pesanSukses) {
        try {
            await navigator.clipboard.writeText(teks);
            toast(pesanSukses || "Disalin ke clipboard");
        } catch (err) {
            toast("Browser menolak akses clipboard. Salin manual, ya.", true);
        }
    }

    // Migration 009 belum dijalankan -> backend balas 503 +
    // WEBHOOK_RELAY_NOT_SETUP. Ditampilkan sebagai peringatan yang
    // menjelaskan langkahnya, bukan toast error yang bikin bingung.
    function tampilkanSetupWarning(pesan) {
        const box = el("whSetupWarning");
        const teks = el("whSetupWarningText");
        if (!box || !teks) return;
        teks.textContent = pesan || "Fitur Webhook Relay belum di-setup di database.";
        box.classList.remove("d-none");
    }

    function sembunyikanSetupWarning() {
        el("whSetupWarning")?.classList.add("d-none");
    }

    // Balasan JSON + deteksi "belum di-setup" dijadikan satu supaya tiap
    // pemanggil tidak mengulang pola yang sama.
    async function whFetch(path, options) {
        const res = await apiFetch("/webhooks" + path, options || {});
        const data = await res.json().catch(() => ({}));
        if (res.status === 503 && data.code === "WEBHOOK_RELAY_NOT_SETUP") {
            tampilkanSetupWarning(data.message);
            const err = new Error(data.message || "Webhook Relay belum di-setup");
            err.notSetup = true;
            throw err;
        }
        if (!res.ok) throw new Error(data.message || "Permintaan gagal (HTTP " + res.status + ")");
        return data;
    }

    // ===========================================================
    // Info relay + penghitung antrean
    // ===========================================================
    async function muatInfo() {
        try {
            const data = await whFetch("/admin/info");
            const input = el("whInboundUrl");
            if (input) input.value = data.inbound_url || "-";

            if (data.setup === false) {
                tampilkanSetupWarning(data.setup_message);
            } else {
                sembunyikanSetupWarning();
            }

            const counts = data.counts || {};
            const set = (id, value) => { const node = el(id); if (node) node.textContent = value || 0; };
            set("whCountEndpoints", counts.endpoints);
            set("whCountActive", counts.active);
            set("whCountPending", counts.pending);
            set("whCountFailed", counts.failed);
            set("whCountDead", counts.dead);
        } catch (err) {
            if (!err.notSetup) toast(err.message, true);
        }
    }

    // ===========================================================
    // Daftar endpoint
    // ===========================================================
    function baris(endpoint) {
        const routing = endpoint.forward_all
            ? '<span class="badge text-bg-warning">Semua callback</span>'
            : '<code>' + esc(endpoint.ref_prefix || "") + '</code>';
        const status = endpoint.is_active
            ? '<span class="badge text-bg-success">Aktif</span>'
            : '<span class="badge text-bg-secondary">Nonaktif</span>';
        const terakhir = endpoint.last_delivery_at
            ? waktuSingkat(endpoint.last_delivery_at) +
              ' <span class="badge text-bg-' + (endpoint.last_status === "success" ? "success" : "danger") +
              '">' + esc(endpoint.last_status || "-") + "</span>"
            : '<span class="text-muted">Belum pernah</span>';

        return (
            '<tr data-endpoint="' + esc(endpoint.id) + '">' +
            '<td><div class="fw-semibold">' + esc(endpoint.label) + "</div>" +
            '<div class="small">' + status +
            (endpoint.owner_user_id ? ' <span class="text-muted">User #' + esc(endpoint.owner_user_id) + "</span>" : "") +
            "</div>" +
            (endpoint.owner_note ? '<div class="text-muted small">' + esc(potong(endpoint.owner_note, 60)) + "</div>" : "") +
            "</td>" +
            '<td class="small font-monospace" data-csp-style="s1104ee9ae4c187">' + esc(endpoint.target_url) + "</td>" +
            "<td>" + routing + "</td>" +
            '<td class="text-center"><span class="text-success">' + (endpoint.total_delivered || 0) + "</span> / " +
            '<span class="text-danger">' + (endpoint.total_failed || 0) + "</span></td>" +
            '<td class="small">' + terakhir + "</td>" +
            '<td class="text-end text-nowrap">' +
            '<button type="button" class="btn btn-sm btn-outline-primary" data-wh-action="test" title="Kirim payload uji"><i class="bi bi-send"></i></button> ' +
            '<button type="button" class="btn btn-sm btn-outline-secondary" data-wh-action="secret" title="Lihat secret (butuh Security PIN)"><i class="bi bi-eye"></i></button> ' +
            '<button type="button" class="btn btn-sm btn-outline-warning" data-wh-action="rotate" title="Ganti secret"><i class="bi bi-arrow-repeat"></i></button> ' +
            '<button type="button" class="btn btn-sm btn-outline-info" data-wh-action="edit" title="Ubah"><i class="bi bi-pencil"></i></button> ' +
            '<button type="button" class="btn btn-sm btn-outline-danger" data-wh-action="delete" title="Hapus"><i class="bi bi-trash"></i></button>' +
            "</td></tr>"
        );
    }

    async function muatEndpoints() {
        const tbody = el("whEndpointsTable");
        if (!tbody) return;
        try {
            const data = await whFetch("/admin/endpoints");
            whEndpoints = data.endpoints || [];

            tbody.innerHTML = whEndpoints.length
                ? whEndpoints.map(baris).join("")
                : '<tr><td colspan="6" class="text-center text-muted py-3">Belum ada endpoint toko lain yang terdaftar.</td></tr>';

            // Filter riwayat ikut disegarkan supaya nama endpoint-nya cocok
            const filter = el("whDeliveryEndpointFilter");
            if (filter) {
                const dipilih = filter.value;
                filter.innerHTML =
                    '<option value="">Semua endpoint</option>' +
                    whEndpoints
                        .map((e) => '<option value="' + esc(e.id) + '">' + esc(e.label) + "</option>")
                        .join("");
                filter.value = dipilih;
            }
        } catch (err) {
            tbody.innerHTML =
                '<tr><td colspan="6" class="text-center text-muted py-3">' +
                esc(err.notSetup ? "Jalankan migration 009 dulu." : err.message) +
                "</td></tr>";
            if (!err.notSetup) toast(err.message, true);
        }
    }

    // ===========================================================
    // Riwayat pengiriman
    // ===========================================================
    const BADGE_STATUS = {
        pending: "text-bg-warning",
        sending: "text-bg-info",
        success: "text-bg-success",
        failed: "text-bg-danger",
        dead: "text-bg-dark"
    };
    const LABEL_STATUS = {
        pending: "Antre",
        sending: "Mengirim",
        success: "Sukses",
        failed: "Gagal",
        dead: "Menyerah"
    };

    async function muatDeliveries() {
        const tbody = el("whDeliveriesTable");
        if (!tbody) return;

        const endpointId = el("whDeliveryEndpointFilter")?.value || "";
        const status = el("whDeliveryStatusFilter")?.value || "";
        const params = new URLSearchParams({ limit: "50" });
        if (endpointId) params.set("endpoint_id", endpointId);
        if (status) params.set("status", status);

        try {
            const data = await whFetch("/admin/deliveries?" + params.toString());
            const rows = data.deliveries || [];
            if (!rows.length) {
                tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-3">Belum ada pengiriman.</td></tr>';
                return;
            }

            tbody.innerHTML = rows
                .map((d) => {
                    const endpoint = whEndpoints.find((e) => e.id === d.endpoint_id);
                    const keterangan = d.last_error
                        ? esc(potong(d.last_error, 80))
                        : d.response_status
                        ? "HTTP " + d.response_status
                        : "-";
                    const bisaRetry = d.status === "failed" || d.status === "dead";
                    return (
                        '<tr data-delivery="' + esc(d.id) + '">' +
                        '<td class="small text-nowrap">' + waktuSingkat(d.created_at) + "</td>" +
                        '<td class="small">' + esc(endpoint ? endpoint.label : "(dihapus)") + "</td>" +
                        '<td class="small font-monospace">' + esc(d.ref_id || "-") + "</td>" +
                        '<td><span class="badge ' + (BADGE_STATUS[d.status] || "text-bg-secondary") + '">' +
                        esc(LABEL_STATUS[d.status] || d.status) + "</span></td>" +
                        '<td class="text-center small">' + (d.attempt_count || 0) + "</td>" +
                        '<td class="small text-muted" data-csp-style="se465f15bd3d46e">' + keterangan + "</td>" +
                        '<td class="text-end">' +
                        (bisaRetry
                            ? '<button type="button" class="btn btn-sm btn-outline-primary" data-wh-delivery-action="retry"><i class="bi bi-arrow-clockwise"></i> Kirim ulang</button>'
                            : "") +
                        "</td></tr>"
                    );
                })
                .join("");
        } catch (err) {
            tbody.innerHTML =
                '<tr><td colspan="7" class="text-center text-muted py-3">' +
                esc(err.notSetup ? "Jalankan migration 009 dulu." : err.message) +
                "</td></tr>";
        }
    }

    // ===========================================================
    // Form tambah / ubah
    // ===========================================================
    function bacaForm() {
        const ownerRaw = el("whOwnerUserId")?.value.trim() || "";
        return {
            label: el("whLabel")?.value.trim() || "",
            target_url: el("whTargetUrl")?.value.trim() || "",
            ref_prefix: el("whRefPrefix")?.value.trim() || "",
            owner_note: el("whOwnerNote")?.value.trim() || "",
            owner_user_id: ownerRaw === "" ? null : Number(ownerRaw),
            forward_all: !!el("whForwardAll")?.checked,
            forward_original_signature: !!el("whForwardOriginalSig")?.checked,
            is_active: !!el("whIsActive")?.checked
        };
    }

    function resetForm() {
        const form = el("whEndpointForm");
        if (form) form.reset();
        const active = el("whIsActive");
        if (active) active.checked = true;
        const editing = el("whEditingId");
        if (editing) editing.value = "";
        const title = el("whFormTitle");
        if (title) title.textContent = "Tambah Endpoint Toko";
        const submit = el("whSubmitBtn");
        if (submit) submit.innerHTML = '<i class="bi bi-plus-lg"></i> Tambah Endpoint';
        el("whCancelEditBtn")?.classList.add("d-none");
        const error = el("whFormError");
        if (error) error.textContent = "";
    }

    function isiFormUntukEdit(endpoint) {
        const set = (id, value) => { const node = el(id); if (node) node.value = value === null || value === undefined ? "" : value; };
        set("whEditingId", endpoint.id);
        set("whLabel", endpoint.label);
        set("whTargetUrl", endpoint.target_url);
        set("whRefPrefix", endpoint.ref_prefix);
        set("whOwnerNote", endpoint.owner_note);
        set("whOwnerUserId", endpoint.owner_user_id);
        const check = (id, value) => { const node = el(id); if (node) node.checked = !!value; };
        check("whForwardAll", endpoint.forward_all);
        check("whForwardOriginalSig", endpoint.forward_original_signature);
        check("whIsActive", endpoint.is_active);

        const title = el("whFormTitle");
        if (title) title.textContent = "Ubah Endpoint: " + endpoint.label;
        const submit = el("whSubmitBtn");
        if (submit) submit.innerHTML = '<i class="bi bi-floppy"></i> Simpan Perubahan';
        el("whCancelEditBtn")?.classList.remove("d-none");
        el("whEndpointForm")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    function tampilkanSecret(secret) {
        const box = el("whSecretBox");
        const value = el("whSecretValue");
        if (!box || !value) {
            toast("Secret: " + secret);
            return;
        }
        value.value = secret;
        box.classList.remove("d-none");
        box.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    async function simpanEndpoint(event) {
        event.preventDefault();
        const errorEl = el("whFormError");
        if (errorEl) errorEl.textContent = "";

        const payload = bacaForm();
        if (!payload.label) {
            if (errorEl) errorEl.textContent = "Nama toko/label wajib diisi.";
            return;
        }
        if (!payload.target_url) {
            if (errorEl) errorEl.textContent = "URL webhook tujuan wajib diisi.";
            return;
        }
        if (!payload.forward_all && !payload.ref_prefix) {
            if (errorEl) {
                errorEl.textContent =
                    "Isi Prefix Ref ID, atau centang 'Terima semua callback'. Tanpa salah satunya endpoint gak akan pernah kebagian callback.";
            }
            return;
        }

        const editingId = el("whEditingId")?.value || "";
        const submit = el("whSubmitBtn");
        if (submit) submit.disabled = true;

        try {
            const data = await whFetch(
                editingId ? "/admin/endpoints/" + encodeURIComponent(editingId) : "/admin/endpoints",
                {
                    method: editingId ? "PUT" : "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                }
            );
            toast(data.message || "Tersimpan");
            // Secret cuma dikirim server sekali, pas endpoint baru dibuat.
            if (data.secret) tampilkanSecret(data.secret);
            resetForm();
            await Promise.all([muatEndpoints(), muatInfo()]);
        } catch (err) {
            if (errorEl) errorEl.textContent = err.message;
            if (!err.notSetup) toast(err.message, true);
        } finally {
            if (submit) submit.disabled = false;
        }
    }

    // ===========================================================
    // Aksi per baris endpoint
    // ===========================================================
    async function aksiEndpoint(action, endpointId, tombol) {
        const endpoint = whEndpoints.find((e) => e.id === endpointId);
        if (!endpoint) return;

        if (action === "edit") {
            isiFormUntukEdit(endpoint);
            return;
        }

        if (action === "delete") {
            const ok = window.Swal
                ? (await Swal.fire({
                      title: "Hapus endpoint?",
                      text: '"' + endpoint.label + '" tidak akan menerima callback lagi. Riwayat pengirimannya ikut terhapus.',
                      icon: "warning",
                      showCancelButton: true,
                      confirmButtonText: "Hapus",
                      cancelButtonText: "Batal",
                      confirmButtonColor: "#dc3545"
                  })).isConfirmed
                : window.confirm('Hapus endpoint "' + endpoint.label + '"?');
            if (!ok) return;

            try {
                const data = await whFetch("/admin/endpoints/" + encodeURIComponent(endpointId), { method: "DELETE" });
                toast(data.message || "Endpoint dihapus");
                await Promise.all([muatEndpoints(), muatDeliveries(), muatInfo()]);
            } catch (err) {
                if (!err.notSetup) toast(err.message, true);
            }
            return;
        }

        if (action === "test") {
            if (tombol) tombol.disabled = true;
            try {
                const data = await whFetch("/admin/endpoints/" + encodeURIComponent(endpointId) + "/test", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: "{}"
                });
                toast(data.message, !!data.failed);
                await Promise.all([muatDeliveries(), muatEndpoints()]);
            } catch (err) {
                if (!err.notSetup) toast(err.message, true);
            } finally {
                if (tombol) tombol.disabled = false;
            }
            return;
        }

        // "secret" dan "rotate" menyentuh kunci tanda tangan -> server minta
        // Security PIN, jadi dibungkus withAdminPin() punya dashboard.js.
        if (action === "secret" || action === "rotate") {
            if (typeof withAdminPin !== "function") {
                toast("Security PIN tidak tersedia di halaman ini.", true);
                return;
            }
            if (action === "rotate") {
                const ok = window.Swal
                    ? (await Swal.fire({
                          title: "Ganti secret?",
                          text: "Secret lama langsung tidak berlaku. Toko penerima harus memperbarui verifikasinya, kalau tidak semua callback mereka akan ditolak sendiri.",
                          icon: "warning",
                          showCancelButton: true,
                          confirmButtonText: "Ganti",
                          cancelButtonText: "Batal"
                      })).isConfirmed
                    : window.confirm("Ganti secret endpoint ini? Secret lama langsung tidak berlaku.");
                if (!ok) return;
            }

            const suffix = action === "secret" ? "/secret" : "/rotate-secret";
            const purpose = action === "secret" ? "melihat secret webhook" : "mengganti secret webhook";
            try {
                await withAdminPin(async (security_pin) => {
                    const data = await whFetch("/admin/endpoints/" + encodeURIComponent(endpointId) + suffix, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ security_pin })
                    });
                    tampilkanSecret(data.secret);
                    if (data.message) toast(data.message);
                }, purpose);
            } catch (err) {
                if (!err.notSetup) toast(err.message || "Security PIN diperlukan", true);
            }
        }
    }

    async function retryDelivery(deliveryId, tombol) {
        if (tombol) tombol.disabled = true;
        try {
            const data = await whFetch("/admin/deliveries/" + encodeURIComponent(deliveryId) + "/retry", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "{}"
            });
            toast(data.message || "Diantre ulang");
            await Promise.all([muatDeliveries(), muatEndpoints(), muatInfo()]);
        } catch (err) {
            if (!err.notSetup) toast(err.message, true);
        } finally {
            if (tombol) tombol.disabled = false;
        }
    }

    // ===========================================================
    // Pemasangan listener
    //
    // Semua pakai delegasi di elemen yang ada sejak awal, jadi baris tabel
    // yang dirender ulang tidak perlu dipasangi listener satu per satu.
    // ===========================================================
    function pasangListener() {
        el("whEndpointForm")?.addEventListener("submit", simpanEndpoint);
        el("whCancelEditBtn")?.addEventListener("click", resetForm);
        el("whRefreshBtn")?.addEventListener("click", () => window.whLoadPanel(true));

        el("whCopyInboundBtn")?.addEventListener("click", () => {
            const value = el("whInboundUrl")?.value || "";
            if (value && value !== "-") salinTeks(value, "URL callback disalin");
        });
        el("whCopySecretBtn")?.addEventListener("click", () => {
            const value = el("whSecretValue")?.value || "";
            if (value) salinTeks(value, "Secret disalin");
        });
        el("whCloseSecretBtn")?.addEventListener("click", () => {
            const box = el("whSecretBox");
            const value = el("whSecretValue");
            if (value) value.value = "";
            box?.classList.add("d-none");
        });

        el("whEndpointsTable")?.addEventListener("click", (event) => {
            const tombol = event.target.closest("[data-wh-action]");
            if (!tombol) return;
            const row = tombol.closest("tr[data-endpoint]");
            if (!row) return;
            aksiEndpoint(tombol.dataset.whAction, row.dataset.endpoint, tombol);
        });

        el("whDeliveriesTable")?.addEventListener("click", (event) => {
            const tombol = event.target.closest("[data-wh-delivery-action]");
            if (!tombol) return;
            const row = tombol.closest("tr[data-delivery]");
            if (!row) return;
            retryDelivery(row.dataset.delivery, tombol);
        });

        el("whDeliveryEndpointFilter")?.addEventListener("change", muatDeliveries);
        el("whDeliveryStatusFilter")?.addEventListener("change", muatDeliveries);
    }

    // Dipanggil dashboard.js pas admin meninggalkan tab ini.
    window.whScrubSecret = function whScrubSecret() {
        const value = el("whSecretValue");
        if (value) value.value = "";
        el("whSecretBox")?.classList.add("d-none");
    };

    // Dipanggil dashboard.js pas tab Webhook Relay dibuka. Ada penjaga
    // `whLoading` supaya klik tab beruntun tidak menumpuk request.
    window.whLoadPanel = async function whLoadPanel(paksa) {
        if (whLoading) return;
        if (!el("settingsTabWebhooks")) return;
        whLoading = true;
        try {
            await muatInfo();
            await muatEndpoints();
            await muatDeliveries();
        } finally {
            whLoading = false;
        }
        if (paksa) toast("Data Webhook Relay dimuat ulang");
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", pasangListener);
    } else {
        pasangListener();
    }
})();
