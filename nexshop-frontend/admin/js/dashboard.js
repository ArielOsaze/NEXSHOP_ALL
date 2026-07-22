// ================================
// NexShop Dashboard
// ================================

const token = localStorage.getItem("token");
const API_BASE = "https://nexshop.cloud/api";

if (!token) {
    window.location.href = "login.html";
}

let products = [];
let editingId = null;
let currentImage = "";
let ordersLoaded = false;
let usersLoaded = false;
let promoLoaded = false;
let settingsLoaded = false;
let topupProductsLoaded = false;
let statsLoaded = false;
let topupOrdersLoaded = false;
let promoCodesLoaded = false;
let promoCodes = [];
let editingPromoCodeId = null;

const productModalEl = document.getElementById("productModal");
const productModal = new bootstrap.Modal(productModalEl);
const previewImage = document.getElementById("previewImage");
const imageInput = document.getElementById("image");

const promoModalEl = document.getElementById("promoModal");
const promoModal = new bootstrap.Modal(promoModalEl);
let editingPromoId = null;
let currentPromoImage = "";

const topupProductModalEl = document.getElementById("topupProductModal");
const topupProductModal = new bootstrap.Modal(topupProductModalEl);
let editingTopupProductId = null;
let topupProducts = [];
let topupOrders = [];

const promoCodeModalEl = document.getElementById("promoCodeModal");
const promoCodeModal = new bootstrap.Modal(promoCodeModalEl);

// ================================
// Helpers
// ================================

function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
}

function showToast(message, isError = false) {
    const toastEl = document.getElementById("liveToast");
    document.getElementById("toastMessage").textContent = message;
    toastEl.classList.remove("text-bg-danger", "text-bg-success");
    toastEl.classList.add(isError ? "text-bg-danger" : "text-bg-success");
    new bootstrap.Toast(toastEl).show();
}

// Central fetch wrapper: always attaches the token and handles expired sessions
// in one place, instead of every function repeating Authorization headers.
async function apiFetch(path, options = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: {
            ...(options.headers || {}),
            Authorization: "Bearer " + token
        }
    });

    if (res.status === 401) {
        localStorage.removeItem("token");
        showToast("Sesi kamu berakhir, silakan login kembali.", true);
        setTimeout(() => window.location.href = "login.html", 1200);
        throw new Error("unauthorized");
    }

    return res;
}

// ================================
// View switching (sidebar)
// ================================

document.querySelectorAll("#sidebarNav .nav-link").forEach(link => {
    link.addEventListener("click", (e) => {
        e.preventDefault();
        document.querySelectorAll("#sidebarNav .nav-link").forEach(l => l.classList.remove("active"));
        link.classList.add("active");

        const view = link.dataset.view;
        document.querySelectorAll(".view-section").forEach(sec => sec.classList.add("d-none"));
        document.getElementById(`view-${view}`).classList.remove("d-none");

        if (view === "orders" && !ordersLoaded) loadOrders();
        if (view === "users" && !usersLoaded) loadUsers();
        if (view === "promo" && !promoLoaded) loadPromo();
        if (view === "promocodes" && !promoCodesLoaded) loadPromoCodes();
        if (view === "topup" && !topupProductsLoaded) { loadTopupProducts(); loadTvBalance(); }
        if (view === "settings" && !settingsLoaded) loadSettings();
        if (view === "stats" && !statsLoaded) loadStats();
    });
});

// ================================
// Load Products
// ================================

async function loadProducts() {
    const tbody = document.getElementById("products");
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4"><span class="spinner-border spinner-border-sm me-2"></span>Memuat data...</td></tr>`;

    try {
        const res = await apiFetch("/products");
        if (!res.ok) throw new Error("Gagal mengambil data produk");

        products = await res.json();
        renderProducts(products);
        updateStats(products);

    } catch (err) {
        if (err.message === "unauthorized") return;
        console.error(err);
        tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger py-4">${escapeHtml(err.message)}</td></tr>`;
        showToast(err.message, true);
    }
}

// ================================
// Render Table
// ================================

function renderProducts(data) {
    const tbody = document.getElementById("products");

    if (!data.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">Belum ada produk.</td></tr>`;
        return;
    }

    tbody.innerHTML = data.map((product, idx) => `
        <tr>
            <td>${idx + 1}<div class="text-muted small">#${escapeHtml(product.id)}</div></td>
            <td>
                ${product.image
                    ? `<img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}" style="width:70px;height:70px;object-fit:cover;border-radius:10px;">`
                    : "-"}
            </td>
            <td><strong>${escapeHtml(product.name)}</strong>${product.is_flash_sale ? ' <span class="badge bg-danger">🔥 Flash Sale</span>' : ""}</td>
            <td>Rp ${Number(product.price).toLocaleString("id-ID")}</td>
            <td><span class="badge bg-primary">${escapeHtml(product.badge || "-")}</span></td>
            <td>${escapeHtml(product.category || "-")}</td>
            <td>
                <button class="btn btn-warning btn-sm" onclick="editProduct(${Number(product.id)})">
                    <i class="bi bi-pencil"></i>
                </button>
                <button class="btn btn-danger btn-sm" onclick="deleteProduct(${Number(product.id)})">
                    <i class="bi bi-trash"></i>
                </button>
            </td>
        </tr>
    `).join("");
}

// ================================
// Statistik
// ================================

function updateStats(data) {
    let totalHarga = 0;
    let totalSold = 0;

    data.forEach(item => {
        totalHarga += Number(item.price || 0);
        totalSold += Number(item.sold || 0);
    });

    document.getElementById("totalProduk").innerText = data.length;
    document.getElementById("totalSold").innerText = totalSold;
    document.getElementById("totalHarga").innerText = "Rp " + totalHarga.toLocaleString("id-ID");
}

// ================================
// Search
// ================================

const search = document.getElementById("search");

if (search) {
    search.addEventListener("keyup", () => {
        const keyword = search.value.toLowerCase();
        const filtered = products.filter(product =>
            product.name.toLowerCase().includes(keyword) ||
            (product.category || "").toLowerCase().includes(keyword) ||
            (product.badge || "").toLowerCase().includes(keyword)
        );
        renderProducts(filtered);
    });
}

// ================================
// Image preview
// ================================

if (imageInput) {
    imageInput.addEventListener("change", () => {
        const file = imageInput.files[0];
        if (!file) {
            previewImage.src = "";
            previewImage.classList.add("d-none");
            return;
        }
        previewImage.src = URL.createObjectURL(file);
        previewImage.classList.remove("d-none");
    });
}

// ================================
// Description field: guard against Enter being intercepted
// by any outer key handler, so a normal newline always goes through.
// ================================

const descriptionField = document.getElementById("description");
if (descriptionField) {
    descriptionField.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.stopPropagation();
        }
    });
}

// ================================
// Delete
// ================================

async function deleteProduct(id) {
    if (!confirm("Hapus produk ini?")) return;

    try {
        const res = await apiFetch(`/products/${id}`, { method: "DELETE" });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) throw new Error(data.message || "Gagal menghapus produk");

        showToast(data.message || "Produk berhasil dihapus");
        loadProducts();

    } catch (err) {
        if (err.message === "unauthorized") return;
        console.error(err);
        showToast(err.message, true);
    }
}

// ================================
// Edit
// ================================

function editProduct(id) {
    const product = products.find(p => p.id === id);
    if (!product) return;

    editingId = id;
    currentImage = product.image || "";

    document.getElementById("modalTitle").innerHTML = '<i class="bi bi-box-seam me-2"></i>Edit Produk';

    document.getElementById("name").value = product.name;
    document.getElementById("price").value = product.price;
    document.getElementById("strikePrice").value = product.strike_price || "";
    document.getElementById("isFlashSale").checked = !!product.is_flash_sale;
    document.getElementById("badge").value = product.badge || "";
    document.getElementById("category").value = product.category || "";
    document.getElementById("rating").value = product.rating || "";
    document.getElementById("sold").value = product.sold || "";
    document.getElementById("description").value = product.description || "";

    if (product.image) {
        previewImage.src = product.image;
        previewImage.classList.remove("d-none");
    }

    productModal.show();
}

// Reset the form EVERY time the modal closes — whether by Save, Cancel, the
// X button, or clicking outside. Previously this only happened after a
// successful save, so cancelling an edit and then clicking "Tambah Produk"
// would silently reopen the form still in "edit" mode with the old data.
productModalEl.addEventListener("hidden.bs.modal", () => {
    document.getElementById("productForm").reset();
    previewImage.src = "";
    previewImage.classList.add("d-none");
    editingId = null;
    currentImage = "";
    document.getElementById("modalTitle").innerHTML = '<i class="bi bi-box-seam me-2"></i>Tambah Produk';
});

// ================================
// Save Product
// ================================

async function saveProduct() {
    const form = document.getElementById("productForm");
    if (!form.reportValidity()) return; // now actually enforced, since Save used to bypass native validation

    const price = Number(document.getElementById("price").value);
    if (!price || price <= 0) {
        showToast("Harga harus lebih dari 0", true);
        return;
    }

    const saveBtn = document.getElementById("saveProductBtn");
    const originalHtml = saveBtn.innerHTML;
    saveBtn.disabled = true;
    saveBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Menyimpan...`;

    try {
        const imageFile = imageInput.files[0];
        let imageUrl = currentImage;

        if (imageFile) {
            const formData = new FormData();
            formData.append("image", imageFile);

            // Fixed: this request was previously sent without the auth token,
            // which fails if the backend requires it for uploads.
            const uploadRes = await apiFetch("/upload", { method: "POST", body: formData });
            const uploadData = await uploadRes.json().catch(() => ({}));

            if (!uploadRes.ok) throw new Error(uploadData.message || "Upload gambar gagal");
            imageUrl = uploadData.url;
        }

        const product = {
            name: document.getElementById("name").value.trim(),
            price,
            strike_price: Number(document.getElementById("strikePrice").value || 0) || null,
            is_flash_sale: document.getElementById("isFlashSale").checked,
            badge: document.getElementById("badge").value.trim(),
            category: document.getElementById("category").value.trim(),
            rating: Number(document.getElementById("rating").value || 0),
            sold: Number(document.getElementById("sold").value || 0),
            image: imageUrl,
            description: document.getElementById("description").value
        };

        const url = editingId ? `/products/${editingId}` : "/products";
        const method = editingId ? "PUT" : "POST";

        const res = await apiFetch(url, {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(product)
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Gagal menyimpan produk");

        productModal.hide(); // triggers the hidden.bs.modal reset above
        loadProducts();
        showToast("Produk berhasil disimpan");

    } catch (err) {
        if (err.message === "unauthorized") return;
        console.error(err);
        showToast(err.message, true);
    } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = originalHtml;
    }
}

// ================================
// Orders (waiting on backend endpoint)
// ================================

async function loadOrders() {
    const container = document.getElementById("ordersContainer");
    container.innerHTML = `<div class="text-center text-muted py-5"><span class="spinner-border spinner-border-sm me-2"></span>Memuat...</div>`;

    try {
        const res = await apiFetch("/orders");
        if (!res.ok) throw new Error("not-available");

        const orders = await res.json();
        ordersLoaded = true;

        if (!orders.length) {
            container.innerHTML = `<p class="text-muted text-center py-5 mb-0">Belum ada pesanan.</p>`;
            return;
        }

        container.innerHTML = `
            <div class="table-responsive">
            <table class="table table-hover align-middle mb-0">
                <thead><tr><th>ID</th><th>Pelanggan</th><th>Total</th><th>Status</th><th>Tanggal</th></tr></thead>
                <tbody>
                    ${orders.map(o => `
                        <tr>
                            <td>${escapeHtml(o.id)}</td>
                            <td>${escapeHtml(o.customerName || o.name || "-")}</td>
                            <td>Rp ${Number(o.total || 0).toLocaleString("id-ID")}</td>
                            <td><span class="badge bg-info">${escapeHtml(o.status || "-")}</span></td>
                            <td>${o.date ? new Date(o.date).toLocaleDateString("id-ID") : "-"}</td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
            </div>
        `;
    } catch (err) {
        if (err.message === "unauthorized") return;
        // Expected for now — the backend doesn't have this endpoint yet.
        container.innerHTML = `
            <div class="text-center text-muted py-5">
                <i class="bi bi-cart-x display-4 d-block mb-3"></i>
                Fitur Orders belum terhubung ke backend.<br>
                <small>Endpoint <code>GET /orders</code> belum tersedia di API kamu.</small>
            </div>
        `;
    }
}

// ================================
// Users (waiting on backend endpoint)
// ================================

async function loadUsers() {
    const container = document.getElementById("usersContainer");
    container.innerHTML = `<div class="text-center text-muted py-5"><span class="spinner-border spinner-border-sm me-2"></span>Memuat...</div>`;

    try {
        const res = await apiFetch("/users");
        if (!res.ok) throw new Error("not-available");

        const users = await res.json();
        usersLoaded = true;

        if (!users.length) {
            container.innerHTML = `<p class="text-muted text-center py-5 mb-0">Belum ada pengguna.</p>`;
            return;
        }

        container.innerHTML = `
            <div class="table-responsive">
            <table class="table table-hover align-middle mb-0">
                <thead><tr><th>ID</th><th>Nama</th><th>Email</th><th>Role</th><th>Status</th><th>Aksi</th></tr></thead>
                <tbody>
                    ${users.map(u => `
                        <tr>
                            <td>${escapeHtml(u.id)}</td>
                            <td>${escapeHtml(u.name || "-")}</td>
                            <td>${escapeHtml(u.email || "-")}</td>
                            <td>
                                <select class="form-select form-select-sm" style="width:110px;" onchange="changeUserRole(${Number(u.id)}, this.value)">
                                    <option value="user" ${u.role === "user" ? "selected" : ""}>user</option>
                                    <option value="admin" ${u.role === "admin" ? "selected" : ""}>admin</option>
                                </select>
                            </td>
                            <td>
                                ${u.is_blacklisted
                                    ? `<span class="badge bg-danger">Diblokir</span>`
                                    : `<span class="badge bg-success">Aktif</span>`}
                            </td>
                            <td>
                                <button class="btn btn-sm ${u.is_blacklisted ? "btn-success" : "btn-outline-danger"}"
                                        onclick="toggleUserBlacklist(${Number(u.id)}, ${!u.is_blacklisted})">
                                    <i class="bi ${u.is_blacklisted ? "bi-unlock" : "bi-slash-circle"}"></i>
                                    ${u.is_blacklisted ? "Buka Blokir" : "Blokir"}
                                </button>
                                <button class="btn btn-sm btn-outline-info" onclick="openUserDetail(${Number(u.id)})">
                                    <i class="bi bi-clock-history"></i> Riwayat
                                </button>
                            </td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
            </div>
        `;
    } catch (err) {
        if (err.message === "unauthorized") return;
        container.innerHTML = `
            <div class="text-center text-muted py-5">
                <i class="bi bi-people display-4 d-block mb-3"></i>
                Fitur Users belum terhubung ke backend.<br>
                <small>Endpoint <code>GET /users</code> belum tersedia di API kamu.</small>
            </div>
        `;
    }
}

async function openUserDetail(id) {
    const modalEl = document.getElementById("userDetailModal");
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    const body = document.getElementById("userDetailBody");
    body.innerHTML = `<div class="text-center text-muted py-5"><span class="spinner-border spinner-border-sm me-2"></span>Memuat...</div>`;
    modal.show();

    try {
        const res = await apiFetch(`/users/${id}/detail`);
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.message || "Gagal memuat riwayat pelanggan");
        }
        const { user, stats, history } = await res.json();
        const rupiah = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");
        const statusColors = { paid: "success", sukses: "success", pending: "warning", processing: "info", failed: "danger", gagal: "danger" };

        body.innerHTML = `
            <div class="mb-3">
                <h5 class="mb-0">${escapeHtml(user.name || "-")}</h5>
                <span class="text-muted small">${escapeHtml(user.email || "-")} · Bergabung ${user.created_at ? new Date(user.created_at).toLocaleDateString("id-ID") : "-"}</span>
            </div>

            <div class="row g-2 mb-4">
                <div class="col-4">
                    <div class="border rounded p-2 text-center">
                        <small class="text-muted d-block">Total Belanja</small>
                        <strong>${rupiah(stats.total_spent)}</strong>
                    </div>
                </div>
                <div class="col-4">
                    <div class="border rounded p-2 text-center">
                        <small class="text-muted d-block">Order Sukses / Semua</small>
                        <strong>${stats.total_paid_orders} / ${stats.total_orders}</strong>
                    </div>
                </div>
                <div class="col-4">
                    <div class="border rounded p-2 text-center">
                        <small class="text-muted d-block">Rata-rata / Order</small>
                        <strong>${rupiah(stats.avg_order_value)}</strong>
                    </div>
                </div>
            </div>

            <h6>Riwayat Transaksi</h6>
            <div class="table-responsive" style="max-height:340px;">
                <table class="table table-sm table-hover align-middle mb-0">
                    <thead><tr><th>Tanggal</th><th>Tipe</th><th>Item</th><th>Nominal</th><th>Status</th></tr></thead>
                    <tbody>
                        ${history.length ? history.map(h => `
                            <tr>
                                <td class="text-nowrap">${new Date(h.created_at).toLocaleString("id-ID")}</td>
                                <td>${h.type === "topup" ? `<span class="badge bg-info">Topup</span>` : `<span class="badge bg-primary">Produk</span>`}</td>
                                <td>${escapeHtml(h.title)}</td>
                                <td>${rupiah(h.amount)}</td>
                                <td><span class="badge bg-${statusColors[h.status] || "secondary"}">${escapeHtml(h.status)}</span></td>
                            </tr>
                        `).join("") : `<tr><td colspan="5" class="text-center text-muted py-3">Belum ada transaksi.</td></tr>`}
                    </tbody>
                </table>
            </div>
        `;
    } catch (err) {
        if (err.message === "unauthorized") return;
        body.innerHTML = `<div class="text-center text-danger py-5">${escapeHtml(err.message)}</div>`;
    }
}

async function changeUserRole(id, role) {
    try {
        const res = await apiFetch(`/users/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Gagal mengubah role");

        showToast(`Role berhasil diubah jadi "${role}"`);
    } catch (err) {
        if (err.message === "unauthorized") return;
        console.error(err);
        showToast(err.message, true);
        loadUsers(); // refresh biar dropdown balik ke nilai asli kalau gagal
    }
}

async function toggleUserBlacklist(id, newValue) {
    const confirmMsg = newValue
        ? "Blokir akun ini? User gak akan bisa login sampai dibuka blokirnya lagi."
        : "Buka blokir akun ini?";
    if (!confirm(confirmMsg)) return;

    try {
        const res = await apiFetch(`/users/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ is_blacklisted: newValue })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Gagal mengubah status user");

        showToast(newValue ? "Akun berhasil diblokir" : "Blokir berhasil dibuka");
        loadUsers();
    } catch (err) {
        if (err.message === "unauthorized") return;
        console.error(err);
        showToast(err.message, true);
    }
}

// ================================
// Promo / Iklan / Berita (carousel slides)
// ================================

let promoSlides = [];

async function loadPromo() {
    const tbody = document.getElementById("promoSlides");
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4"><span class="spinner-border spinner-border-sm me-2"></span>Memuat data...</td></tr>`;

    try {
        const res = await apiFetch("/promo/all");
        if (!res.ok) throw new Error("Gagal mengambil data promo");

        promoSlides = await res.json();
        promoLoaded = true;
        renderPromoSlides();

    } catch (err) {
        if (err.message === "unauthorized") return;
        console.error(err);
        tbody.innerHTML = `<tr><td colspan="5" class="text-center text-danger py-4">${escapeHtml(err.message)}</td></tr>`;
    }
}

function renderPromoSlides() {
    const tbody = document.getElementById("promoSlides");

    if (!promoSlides.length) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">Belum ada slide. Klik "Tambah Slide" buat mulai.</td></tr>`;
        return;
    }

    tbody.innerHTML = promoSlides.map(slide => `
        <tr>
            <td>${escapeHtml(slide.sort_order ?? 0)}</td>
            <td>
                ${slide.image_url
                    ? `<img src="${escapeHtml(slide.image_url)}" alt="${escapeHtml(slide.title)}" style="width:70px;height:44px;object-fit:cover;border-radius:8px;">`
                    : "-"}
            </td>
            <td><span class="badge bg-secondary text-capitalize">${escapeHtml(slide.type || "promo")}</span></td>
            <td><strong>${escapeHtml(slide.title)}</strong></td>
            <td>
                ${slide.is_active
                    ? `<span class="badge bg-success">Aktif</span>`
                    : `<span class="badge bg-secondary">Nonaktif</span>`}
            </td>
            <td>
                <button class="btn btn-warning btn-sm" onclick="editPromoSlide(${Number(slide.id)})">
                    <i class="bi bi-pencil"></i>
                </button>
                <button class="btn btn-danger btn-sm" onclick="deletePromoSlide(${Number(slide.id)})">
                    <i class="bi bi-trash"></i>
                </button>
            </td>
        </tr>
    `).join("");
}

const promoImageInput = document.getElementById("promoImageInput");
const promoImagePreview = document.getElementById("promoImagePreview");

if (promoImageInput) {
    promoImageInput.addEventListener("change", () => {
        const file = promoImageInput.files[0];
        if (!file) return;
        promoImagePreview.src = URL.createObjectURL(file);
        promoImagePreview.classList.remove("d-none");
    });
}

function openPromoModal() {
    editingPromoId = null;
    currentPromoImage = "";
    document.getElementById("promoForm").reset();
    promoImagePreview.src = "";
    promoImagePreview.classList.add("d-none");
    document.getElementById("promoIsActive").checked = true;
    document.getElementById("promoModalTitle").innerHTML = '<i class="bi bi-megaphone me-2"></i>Tambah Slide';
    document.getElementById("promoError").textContent = "";
    promoModal.show();
}

function editPromoSlide(id) {
    const slide = promoSlides.find(s => s.id === id);
    if (!slide) return;

    editingPromoId = id;
    currentPromoImage = slide.image_url || "";
    document.getElementById("promoModalTitle").innerHTML = '<i class="bi bi-megaphone me-2"></i>Edit Slide';
    document.getElementById("promoType").value = slide.type || "promo";
    document.getElementById("promoSortOrder").value = slide.sort_order ?? 0;
    document.getElementById("promoBadge").value = slide.badge_text || "";
    document.getElementById("promoTitle").value = slide.title || "";
    document.getElementById("promoDesc").value = slide.description || "";
    document.getElementById("promoCtaText").value = slide.cta_text || "";
    document.getElementById("promoCtaLink").value = slide.cta_link || "";
    if (slide.image_url) {
        promoImagePreview.src = slide.image_url;
        promoImagePreview.classList.remove("d-none");
    } else {
        promoImagePreview.src = "";
        promoImagePreview.classList.add("d-none");
    }
    document.getElementById("promoIsActive").checked = !!slide.is_active;
    document.getElementById("promoError").textContent = "";
    promoModal.show();
}

async function savePromo() {
    const title = document.getElementById("promoTitle").value.trim();
    const errorEl = document.getElementById("promoError");

    if (!title) {
        errorEl.textContent = "Judul wajib diisi";
        return;
    }

    const saveBtn = document.getElementById("savePromoBtn");
    const originalHtml = saveBtn.innerHTML;
    saveBtn.disabled = true;
    saveBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Menyimpan...`;

    // FormData supaya file gambar bisa diupload langsung di request yang sama
    const formData = new FormData();
    formData.append("type", document.getElementById("promoType").value);
    formData.append("sort_order", Number(document.getElementById("promoSortOrder").value || 0));
    formData.append("badge_text", document.getElementById("promoBadge").value.trim());
    formData.append("title", title);
    formData.append("description", document.getElementById("promoDesc").value.trim());
    formData.append("cta_text", document.getElementById("promoCtaText").value.trim());
    formData.append("cta_link", document.getElementById("promoCtaLink").value.trim());
    formData.append("is_active", document.getElementById("promoIsActive").checked);

    const file = promoImageInput.files[0];
    if (file) {
        formData.append("image", file);
    } else if (currentPromoImage) {
        formData.append("image_url", currentPromoImage);
    }

    try {
        const url = editingPromoId ? `/promo/${editingPromoId}` : "/promo";
        const method = editingPromoId ? "PUT" : "POST";

        const res = await apiFetch(url, { method, body: formData });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Gagal menyimpan slide");

        promoModal.hide();
        loadPromo();
        showToast("Slide berhasil disimpan");

    } catch (err) {
        if (err.message === "unauthorized") return;
        console.error(err);
        errorEl.textContent = err.message;
    } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = originalHtml;
    }
}

async function deletePromoSlide(id) {
    if (!confirm("Hapus slide ini?")) return;

    try {
        const res = await apiFetch(`/promo/${id}`, { method: "DELETE" });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) throw new Error(data.message || "Gagal menghapus slide");

        showToast(data.message || "Slide berhasil dihapus");
        loadPromo();

    } catch (err) {
        if (err.message === "unauthorized") return;
        console.error(err);
        showToast(err.message, true);
    }
}

// ================================
// Settings — Profil Admin / Toko / API Keys
// ================================

document.querySelectorAll("#settingsTabs [data-settings-tab]").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll("#settingsTabs .nav-link").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        const tab = btn.dataset.settingsTab;
        document.getElementById("settingsTabProfile").classList.toggle("d-none", tab !== "profile");
        document.getElementById("settingsTabStore").classList.toggle("d-none", tab !== "store");
        document.getElementById("settingsTabContent").classList.toggle("d-none", tab !== "content");
        document.getElementById("settingsTabApiKeys").classList.toggle("d-none", tab !== "apikeys");
    });
});

async function loadSettings() {
    settingsLoaded = true;
    try {
        const [meRes, storeRes, keysRes] = await Promise.all([
            apiFetch("/settings/me"),
            apiFetch("/settings/store"),
            apiFetch("/settings/api-keys")
        ]);

        if (meRes.ok) {
            const me = await meRes.json();
            document.getElementById("profileName").value = me.fullname || "";
            document.getElementById("profileEmail").value = me.email || "";
        }

        if (storeRes.ok) {
            const store = await storeRes.json();
            document.getElementById("storeName").value = store.store_name || "";
            document.getElementById("storeTagline").value = store.tagline || "";
            document.getElementById("storeWhatsapp").value = store.contact_whatsapp || "";
            document.getElementById("storePhone").value = store.contact_phone || "";
            document.getElementById("storeEmail").value = store.contact_email || "";
            document.getElementById("storeAddress").value = store.address || "";
            if (store.logo_url) {
                document.getElementById("storeLogoPreview").src = store.logo_url;
                document.getElementById("storeLogoPreview").classList.remove("d-none");
            }

            renderFaqEditor(Array.isArray(store.faq) ? store.faq : []);
            document.getElementById("termsContentInput").value = store.terms_content || "";
            document.getElementById("refundContentInput").value = store.refund_content || "";
        }

        if (keysRes.ok) {
            const keys = await keysRes.json();
            document.getElementById("ipaymuVa").value = keys.ipaymu_va || "";
            document.getElementById("ipaymuApiKey").value = keys.ipaymu_api_key || "";
            document.getElementById("ipaymuIsProduction").checked = !!keys.ipaymu_is_production;
            document.getElementById("tvMemberCode").value = keys.tokovoucher_member_code || "";
            document.getElementById("tvSecret").value = keys.tokovoucher_secret || "";
            document.getElementById("agMerchantId").value = keys.apigames_merchant_id || "";
            document.getElementById("agSecretKey").value = keys.apigames_secret_key || "";
        }
    } catch (err) {
        if (err.message === "unauthorized") return;
        console.error(err);
        showToast("Gagal memuat pengaturan", true);
    }
}

// ================================
// FAQ Editor (dinamis, disimpan sebagai JSON array di store_settings.faq)
// ================================
let faqRows = [];

function renderFaqEditor(faq) {
    faqRows = faq.map(f => ({ q: f.q || "", a: f.a || "" }));
    if (faqRows.length === 0) faqRows.push({ q: "", a: "" });
    drawFaqRows();
}

function drawFaqRows() {
    const wrap = document.getElementById("faqEditorList");
    wrap.innerHTML = faqRows.map((f, i) => `
        <div class="border rounded p-2 d-flex flex-column gap-2">
            <div class="d-flex gap-2 align-items-start">
                <div class="flex-grow-1">
                    <input class="form-control form-control-sm mb-2" placeholder="Pertanyaan" value="${escapeHtml(f.q)}" oninput="faqRows[${i}].q=this.value">
                    <textarea class="form-control form-control-sm" rows="2" placeholder="Jawaban" oninput="faqRows[${i}].a=this.value">${escapeHtml(f.a)}</textarea>
                </div>
                <button type="button" class="btn btn-outline-danger btn-sm" onclick="removeFaqRow(${i})"><i class="bi bi-trash"></i></button>
            </div>
        </div>
    `).join("");
}

function addFaqRow() {
    faqRows.push({ q: "", a: "" });
    drawFaqRows();
}

function removeFaqRow(i) {
    faqRows.splice(i, 1);
    if (faqRows.length === 0) faqRows.push({ q: "", a: "" });
    drawFaqRows();
}

async function saveContentSettings() {
    const errorEl = document.getElementById("contentError");
    errorEl.textContent = "";

    const faq = faqRows.filter(f => f.q.trim() && f.a.trim()).map(f => ({ q: f.q.trim(), a: f.a.trim() }));

    const payload = {
        faq,
        terms_content: document.getElementById("termsContentInput").value,
        refund_content: document.getElementById("refundContentInput").value
    };

    try {
        const res = await apiFetch("/settings/store", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Gagal menyimpan konten");

        showToast("FAQ / Syarat & Ketentuan / Refund berhasil disimpan");
    } catch (err) {
        if (err.message === "unauthorized") return;
        errorEl.textContent = err.message;
    }
}

async function saveProfile() {
    const errorEl = document.getElementById("profileError");
    errorEl.textContent = "";

    const payload = {
        fullname: document.getElementById("profileName").value.trim(),
        email: document.getElementById("profileEmail").value.trim(),
        current_password: document.getElementById("profileCurrentPassword").value,
        new_password: document.getElementById("profileNewPassword").value
    };

    try {
        const res = await apiFetch("/settings/me", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Gagal menyimpan profil");

        document.getElementById("profileCurrentPassword").value = "";
        document.getElementById("profileNewPassword").value = "";
        showToast("Profil berhasil disimpan");
    } catch (err) {
        if (err.message === "unauthorized") return;
        errorEl.textContent = err.message;
    }
}

const storeLogoInput = document.getElementById("storeLogoInput");
if (storeLogoInput) {
    storeLogoInput.addEventListener("change", () => {
        const file = storeLogoInput.files[0];
        if (!file) return;
        const preview = document.getElementById("storeLogoPreview");
        preview.src = URL.createObjectURL(file);
        preview.classList.remove("d-none");
    });
}

async function saveStoreSettings() {
    const errorEl = document.getElementById("storeError");
    errorEl.textContent = "";

    try {
        let logoUrl;
        const file = storeLogoInput.files[0];
        if (file) {
            const formData = new FormData();
            formData.append("image", file);
            const uploadRes = await apiFetch("/upload?type=logo", { method: "POST", body: formData });
            const uploadData = await uploadRes.json().catch(() => ({}));
            if (!uploadRes.ok) throw new Error(uploadData.message || "Upload logo gagal");
            logoUrl = uploadData.url;
        }

        const payload = {
            store_name: document.getElementById("storeName").value.trim(),
            tagline: document.getElementById("storeTagline").value.trim(),
            contact_whatsapp: document.getElementById("storeWhatsapp").value.trim(),
            contact_phone: document.getElementById("storePhone").value.trim(),
            contact_email: document.getElementById("storeEmail").value.trim(),
            address: document.getElementById("storeAddress").value.trim()
        };
        if (logoUrl) payload.logo_url = logoUrl;

        const res = await apiFetch("/settings/store", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Gagal menyimpan pengaturan toko");

        showToast("Pengaturan toko berhasil disimpan");
    } catch (err) {
        if (err.message === "unauthorized") return;
        errorEl.textContent = err.message;
    }
}

async function saveApiKeys() {
    const errorEl = document.getElementById("apiKeysError");
    errorEl.textContent = "";

    const payload = {
        ipaymu_va: document.getElementById("ipaymuVa").value.trim(),
        ipaymu_api_key: document.getElementById("ipaymuApiKey").value.trim(),
        ipaymu_is_production: document.getElementById("ipaymuIsProduction").checked,
        tokovoucher_member_code: document.getElementById("tvMemberCode").value.trim(),
        tokovoucher_secret: document.getElementById("tvSecret").value.trim(),
        apigames_merchant_id: document.getElementById("agMerchantId").value.trim(),
        apigames_secret_key: document.getElementById("agSecretKey").value.trim()
    };

    try {
        const res = await apiFetch("/settings/api-keys", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Gagal menyimpan API keys");

        showToast("API keys berhasil disimpan");
        loadSettings(); // refresh biar key sensitif balik ke bentuk tersamar
    } catch (err) {
        if (err.message === "unauthorized") return;
        errorEl.textContent = err.message;
    }
}

// ================================
// Topup Diamond (TokoVoucher)
// ================================

document.querySelectorAll("#topupTabs [data-topup-tab]").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll("#topupTabs .nav-link").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        const tab = btn.dataset.topupTab;
        document.getElementById("topupTabProducts").classList.toggle("d-none", tab !== "products");
        document.getElementById("topupTabOrders").classList.toggle("d-none", tab !== "orders");
        if (tab === "orders" && !topupOrdersLoaded) loadTopupOrders();
    });
});

async function loadTvBalance() {
    try {
        const res = await apiFetch("/topup/admin/balance");
        const data = await res.json();
        const badge = document.getElementById("tvBalanceBadge");
        if (res.ok && data.data) {
            badge.textContent = `Saldo TokoVoucher: Rp ${Number(data.data.saldo).toLocaleString("id-ID")}`;
        } else {
            badge.textContent = "Saldo TokoVoucher: belum terhubung";
        }
    } catch (err) {
        document.getElementById("tvBalanceBadge").textContent = "Saldo TokoVoucher: belum terhubung";
    }
}

async function syncTopupProducts() {
    const kode = document.getElementById("tvSyncKode").value.trim();
    if (!kode) {
        showToast("Masukkan kode/prefix produk dulu, mis. ML", true);
        return;
    }
    try {
        const res = await apiFetch(`/topup/admin/sync?kode=${encodeURIComponent(kode)}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Gagal sync produk");

        showToast(data.message || "Produk berhasil disinkronkan");
        loadTopupProducts();
    } catch (err) {
        if (err.message === "unauthorized") return;
        showToast(err.message, true);
    }
}

async function loadTopupProducts() {
    const tbody = document.getElementById("topupProducts");
    tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-4"><span class="spinner-border spinner-border-sm me-2"></span>Memuat data...</td></tr>`;

    try {
        const res = await apiFetch("/topup/admin/products");
        if (!res.ok) throw new Error("Gagal mengambil data produk topup");

        topupProducts = await res.json();
        topupProductsLoaded = true;
        renderTopupKategoriControls();
        renderTopupProducts();
    } catch (err) {
        if (err.message === "unauthorized") return;
        tbody.innerHTML = `<tr><td colspan="8" class="text-center text-danger py-4">${escapeHtml(err.message)}</td></tr>`;
    }
}

// State buat filter kategori & seleksi checkbox produk topup
let topupKategoriFilter = "";
let topupSelectedIds = new Set();

function getFilteredTopupProducts() {
    return topupKategoriFilter
        ? topupProducts.filter(p => (p.kategori || "Lainnya") === topupKategoriFilter)
        : topupProducts;
}

// Kelompokkan per kategori, produk AKTIF ditaruh paling atas di tiap kategori
// (biar admin gampang lihat mana yang lagi tayang di toko), lalu urut harga.
function groupTopupProductsByKategori(list) {
    const map = new Map();
    list.forEach(p => {
        const key = p.kategori || "Lainnya";
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(p);
    });
    [...map.values()].forEach(arr => {
        arr.sort((a, b) => {
            if (!!a.is_active !== !!b.is_active) return a.is_active ? -1 : 1;
            return Number(a.harga_jual) - Number(b.harga_jual);
        });
    });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function renderTopupKategoriControls() {
    const kategoris = [...new Set(topupProducts.map(p => p.kategori || "Lainnya"))].sort();

    const filterEl = document.getElementById("topupKategoriFilter");
    const current = filterEl.value;
    filterEl.innerHTML = `<option value="">Semua Kategori</option>` +
        kategoris.map(k => `<option value="${escapeHtml(k)}">${escapeHtml(k)}</option>`).join("");
    filterEl.value = kategoris.includes(current) ? current : "";
    topupKategoriFilter = filterEl.value;

    const menu = document.getElementById("deleteByKategoriMenu");
    menu.innerHTML = kategoris.length
        ? kategoris.map(k => `
            <li><button class="dropdown-item text-danger" onclick="deleteTopupKategori('${k.replace(/'/g, "\\'")}')">
                <i class="bi bi-trash3 me-1"></i>${escapeHtml(k)}
            </button></li>
        `).join("") + `<li><hr class="dropdown-divider"></li><li><button class="dropdown-item text-danger fw-semibold" onclick="deleteAllTopupProductsConfirmed()"><i class="bi bi-exclamation-triangle me-1"></i>Hapus SEMUA kategori</button></li>`
        : `<li class="text-muted small px-2">Belum ada kategori</li>`;
}

document.getElementById("topupKategoriFilter").addEventListener("change", (e) => {
    topupKategoriFilter = e.target.value;
    renderTopupProducts();
});

function renderTopupProducts() {
    const tbody = document.getElementById("topupProducts");
    const list = getFilteredTopupProducts();

    // buang seleksi yang produknya udah gak kelihatan lagi (filter/refresh)
    const visibleIds = new Set(list.map(p => p.id));
    topupSelectedIds.forEach(id => { if (!visibleIds.has(id)) topupSelectedIds.delete(id); });

    if (!list.length) {
        tbody.innerHTML = `<tr><td colspan="10" class="text-center text-muted py-4">${topupProducts.length ? "Gak ada produk di kategori ini." : "Belum ada produk. Sync dulu dari TokoVoucher di atas."}</td></tr>`;
        updateTopupSelectedCount();
        return;
    }

    const groups = groupTopupProductsByKategori(list);
    tbody.innerHTML = groups.map(([kategori, products]) => `
        <tr class="table-secondary">
            <td colspan="10" class="fw-semibold">
                <i class="bi bi-controller me-1"></i>${escapeHtml(kategori)}
                <span class="text-muted fw-normal small ms-1">(${products.length} produk)</span>
            </td>
        </tr>
        ${products.map(p => `
        <tr>
            <td><input type="checkbox" class="form-check-input topup-row-check" data-id="${Number(p.id)}" ${topupSelectedIds.has(p.id) ? "checked" : ""}></td>
            <td>${p.item_icon ? `<img src="${p.item_icon}" alt="" style="width:32px;height:32px;object-fit:contain;">` : `<span class="text-muted">◆</span>`}</td>
            <td><code>${escapeHtml(p.kode_produk)}</code></td>
            <td>${escapeHtml(p.nama)}</td>
            <td>${escapeHtml(p.kategori || "-")}</td>
            <td>Rp ${Number(p.harga_beli).toLocaleString("id-ID")}</td>
            <td>Rp ${Number(p.harga_jual).toLocaleString("id-ID")}</td>
            <td>${p.butuh_server_id ? `<span class="badge bg-info">Ya</span>` : "-"}</td>
            <td>${p.is_active ? `<span class="badge bg-success">Aktif</span>` : `<span class="badge bg-secondary">Nonaktif</span>`}</td>
            <td>
                <button class="btn btn-warning btn-sm" onclick="editTopupProduct(${Number(p.id)})"><i class="bi bi-pencil"></i></button>
                <button class="btn btn-danger btn-sm" onclick="deleteTopupProduct(${Number(p.id)})"><i class="bi bi-trash"></i></button>
            </td>
        </tr>
        `).join("")}
    `).join("");

    tbody.querySelectorAll(".topup-row-check").forEach(cb => {
        cb.addEventListener("change", () => {
            const id = Number(cb.dataset.id);
            if (cb.checked) topupSelectedIds.add(id); else topupSelectedIds.delete(id);
            updateTopupSelectedCount();
        });
    });

    updateTopupSelectedCount();
}

function updateTopupSelectedCount() {
    document.getElementById("topupSelectedCount").textContent = `${topupSelectedIds.size} dipilih`;
    const list = getFilteredTopupProducts();
    document.getElementById("topupSelectAll").checked = list.length > 0 && topupSelectedIds.size === list.length;
}

document.getElementById("topupSelectAll").addEventListener("change", (e) => {
    const list = getFilteredTopupProducts();
    if (e.target.checked) list.forEach(p => topupSelectedIds.add(p.id));
    else topupSelectedIds.clear();
    renderTopupProducts();
});

async function bulkSetTopupStatus(isActive) {
    if (topupSelectedIds.size === 0) return showToast("Pilih minimal 1 produk dulu", true);
    if (!confirm(`${isActive ? "Aktifkan" : "Nonaktifkan"} ${topupSelectedIds.size} produk terpilih?`)) return;

    try {
        const res = await apiFetch("/topup/admin/products/bulk-status", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: [...topupSelectedIds], is_active: isActive })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Gagal update status produk");

        showToast(data.message || "Status produk berhasil diubah");
        topupSelectedIds.clear();
        loadTopupProducts();
    } catch (err) {
        if (err.message === "unauthorized") return;
        showToast(err.message, true);
    }
}

async function bulkDeleteTopupSelected() {
    if (topupSelectedIds.size === 0) return showToast("Pilih minimal 1 produk dulu", true);
    if (!confirm(`Yakin hapus ${topupSelectedIds.size} produk terpilih? Tindakan ini tidak bisa dibatalkan.`)) return;

    try {
        const res = await apiFetch("/topup/admin/products/bulk", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: [...topupSelectedIds] })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Gagal menghapus produk terpilih");

        showToast(data.message || "Produk terpilih berhasil dihapus");
        topupSelectedIds.clear();
        loadTopupProducts();
    } catch (err) {
        if (err.message === "unauthorized") return;
        showToast(err.message, true);
    }
}

async function deleteTopupKategori(kategori) {
    if (!confirm(`Yakin hapus SEMUA produk kategori "${kategori}"? Tindakan ini tidak bisa dibatalkan.`)) return;
    try {
        const res = await apiFetch(`/topup/admin/products?kategori=${encodeURIComponent(kategori)}`, { method: "DELETE" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Gagal menghapus kategori");

        showToast(data.message || `Kategori "${kategori}" berhasil dihapus`);
        loadTopupProducts();
    } catch (err) {
        if (err.message === "unauthorized") return;
        showToast(err.message, true);
    }
}

async function deleteAllTopupProductsConfirmed() {
    if (!confirm("Yakin hapus SEMUA produk topup (semua game/kategori)? Tindakan ini tidak bisa dibatalkan.")) return;
    if (!confirm("Sekali lagi — ini akan menghapus SELURUH produk topup tanpa terkecuali. Lanjutkan?")) return;

    try {
        const res = await apiFetch("/topup/admin/products", { method: "DELETE" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Gagal menghapus semua produk");

        showToast(data.message || "Semua produk topup berhasil dihapus");
        loadTopupProducts();
    } catch (err) {
        if (err.message === "unauthorized") return;
        showToast(err.message, true);
    }
}

function editTopupProduct(id) {
    const p = topupProducts.find(x => x.id === id);
    if (!p) return;
    editingTopupProductId = id;

    document.getElementById("tpEditNama").value = p.nama || "";
    document.getElementById("tpEditKategori").value = p.kategori || "";
    document.getElementById("tpEditHargaBeli").value = "Rp " + Number(p.harga_beli).toLocaleString("id-ID");
    document.getElementById("tpEditHargaJual").value = p.harga_jual;
    document.getElementById("tpEditButuhServerId").checked = !!p.butuh_server_id;
    document.getElementById("tpEditIsActive").checked = !!p.is_active;

    const iconInput = document.getElementById("tpEditIconInput");
    if (iconInput) iconInput.value = "";
    const iconPreview = document.getElementById("tpEditIconPreview");
    if (iconPreview) {
        if (p.item_icon) {
            iconPreview.src = p.item_icon;
            iconPreview.classList.remove("d-none");
        } else {
            iconPreview.classList.add("d-none");
        }
    }

    topupProductModal.show();
}

const tpEditIconInput = document.getElementById("tpEditIconInput");
if (tpEditIconInput) {
    tpEditIconInput.addEventListener("change", () => {
        const file = tpEditIconInput.files[0];
        if (!file) return;
        const preview = document.getElementById("tpEditIconPreview");
        preview.src = URL.createObjectURL(file);
        preview.classList.remove("d-none");
    });
}

async function saveTopupProduct() {
    if (!editingTopupProductId) return;

    const payload = {
        nama: document.getElementById("tpEditNama").value.trim(),
        kategori: document.getElementById("tpEditKategori").value.trim(),
        harga_jual: Number(document.getElementById("tpEditHargaJual").value || 0),
        butuh_server_id: document.getElementById("tpEditButuhServerId").checked,
        is_active: document.getElementById("tpEditIsActive").checked
    };

    try {
        const iconFile = document.getElementById("tpEditIconInput")?.files[0];
        if (iconFile) {
            const formData = new FormData();
            formData.append("image", iconFile);
            const uploadRes = await apiFetch("/upload?type=logo", { method: "POST", body: formData });
            const uploadData = await uploadRes.json().catch(() => ({}));
            if (!uploadRes.ok) throw new Error(uploadData.message || "Upload icon gagal");
            payload.item_icon = uploadData.url;
        }

        const res = await apiFetch(`/topup/admin/products/${editingTopupProductId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Gagal menyimpan produk");

        topupProductModal.hide();
        loadTopupProducts();
        showToast("Produk topup berhasil disimpan");
    } catch (err) {
        if (err.message === "unauthorized") return;
        showToast(err.message, true);
    }
}

async function saveCategoryLogo() {
    const kategori = document.getElementById("catLogoKategori").value.trim();
    const file = document.getElementById("catLogoFile").files[0];

    if (!kategori) return showToast("Isi nama kategori/game dulu", true);
    if (!file) return showToast("Pilih file logo dulu", true);

    try {
        const formData = new FormData();
        formData.append("image", file);
        const uploadRes = await apiFetch("/upload?type=logo", { method: "POST", body: formData });
        const uploadData = await uploadRes.json().catch(() => ({}));
        if (!uploadRes.ok) throw new Error(uploadData.message || "Upload logo gagal");

        const res = await apiFetch("/topup/admin/category-logo", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kategori, operator_logo: uploadData.url })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Gagal menyimpan logo game");

        showToast(data.message || "Logo game berhasil disimpan");
        document.getElementById("catLogoKategori").value = "";
        document.getElementById("catLogoFile").value = "";
        loadTopupProducts();
    } catch (err) {
        if (err.message === "unauthorized") return;
        showToast(err.message, true);
    }
}

async function deleteTopupProduct(id) {
    if (!confirm("Hapus produk topup ini?")) return;
    try {
        const res = await apiFetch(`/topup/admin/products/${id}`, { method: "DELETE" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Gagal menghapus produk");

        showToast(data.message || "Produk berhasil dihapus");
        loadTopupProducts();
    } catch (err) {
        if (err.message === "unauthorized") return;
        showToast(err.message, true);
    }
}

async function loadTopupOrders() {
    const tbody = document.getElementById("topupOrders");
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4"><span class="spinner-border spinner-border-sm me-2"></span>Memuat data...</td></tr>`;

    try {
        const res = await apiFetch("/topup/admin/orders");
        if (!res.ok) throw new Error("Gagal mengambil data pesanan topup");

        topupOrders = await res.json();
        topupOrdersLoaded = true;
        renderTopupOrders();
    } catch (err) {
        if (err.message === "unauthorized") return;
        tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger py-4">${escapeHtml(err.message)}</td></tr>`;
    }
}

function statusBadge(status) {
    const map = {
        pending: "bg-secondary", paid: "bg-info", processing: "bg-warning",
        sukses: "bg-success", gagal: "bg-danger", failed: "bg-danger"
    };
    return `<span class="badge ${map[status] || "bg-secondary"}">${escapeHtml(status || "-")}</span>`;
}

function renderTopupOrders() {
    const tbody = document.getElementById("topupOrders");
    if (!topupOrders.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">Belum ada pesanan topup.</td></tr>`;
        return;
    }

    tbody.innerHTML = topupOrders.map(o => `
        <tr>
            <td><code>${escapeHtml(o.id)}</code></td>
            <td>${escapeHtml(o.nama_produk || o.kode_produk)}</td>
            <td>${escapeHtml(o.tujuan)}${o.server_id ? " | " + escapeHtml(o.server_id) : ""}</td>
            <td>Rp ${Number(o.harga).toLocaleString("id-ID")}</td>
            <td>${statusBadge(o.status)}</td>
            <td>${o.created_at ? new Date(o.created_at).toLocaleString("id-ID") : "-"}</td>
            <td>
                <button class="btn btn-outline-secondary btn-sm" onclick="recheckTopupStatus('${o.id}')" title="Cek ulang status ke TokoVoucher">
                    <i class="bi bi-arrow-repeat"></i>
                </button>
            </td>
        </tr>
    `).join("");
}

async function recheckTopupStatus(id) {
    try {
        const res = await apiFetch(`/topup/status/${id}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Gagal cek status");

        showToast(`Status terbaru: ${data.status || "-"}`);
        loadTopupOrders();
    } catch (err) {
        if (err.message === "unauthorized") return;
        showToast(err.message, true);
    }
}

// ================================
// Kode Promo (Redeem Code)
// ================================

function openPromoCodeModal() {
    editingPromoCodeId = null;
    document.getElementById("promoCodeForm").reset();
    document.getElementById("pcIsActive").checked = true;
    document.getElementById("pcCode").disabled = false;
    document.getElementById("promoCodeModalTitle").innerHTML = '<i class="bi bi-ticket-perforated me-2"></i>Buat Kode Promo';
    document.getElementById("promoCodeError").textContent = "";
    promoCodeModal.show();
}

function editPromoCode(id) {
    const pc = promoCodes.find(p => p.id === id);
    if (!pc) return;

    editingPromoCodeId = id;
    document.getElementById("promoCodeModalTitle").innerHTML = '<i class="bi bi-ticket-perforated me-2"></i>Edit Kode Promo';
    document.getElementById("pcCode").value = pc.code;
    document.getElementById("pcCode").disabled = true; // kode gak bisa diubah setelah dibuat, biar gak bingung sama order lama
    document.getElementById("pcDescription").value = pc.description || "";
    document.getElementById("pcDiscountType").value = pc.discount_type;
    document.getElementById("pcDiscountValue").value = pc.discount_value;
    document.getElementById("pcMaxDiscount").value = pc.max_discount || "";
    document.getElementById("pcMinPurchase").value = pc.min_purchase || "";
    document.getElementById("pcMaxUses").value = pc.max_uses || "";
    document.getElementById("pcExpiresAt").value = pc.expires_at ? pc.expires_at.slice(0, 10) : "";
    document.getElementById("pcIsActive").checked = !!pc.is_active;
    document.getElementById("promoCodeError").textContent = "";
    promoCodeModal.show();
}

async function savePromoCode() {
    const errorEl = document.getElementById("promoCodeError");
    errorEl.textContent = "";

    const code = document.getElementById("pcCode").value.trim().toUpperCase();
    const discount_value = Number(document.getElementById("pcDiscountValue").value || 0);

    if (!editingPromoCodeId && !code) {
        errorEl.textContent = "Kode wajib diisi";
        return;
    }
    if (!discount_value || discount_value <= 0) {
        errorEl.textContent = "Nilai diskon harus lebih dari 0";
        return;
    }

    const payload = {
        code,
        description: document.getElementById("pcDescription").value.trim(),
        discount_type: document.getElementById("pcDiscountType").value,
        discount_value,
        max_discount: document.getElementById("pcMaxDiscount").value || null,
        min_purchase: document.getElementById("pcMinPurchase").value || 0,
        max_uses: document.getElementById("pcMaxUses").value || null,
        is_active: document.getElementById("pcIsActive").checked,
        expires_at: document.getElementById("pcExpiresAt").value || null
    };

    try {
        const url = editingPromoCodeId ? `/promo-codes/${editingPromoCodeId}` : "/promo-codes";
        const method = editingPromoCodeId ? "PUT" : "POST";

        const res = await apiFetch(url, {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Gagal menyimpan kode promo");

        promoCodeModal.hide();
        loadPromoCodes();
        showToast("Kode promo berhasil disimpan");
    } catch (err) {
        if (err.message === "unauthorized") return;
        errorEl.textContent = err.message;
    }
}

async function deletePromoCode(id) {
    if (!confirm("Hapus kode promo ini?")) return;
    try {
        const res = await apiFetch(`/promo-codes/${id}`, { method: "DELETE" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Gagal menghapus kode promo");

        showToast(data.message || "Kode promo berhasil dihapus");
        loadPromoCodes();
    } catch (err) {
        if (err.message === "unauthorized") return;
        showToast(err.message, true);
    }
}

async function togglePromoCodeActive(id, isActive) {
    try {
        const res = await apiFetch(`/promo-codes/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ is_active: isActive })
        });
        if (!res.ok) throw new Error("Gagal mengubah status");
        loadPromoCodes();
    } catch (err) {
        if (err.message === "unauthorized") return;
        showToast(err.message, true);
    }
}

async function loadPromoCodes() {
    const tbody = document.getElementById("promoCodes");
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4"><span class="spinner-border spinner-border-sm me-2"></span>Memuat data...</td></tr>`;

    try {
        const res = await apiFetch("/promo-codes");
        if (!res.ok) throw new Error("Gagal mengambil data kode promo");

        promoCodes = await res.json();
        promoCodesLoaded = true;
        renderPromoCodes();
    } catch (err) {
        if (err.message === "unauthorized") return;
        tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger py-4">${escapeHtml(err.message)}</td></tr>`;
    }
}

function renderPromoCodes() {
    const tbody = document.getElementById("promoCodes");
    if (!promoCodes.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">Belum ada kode promo. Klik "Buat Kode Promo" buat mulai.</td></tr>`;
        return;
    }

    tbody.innerHTML = promoCodes.map(pc => {
        const discountLabel = pc.discount_type === "percent"
            ? `${pc.discount_value}%${pc.max_discount ? ` (maks Rp ${Number(pc.max_discount).toLocaleString("id-ID")})` : ""}`
            : `Rp ${Number(pc.discount_value).toLocaleString("id-ID")}`;
        const usageLabel = `${pc.used_count || 0}${pc.max_uses ? ` / ${pc.max_uses}` : ""}`;
        const expiresLabel = pc.expires_at ? new Date(pc.expires_at).toLocaleDateString("id-ID") : "Tanpa batas";
        const expired = pc.expires_at && new Date(pc.expires_at) < new Date();

        return `
        <tr>
            <td><code>${escapeHtml(pc.code)}</code>${pc.description ? `<div class="text-muted small">${escapeHtml(pc.description)}</div>` : ""}</td>
            <td>${discountLabel}</td>
            <td>Rp ${Number(pc.min_purchase || 0).toLocaleString("id-ID")}</td>
            <td>${usageLabel}</td>
            <td>${expired ? `<span class="text-danger">${expiresLabel}</span>` : expiresLabel}</td>
            <td>
                <div class="form-check form-switch mb-0">
                    <input class="form-check-input" type="checkbox" ${pc.is_active ? "checked" : ""}
                        onchange="togglePromoCodeActive(${Number(pc.id)}, this.checked)">
                </div>
            </td>
            <td>
                <button class="btn btn-warning btn-sm" onclick="editPromoCode(${Number(pc.id)})"><i class="bi bi-pencil"></i></button>
                <button class="btn btn-danger btn-sm" onclick="deletePromoCode(${Number(pc.id)})"><i class="bi bi-trash"></i></button>
            </td>
        </tr>`;
    }).join("");
}

// ================================
// Logout
// ================================

function logout() {
    localStorage.removeItem("token");
    window.location.href = "login.html";
}

// ================================
// Notifikasi (bell + activity feed)
// ================================

function timeAgo(dateStr) {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return "baru saja";
    if (mins < 60) return `${mins} menit lalu`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} jam lalu`;
    return `${Math.floor(hours / 24)} hari lalu`;
}

let latestNotifications = [];

async function loadNotifications() {
    try {
        const res = await apiFetch("/notifications");
        if (!res.ok) return;
        const data = await res.json();
        latestNotifications = data.notifications || [];
        renderNotifBell(data.unreadCount || 0);
        renderNotifDropdown();
        renderActivityFeed();
    } catch (err) {
        // diem aja, jangan ganggu UI kalau polling gagal sesekali
    }
}

function renderNotifBell(unreadCount) {
    const countEl = document.getElementById("notifCount");
    if (unreadCount > 0) {
        countEl.textContent = unreadCount > 9 ? "9+" : unreadCount;
        countEl.classList.remove("d-none");
    } else {
        countEl.classList.add("d-none");
    }
}

function renderNotifDropdown() {
    const list = document.getElementById("notifList");
    if (!latestNotifications.length) {
        list.innerHTML = `<div class="text-muted text-center py-4 small">Belum ada notifikasi.</div>`;
        return;
    }
    list.innerHTML = latestNotifications.map(n => `
        <div class="notif-item ${n.is_read ? "" : "unread"}">
            <span class="dot ${n.type}"></span>
            <div>
                <div class="msg">${escapeHtml(n.message)}</div>
                <div class="time">${timeAgo(n.created_at)}</div>
            </div>
        </div>
    `).join("");
}

function renderActivityFeed() {
    const feed = document.getElementById("activityFeed");
    if (!feed) return;
    if (!latestNotifications.length) {
        feed.innerHTML = `<div class="text-muted text-center py-3 small">Belum ada aktivitas.</div>`;
        return;
    }
    feed.innerHTML = latestNotifications.slice(0, 8).map(n => `
        <div class="activity-feed-item">
            <span class="dot ${n.type}" style="margin-top:6px;width:8px;height:8px;border-radius:50%;flex-shrink:0;background:${
                n.type === "order" ? "#22C55E" : n.type === "topup" ? "#22D3EE" : n.type === "security" ? "#F0475C" : "#8B5CF6"
            }"></span>
            <div>
                <div style="font-size:13px;">${escapeHtml(n.message)}</div>
                <div class="text-muted" style="font-size:11px;">${timeAgo(n.created_at)}</div>
            </div>
        </div>
    `).join("");
}

const notifBell = document.getElementById("notifBell");
const notifDropdown = document.getElementById("notifDropdown");
if (notifBell) {
    notifBell.addEventListener("click", () => {
        notifDropdown.classList.toggle("d-none");
    });
    document.addEventListener("click", (e) => {
        if (!notifBell.contains(e.target) && !notifDropdown.contains(e.target)) {
            notifDropdown.classList.add("d-none");
        }
    });
}

const markAllReadBtn = document.getElementById("markAllReadBtn");
if (markAllReadBtn) {
    markAllReadBtn.addEventListener("click", async () => {
        try {
            await apiFetch("/notifications/mark-read", { method: "PUT" });
            loadNotifications();
        } catch (err) {
            if (err.message === "unauthorized") return;
        }
    });
}

loadNotifications();
setInterval(loadNotifications, 30000); // polling tiap 30 detik

// ================================
// Auto-logout kalau admin idle terlalu lama (keamanan — biar sesi gak
// nyantol lama-lama dan disalahgunakan orang lain yang pakai komputer ini)
// ================================
const IDLE_LIMIT_MS = 15 * 60 * 1000; // 15 menit
let idleTimer = null;

function resetIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
        localStorage.removeItem("token");
        localStorage.setItem("nexshop_admin_logout_reason", "idle");
        window.location.href = "login.html";
    }, IDLE_LIMIT_MS);
}

["mousemove", "mousedown", "keydown", "scroll", "touchstart", "click"].forEach(evt => {
    document.addEventListener(evt, resetIdleTimer, { passive: true });
});
resetIdleTimer();

// ================================
loadProducts();

// ================================
// Statistik Penjualan
// ================================
let statRevenueChartInstance = null;

async function loadStats() {
    document.getElementById("statTopProducts").innerHTML = `<tr><td colspan="3" class="text-center text-muted py-3"><span class="spinner-border spinner-border-sm"></span></td></tr>`;
    document.getElementById("statTopTopupCategories").innerHTML = `<tr><td colspan="3" class="text-center text-muted py-3"><span class="spinner-border spinner-border-sm"></span></td></tr>`;

    try {
        const res = await apiFetch("/admin/stats/overview");
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.message || "Gagal memuat statistik");
        }
        const stats = await res.json();
        statsLoaded = true;
        renderStats(stats);
    } catch (err) {
        if (err.message === "unauthorized") return;
        showToast(err.message, true);
    }
}

function renderStats(stats) {
    const rupiah = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");

    document.getElementById("statTotalRevenue").textContent = rupiah(stats.total_revenue);
    document.getElementById("statRevenueRegular").textContent = rupiah(stats.revenue_regular);
    document.getElementById("statRevenueTopup").textContent = rupiah(stats.revenue_topup);
    document.getElementById("statOrderCount").textContent = `${stats.total_paid_orders} / ${stats.total_orders}`;

    // top produk biasa
    const topProductsEl = document.getElementById("statTopProducts");
    topProductsEl.innerHTML = stats.top_products.length
        ? stats.top_products.map(p => `
            <tr><td>${escapeHtml(p.name)}</td><td>${p.qty}</td><td>${rupiah(p.revenue)}</td></tr>
        `).join("")
        : `<tr><td colspan="3" class="text-center text-muted py-3">Belum ada penjualan produk biasa.</td></tr>`;

    // top kategori topup
    const topKategoriEl = document.getElementById("statTopTopupCategories");
    topKategoriEl.innerHTML = stats.top_topup_categories.length
        ? stats.top_topup_categories.map(k => `
            <tr><td>${escapeHtml(k.kategori)}</td><td>${k.count}</td><td>${rupiah(k.revenue)}</td></tr>
        `).join("")
        : `<tr><td colspan="3" class="text-center text-muted py-3">Belum ada penjualan topup.</td></tr>`;

    // status breakdown badges
    const statusColors = { paid: "success", sukses: "success", pending: "warning", processing: "info", failed: "danger", gagal: "danger" };
    const statusEl = document.getElementById("statStatusBreakdown");
    const entries = Object.entries(stats.status_breakdown || {});
    statusEl.innerHTML = entries.length
        ? entries.map(([status, count]) => `
            <span class="badge bg-${statusColors[status] || "secondary"} fs-6 fw-normal px-3 py-2">${escapeHtml(status)}: ${count}</span>
        `).join("")
        : `<span class="text-muted small">Belum ada data order.</span>`;

    // chart tren omzet 30 hari
    const ctx = document.getElementById("statRevenueChart");
    const labels = stats.revenue_by_day.map(d => d.date.slice(5)); // MM-DD
    const data = stats.revenue_by_day.map(d => d.revenue);

    if (statRevenueChartInstance) statRevenueChartInstance.destroy();
    statRevenueChartInstance = new Chart(ctx, {
        type: "line",
        data: {
            labels,
            datasets: [{
                label: "Omzet",
                data,
                borderColor: "#22d3ee",
                backgroundColor: "rgba(34,211,238,.15)",
                fill: true,
                tension: 0.3,
                pointRadius: 0
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
                y: { ticks: { callback: (v) => "Rp " + Number(v).toLocaleString("id-ID") } }
            }
        }
    });
}
