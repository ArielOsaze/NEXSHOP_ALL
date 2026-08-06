// ================================
// NexShop Dashboard
// ================================

const ADMIN_TOKEN_STORAGE_KEY = "nexshop-admin-token";
const token = localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY);
let adminPinResolver = null;
const API_BASE = (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
    ? (window.location.port === "3000" ? "/api" : "http://localhost:3000/api")
    : (window.location.protocol.startsWith("http") ? "/api" : "https://nexshop.cloud/api");

if (!token) {
    window.location.href = "login.html";
}

let products = [];
let editingId = null;
let currentImage = "";
let ordersLoaded = false;
let ordersData = [];
let orderSearchQuery = "";
let orderStatusFilterValue = "";
let usersLoaded = false;
let promoLoaded = false;
let settingsLoaded = false;
let topupProductsLoaded = false;
let statsLoaded = false;
let topupOrdersLoaded = false;
let promoCodesLoaded = false;
let newsLoaded = false;
let newsEntries = [];
let editingNewsId = null;
let newsPreviewData = null;
let selectedNewsIds = new Set();
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
let currentPromoMobileImage = "";

const topupProductModalEl = document.getElementById("topupProductModal");
const topupProductModal = new bootstrap.Modal(topupProductModalEl);
let editingTopupProductId = null;
let topupProducts = [];
let topupOrders = [];
let productSearchQuery = "";
let productCategoryFilterValue = "";
let productFlashFilterValue = "";

const promoCodeModalEl = document.getElementById("promoCodeModal");
const promoCodeModal = new bootstrap.Modal(promoCodeModalEl);
const newsModal = new bootstrap.Modal(document.getElementById("newsModal"));

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

    if (res.status === 401 && res.headers.get("X-Admin-Pin-Error") !== "1") {
        localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
        showToast("Sesi kamu berakhir, silakan login kembali.", true);
        setTimeout(() => window.location.href = "login.html", 1200);
        throw new Error("unauthorized");
    }

    return res;
}

function adminPinModalInstance() {
    return bootstrap.Modal.getOrCreateInstance(document.getElementById("adminPinModal"), { backdrop: "static", keyboard: false });
}

async function getAdminPinStatus() {
    const res = await apiFetch("/settings/security-pin");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || "Gagal memeriksa Security PIN Admin");
    return data;
}

function requestAdminPin(setup, purpose = "melanjutkan tindakan sensitif ini") {
    document.getElementById("adminPinModalTitle").textContent = setup ? "Buat Security PIN Admin" : "Security PIN Admin";
    document.getElementById("adminPinHelp").textContent = setup
        ? "Buat PIN 6 digit terpisah dari password login. PIN ini wajib untuk membuka atau mengubah konfigurasi sensitif."
        : `Masukkan Security PIN 6 digit untuk ${purpose}. PIN hanya berlaku untuk tindakan ini.`;
    document.getElementById("adminPinConfirmation").classList.toggle("d-none", !setup);
    document.getElementById("adminPinSubmit").textContent = setup ? "Simpan Security PIN" : "Verifikasi PIN";
    document.getElementById("adminPinInput").value = "";
    document.getElementById("adminPinConfirmation").value = "";
    document.getElementById("adminPinError").textContent = "";
    document.getElementById("adminPinModal").dataset.mode = setup ? "setup" : "verify";
    adminPinModalInstance().show();
    setTimeout(() => document.getElementById("adminPinInput").focus(), 150);
    return new Promise((resolve, reject) => { adminPinResolver = { resolve, reject }; });
}

async function withAdminPin(action, purpose) {
    const status = await getAdminPinStatus();
    if (!status.configured) {
        await requestAdminPin(true, purpose);
        // Pembuatan PIN tidak membuat sesi tepercaya; minta PIN lagi untuk aksi ini.
    }
    const pin = await requestAdminPin(false, purpose);
    return action(pin);
}

async function submitAdminPin() {
    const pin = document.getElementById("adminPinInput").value.trim();
    const confirmation = document.getElementById("adminPinConfirmation").value.trim();
    const errorEl = document.getElementById("adminPinError");
    const button = document.getElementById("adminPinSubmit");
    const setup = document.getElementById("adminPinModal").dataset.mode === "setup";
    errorEl.textContent = "";
    if (!/^\d{6}$/.test(pin) || (setup && pin !== confirmation)) {
        errorEl.textContent = setup ? "PIN harus 6 digit dan kedua input harus sama." : "Masukkan PIN 6 digit yang valid.";
        return;
    }
    button.disabled = true;
    try {
        const res = await apiFetch(`/settings/security-pin/${setup ? "setup" : "verify"}`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(setup ? { pin, confirmation } : { pin })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Security PIN tidak dapat diverifikasi");
        const resolver = adminPinResolver;
        adminPinResolver = null;
        adminPinModalInstance().hide();
        if (resolver) resolver.resolve(pin);
        showToast(data.message || "Security PIN terverifikasi");
    } catch (err) {
        errorEl.textContent = err.message;
    } finally {
        button.disabled = false;
    }
}

document.getElementById("adminPinModal").addEventListener("hidden.bs.modal", () => {
    document.getElementById("adminPinInput").value = "";
    document.getElementById("adminPinConfirmation").value = "";
    if (adminPinResolver) {
        adminPinResolver.reject(new Error("Verifikasi Security PIN dibatalkan"));
        adminPinResolver = null;
    }
    hideRevealedSecrets();
});

let changePinStage = "current";
let changePinResendTimerId = null;

function changePinModalInstance() {
    return bootstrap.Modal.getOrCreateInstance(document.getElementById("changeAdminPinModal"), { backdrop: "static", keyboard: false });
}

function setChangePinStage(stage) {
    changePinStage = stage;
    document.getElementById("changePinStepCurrent").classList.toggle("d-none", stage !== "current");
    document.getElementById("changePinStepOtp").classList.toggle("d-none", stage !== "otp");
    document.getElementById("changePinStepNew").classList.toggle("d-none", stage !== "new");
    document.getElementById("changePinSubmit").textContent = stage === "current" ? "Kirim OTP" : stage === "otp" ? "Verifikasi OTP" : "Simpan PIN Baru";
    const target = document.getElementById(stage === "current" ? "changePinCurrent" : stage === "otp" ? "changePinOtp" : "changePinNew");
    setTimeout(() => target?.focus(), 120);
}

function startChangePinResendTimer(seconds = 60) {
    clearInterval(changePinResendTimerId);
    const button = document.getElementById("changePinResend");
    const label = document.getElementById("changePinResendTimer");
    let remaining = seconds;
    button.disabled = true;
    label.textContent = `(${remaining})`;
    changePinResendTimerId = setInterval(() => {
        remaining -= 1;
        label.textContent = remaining > 0 ? `(${remaining})` : "";
        if (remaining <= 0) {
            clearInterval(changePinResendTimerId);
            changePinResendTimerId = null;
            button.disabled = false;
        }
    }, 1000);
}

function openChangeAdminPinModal() {
    document.getElementById("changePinError").textContent = "";
    document.getElementById("changePinCurrent").value = "";
    document.getElementById("changePinOtp").value = "";
    document.getElementById("changePinNew").value = "";
    document.getElementById("changePinConfirm").value = "";
    clearInterval(changePinResendTimerId);
    setChangePinStage("current");
    changePinModalInstance().show();
}

async function requestAdminPinChangeOtp() {
    const currentPin = document.getElementById("changePinCurrent").value.trim();
    if (!/^\d{6}$/.test(currentPin)) throw new Error("Masukkan PIN saat ini yang valid.");
    const res = await apiFetch("/settings/security-pin/change/request", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ security_pin: currentPin })
    });
    // Jangan simpan current PIN di state atau browser sesudah request ini.
    document.getElementById("changePinCurrent").value = "";
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || "OTP tidak dapat dikirim.");
    setChangePinStage("otp");
    startChangePinResendTimer();
    showToast(data.message || "OTP telah dikirim.");
}

async function resendAdminPinChangeOtp() {
    // Resend sengaja kembali ke tahap PIN saat ini, sehingga tidak ada PIN/session
    // tepercaya yang tersimpan di browser.
    setChangePinStage("current");
    document.getElementById("changePinError").textContent = "Masukkan PIN saat ini untuk mengirim OTP baru.";
}

async function submitAdminPinChangeStep() {
    const errorEl = document.getElementById("changePinError");
    const button = document.getElementById("changePinSubmit");
    errorEl.textContent = "";
    button.disabled = true;
    try {
        if (changePinStage === "current") {
            await requestAdminPinChangeOtp();
        } else if (changePinStage === "otp") {
            const otp = document.getElementById("changePinOtp").value.trim();
            const res = await apiFetch("/settings/security-pin/change/verify-otp", {
                method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ otp })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.message || "OTP tidak dapat diverifikasi.");
            document.getElementById("changePinOtp").value = "";
            clearInterval(changePinResendTimerId);
            setChangePinStage("new");
            showToast(data.message || "OTP terverifikasi.");
        } else {
            const pin = document.getElementById("changePinNew").value.trim();
            const confirmation = document.getElementById("changePinConfirm").value.trim();
            if (!/^\d{6}$/.test(pin) || pin !== confirmation) throw new Error("PIN baru harus 6 digit dan kedua input harus sama.");
            const res = await apiFetch("/settings/security-pin/change", {
                method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin, confirmation })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.message || "PIN tidak dapat diubah.");
            changePinModalInstance().hide();
            showToast(data.message || "Security PIN berhasil diubah.");
        }
    } catch (err) {
        errorEl.textContent = err.message || "Proses perubahan PIN gagal.";
    } finally {
        button.disabled = false;
    }
}

document.getElementById("changeAdminPinModal").addEventListener("hidden.bs.modal", () => {
    clearInterval(changePinResendTimerId);
    changePinResendTimerId = null;
    ["changePinCurrent", "changePinOtp", "changePinNew", "changePinConfirm"].forEach((id) => { document.getElementById(id).value = ""; });
    document.getElementById("changePinError").textContent = "";
    changePinStage = "current";
});

// ================================
// Mobile sidebar (off-canvas)
// ================================
const sidebarEl = document.getElementById("sidebar");
const mobileBackdrop = document.getElementById("mobileBackdrop");

function openMobileSidebar() {
    sidebarEl.classList.add("mobile-open");
    mobileBackdrop.classList.add("active");
}
function closeMobileSidebar() {
    sidebarEl.classList.remove("mobile-open");
    mobileBackdrop.classList.remove("active");
}

document.getElementById("mobileMenuToggle").addEventListener("click", openMobileSidebar);
document.getElementById("sidebarCloseBtn").addEventListener("click", closeMobileSidebar);
mobileBackdrop.addEventListener("click", closeMobileSidebar);

// ================================
// View switching (sidebar)
// ================================

document.querySelectorAll("#sidebarNav .nav-link").forEach(link => {
    link.addEventListener("click", (e) => {
        e.preventDefault();
        document.querySelectorAll("#sidebarNav .nav-link").forEach(l => l.classList.remove("active"));
        link.classList.add("active");
        closeMobileSidebar();

        const view = link.dataset.view;
        document.querySelectorAll(".view-section").forEach(sec => sec.classList.add("d-none"));
        document.getElementById(`view-${view}`).classList.remove("d-none");

        if (view === "orders" && !ordersLoaded) loadOrders();
        if (view === "users") openUsersSecurely();
        if (view === "promo" && !promoLoaded) loadPromo();
        if (view === "news" && !newsLoaded) loadNews();
        if (view === "promocodes" && !promoCodesLoaded) loadPromoCodes();
        if (view === "topup" && !topupProductsLoaded) { loadTopupProducts(); loadTvBalance(); }
        if (view === "settings" && !settingsLoaded) loadSettings();
        if (view === "stats" && !statsLoaded) loadStats();
    });
});

function switchView(view) {
    document.querySelectorAll("#sidebarNav .nav-link").forEach(link => {
        link.classList.toggle("active", link.dataset.view === view);
    });
    document.querySelectorAll(".view-section").forEach(sec => sec.classList.add("d-none"));
    const target = document.getElementById(`view-${view}`);
    if (target) target.classList.remove("d-none");

    if (view === "orders" && !ordersLoaded) loadOrders();
    if (view === "users") openUsersSecurely();
    if (view === "promo" && !promoLoaded) loadPromo();
    if (view === "news" && !newsLoaded) loadNews();
    if (view === "promocodes" && !promoCodesLoaded) loadPromoCodes();
    if (view === "topup" && !topupProductsLoaded) { loadTopupProducts(); loadTvBalance(); }
    if (view === "settings" && !settingsLoaded) loadSettings();
    if (view === "stats" && !statsLoaded) loadStats();
}

function openProductModal() {
    const form = document.getElementById("productForm");
    form.reset();
    previewImage.src = "";
    previewImage.classList.add("d-none");
    editingId = null;
    currentImage = "";
    document.getElementById("modalTitle").innerHTML = '<i class="bi bi-box-seam me-2"></i>Tambah Produk';
    productModal.show();
}

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
        renderProductFilters(products);
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

function renderProducts() {
    const tbody = document.getElementById("products");
    const filtered = getFilteredProducts();

    if (!products.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">Belum ada produk.</td></tr>`;
        return;
    }
    if (!filtered.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">Tidak ada produk yang cocok dengan filter pencarian.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map((product, idx) => `
        <tr>
            <td>${idx + 1}<div class="text-muted small">#${escapeHtml(product.id)} · urutan: ${escapeHtml(product.sort_order ?? "-")}</div></td>
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
    let totalFlashSale = 0;

    data.forEach(item => {
        totalHarga += Number(item.price || 0);
        totalSold += Number(item.sold || 0);
        if (item.is_flash_sale) totalFlashSale += 1;
    });

    document.getElementById("totalProduk").innerText = data.length;
    document.getElementById("totalSold").innerText = totalSold;
    document.getElementById("totalHarga").innerText = "Rp " + totalHarga.toLocaleString("id-ID");
    const flashEl = document.getElementById("totalFlashSale");
    if (flashEl) flashEl.innerText = totalFlashSale;
}

// ================================
// Search & Filters
// ================================

const search = document.getElementById("search");
const productCategoryFilter = document.getElementById("productCategoryFilter");
const productFlashFilter = document.getElementById("productFlashFilter");

if (search) {
    search.addEventListener("input", () => {
        productSearchQuery = search.value.trim().toLowerCase();
        renderProducts(products);
    });
}
if (productCategoryFilter) {
    productCategoryFilter.addEventListener("change", (e) => {
        productCategoryFilterValue = e.target.value;
        renderProducts(products);
    });
}
if (productFlashFilter) {
    productFlashFilter.addEventListener("change", (e) => {
        productFlashFilterValue = e.target.value;
        renderProducts(products);
    });
}

const orderSearchInput = document.getElementById("orderSearchInput");
const orderStatusFilter = document.getElementById("orderStatusFilter");
const orderExportBtn = document.getElementById("orderExportBtn");

if (orderSearchInput) {
    orderSearchInput.addEventListener("input", (e) => {
        orderSearchQuery = e.target.value.trim().toLowerCase();
        renderOrders();
    });
}
if (orderStatusFilter) {
    orderStatusFilter.addEventListener("change", (e) => {
        orderStatusFilterValue = e.target.value.trim().toLowerCase();
        renderOrders();
    });
}
if (orderExportBtn) {
    orderExportBtn.addEventListener("click", exportOrdersCsv);
}

function getFilteredProducts() {
    return products.filter(product => {
        const matchesKeyword = !productSearchQuery || [product.name, product.category, product.badge]
            .map(v => String(v || "").toLowerCase()).some(text => text.includes(productSearchQuery));

        const matchesCategory = !productCategoryFilterValue || (product.category || "") === productCategoryFilterValue;
        const matchesFlash = !productFlashFilterValue || (
            productFlashFilterValue === "flash" ? !!product.is_flash_sale : !product.is_flash_sale
        );

        return matchesKeyword && matchesCategory && matchesFlash;
    });
}

function renderProductFilters(data) {
    const categories = [...new Set(data.map(p => p.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    if (!productCategoryFilter) return;
    const selected = productCategoryFilter.value || "";
    productCategoryFilter.innerHTML = `<option value="">Semua Kategori</option>` +
        categories.map(cat => `<option value="${escapeHtml(cat)}" ${cat === selected ? "selected" : ""}>${escapeHtml(cat)}</option>`).join("");
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
    document.getElementById("sortOrder").value = product.sort_order ?? "";
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
            sort_order: document.getElementById("sortOrder").value === "" ? null : Number(document.getElementById("sortOrder").value),
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
    const ordersCountText = document.getElementById("ordersCountText");
    if (ordersCountText) ordersCountText.textContent = "Memuat pesanan...";
    container.innerHTML = `<div class="text-center text-muted py-5"><span class="spinner-border spinner-border-sm me-2"></span>Memuat...</div>`;

    try {
        const res = await apiFetch("/orders");
        if (!res.ok) throw new Error("not-available");

        ordersData = await res.json();
        ordersLoaded = true;
        renderOrders();
    } catch (err) {
        if (err.message === "unauthorized") return;
        ordersData = [];
        container.innerHTML = `
            <div class="text-center text-muted py-5">
                <i class="bi bi-cart-x display-4 d-block mb-3"></i>
                Fitur Orders belum terhubung ke backend.<br>
                <small>Endpoint <code>GET /orders</code> belum tersedia di API kamu.</small>
            </div>
        `;
        if (ordersCountText) ordersCountText.textContent = "Tidak dapat memuat pesanan.";
    }
}

function getFilteredOrders() {
    return ordersData.filter(order => {
        const text = [order.id, order.customerName, order.name, order.status, order.tujuan, order.email]
            .map(v => String(v || "").toLowerCase()).join(" ");
        const matchesKeyword = !orderSearchQuery || text.includes(orderSearchQuery);
        const matchesStatus = !orderStatusFilterValue || String(order.status || "").toLowerCase() === orderStatusFilterValue;
        return matchesKeyword && matchesStatus;
    });
}

function renderOrders() {
    const container = document.getElementById("ordersContainer");
    const ordersCountText = document.getElementById("ordersCountText");
    const filtered = getFilteredOrders();

    if (!ordersData.length) {
        container.innerHTML = `<p class="text-muted text-center py-5 mb-0">Belum ada pesanan.</p>`;
        if (ordersCountText) ordersCountText.textContent = "Belum ada pesanan.";
        return;
    }

    if (!filtered.length) {
        container.innerHTML = `<p class="text-muted text-center py-5 mb-0">Tidak ada pesanan yang cocok dengan filter.</p>`;
        if (ordersCountText) ordersCountText.textContent = `${ordersData.length} pesanan; 0 cocok.`;
        return;
    }

    const rows = filtered.map(o => `
        <tr>
            <td><code>${escapeHtml(o.id)}</code></td>
            <td>${escapeHtml(o.customerName || o.name || "-")}</td>
            <td>Rp ${Number(o.total || 0).toLocaleString("id-ID")}</td>
            <td>${statusBadge(o.status)}</td>
            <td>${o.created_at ? new Date(o.created_at).toLocaleString("id-ID") : o.date ? new Date(o.date).toLocaleString("id-ID") : "-"}</td>
        </tr>
    `).join("");

    container.innerHTML = `
        <div class="table-responsive">
            <table class="table table-hover align-middle mb-0">
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Pelanggan</th>
                        <th>Total</th>
                        <th>Status</th>
                        <th>Tanggal</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    `;

    if (ordersCountText) {
        const totalText = `${filtered.length} dari ${ordersData.length} pesanan ditampilkan`;
        ordersCountText.textContent = totalText;
    }
}

function exportOrdersCsv() {
    if (!ordersData.length) {
        showToast("Tidak ada pesanan untuk diekspor.", true);
        return;
    }

    const filtered = getFilteredOrders();
    if (!filtered.length) {
        showToast("Tidak ada pesanan yang cocok untuk diekspor.", true);
        return;
    }

    const headers = ["Order ID", "Pelanggan", "Email", "Total", "Status", "Tanggal"];
    const escapeCsv = (value) => {
        const text = String(value ?? "");
        if (/[,\n\r"]/.test(text)) {
            return `"${text.replace(/"/g, '""')}"`;
        }
        return text;
    };
    const lines = [headers.join(",")].concat(filtered.map(o => [
        escapeCsv(o.id),
        escapeCsv(o.customerName || o.name || "-"),
        escapeCsv(o.email || "-"),
        escapeCsv(`Rp ${Number(o.total || 0).toLocaleString("id-ID")}`),
        escapeCsv(o.status || "-"),
        escapeCsv(o.created_at ? new Date(o.created_at).toLocaleString("id-ID") : o.date ? new Date(o.date).toLocaleString("id-ID") : "-")
    ].join(",")));

    const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `nexshop-orders-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    showToast(`Ekspor ${filtered.length} pesanan berhasil.`);
}

// ================================
// Users (waiting on backend endpoint)
// ================================

function scrubUsers() {
    document.getElementById("usersContainer").innerHTML = `<div class="text-center text-muted py-5">Security PIN diperlukan untuk memuat akun.</div>`;
    document.getElementById("otpPendingContainer").innerHTML = `<div class="text-center text-muted py-4">Security PIN diperlukan untuk memuat OTP.</div>`;
}

async function openUsersSecurely() {
    scrubUsers();
    try {
        await withAdminPin(async (security_pin) => {
            await Promise.all([loadUsers(security_pin), loadPendingOtp(security_pin)]);
        }, "membuka Admin Accounts");
    } catch (err) {
        showToast(err.message || "Security PIN diperlukan", true);
    }
}

async function loadUsers(security_pin) {
    const container = document.getElementById("usersContainer");
    container.innerHTML = `<div class="text-center text-muted py-5"><span class="spinner-border spinner-border-sm me-2"></span>Memuat...</div>`;

    try {
        const res = await apiFetch("/users/list", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ security_pin }) });
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
                                <button class="btn btn-sm btn-outline-danger" onclick="deleteUser(${Number(u.id)}, '${escapeHtml(u.email || "").replace(/'/g, "\\'")}')">
                                    <i class="bi bi-trash"></i> Hapus
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
                <small>Data akun tidak dapat dimuat.</small>
            </div>
        `;
    }
}

async function openUserDetail(id) {
    try {
        await withAdminPin(async (security_pin) => {
        const modalEl = document.getElementById("userDetailModal");
        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        const body = document.getElementById("userDetailBody");
        body.innerHTML = `<div class="text-center text-muted py-5"><span class="spinner-border spinner-border-sm me-2"></span>Memuat...</div>`;
        modal.show();
        const res = await apiFetch(`/users/${id}/detail`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ security_pin }) });
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
        }, "membuka detail akun");
    } catch (err) {
        if (err.message === "unauthorized") return;
        const body = document.getElementById("userDetailBody");
        if (body) body.innerHTML = `<div class="text-center text-danger py-5">${escapeHtml(err.message)}</div>`;
    }
}

async function changeUserRole(id, role) {
    try {
        await withAdminPin(async (security_pin) => {
        const res = await apiFetch(`/users/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role, security_pin })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Gagal mengubah role");

        showToast(`Role berhasil diubah jadi "${role}"`);
        }, "mengubah role akun");
    } catch (err) {
        if (err.message === "unauthorized") return;
        console.error(err);
        showToast(err.message, true);
        openUsersSecurely(); // refresh biar dropdown balik ke nilai asli kalau gagal
    }
}

async function toggleUserBlacklist(id, newValue) {
    const confirmMsg = newValue
        ? "Blokir akun ini? User gak akan bisa login sampai dibuka blokirnya lagi."
        : "Buka blokir akun ini?";
    if (!confirm(confirmMsg)) return;

    try {
        await withAdminPin(async (security_pin) => {
        const res = await apiFetch(`/users/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ is_blacklisted: newValue, security_pin })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Gagal mengubah status user");

        showToast(newValue ? "Akun berhasil diblokir" : "Blokir berhasil dibuka");
        await Promise.all([loadUsers(security_pin), loadPendingOtp(security_pin)]);
        }, newValue ? "memblokir akun" : "membuka blokir akun");
    } catch (err) {
        if (err.message === "unauthorized") return;
        console.error(err);
        showToast(err.message, true);
    }
}

async function deleteUser(id, email) {
    if (!confirm(`Hapus akun "${email}"? Ini akan menghapus akun beserta SELURUH riwayat pesanan & topup-nya. Tindakan ini tidak bisa dibatalkan.`)) return;
    if (!confirm(`Sekali lagi — yakin hapus permanen akun "${email}"?`)) return;

    try {
        await withAdminPin(async (security_pin) => {
        const res = await apiFetch(`/users/${id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ security_pin }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Gagal menghapus user");

        showToast("User berhasil dihapus");
        await Promise.all([loadUsers(security_pin), loadPendingOtp(security_pin)]);
        }, "menghapus akun permanen");
    } catch (err) {
        if (err.message === "unauthorized") return;
        console.error(err);
        showToast(err.message, true);
    }
}

// ================================
// OTP Aktif (antisipasi email OTP gagal terkirim)
// ================================

async function loadPendingOtp(security_pin) {
    const container = document.getElementById("otpPendingContainer");
    container.innerHTML = `<div class="text-center text-muted py-4"><span class="spinner-border spinner-border-sm me-2"></span>Memuat...</div>`;

    try {
        const res = await apiFetch("/users/otp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ security_pin }) });
        if (!res.ok) throw new Error("not-available");

        const list = await res.json();

        if (!list.length) {
            container.innerHTML = `<p class="text-muted text-center py-4 mb-0">Tidak ada akun dengan OTP aktif saat ini.</p>`;
            return;
        }

        container.innerHTML = `
            <div class="table-responsive">
            <table class="table table-hover align-middle mb-0">
                <thead><tr><th>Nama</th><th>Email</th><th>Kode OTP</th><th>Berlaku Sampai</th><th>Status</th><th>Aksi</th></tr></thead>
                <tbody>
                    ${list.map(u => `
                        <tr>
                            <td>${escapeHtml(u.name || "-")}</td>
                            <td>${escapeHtml(u.email || "-")}</td>
                            <td><code class="fs-6">${escapeHtml(u.otp_code || "-")}</code></td>
                            <td>${u.otp_expires_at ? new Date(u.otp_expires_at).toLocaleString("id-ID") : "-"}</td>
                            <td>
                                ${u.is_expired
                                    ? `<span class="badge bg-secondary">Kedaluwarsa</span>`
                                    : `<span class="badge bg-success">Berlaku</span>`}
                            </td>
                            <td>
                                <button class="btn btn-sm btn-outline-primary" onclick="adminResendOtp(${Number(u.id)})">
                                    <i class="bi bi-envelope-arrow-up"></i> Kirim Ulang
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
        container.innerHTML = `<p class="text-muted text-center py-4 mb-0">Gagal memuat daftar OTP aktif.</p>`;
    }
}

async function adminResendOtp(id) {
    try {
        await withAdminPin(async (security_pin) => {
        const res = await apiFetch(`/users/${id}/resend-otp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ security_pin }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Gagal mengirim ulang OTP");

        if (data.emailSent === false) {
            showToast(`${data.message} Kode: ${data.otp_code || "-"}`, true);
        } else {
            showToast(data.message || "Kode OTP baru berhasil dikirim");
        }
        await Promise.all([loadUsers(security_pin), loadPendingOtp(security_pin)]);
        }, "mengirim ulang OTP akun");
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
const promoMobileImageInput = document.getElementById("promoMobileImageInput");
const promoMobileImagePreview = document.getElementById("promoMobileImagePreview");

if (promoImageInput) {
    promoImageInput.addEventListener("change", () => {
        const file = promoImageInput.files[0];
        if (!file) return;
        promoImagePreview.src = URL.createObjectURL(file);
        promoImagePreview.classList.remove("d-none");
    });
}

if (promoMobileImageInput) {
    promoMobileImageInput.addEventListener("change", () => {
        const file = promoMobileImageInput.files[0];
        if (!file) return;
        promoMobileImagePreview.src = URL.createObjectURL(file);
        promoMobileImagePreview.classList.remove("d-none");
    });
}

function openPromoModal() {
    editingPromoId = null;
    currentPromoImage = "";
    currentPromoMobileImage = "";
    document.getElementById("promoForm").reset();
    promoImagePreview.src = "";
    promoImagePreview.classList.add("d-none");
    promoMobileImagePreview.src = "";
    promoMobileImagePreview.classList.add("d-none");
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
    currentPromoMobileImage = slide.mobile_image_url || "";
    document.getElementById("promoModalTitle").innerHTML = '<i class="bi bi-megaphone me-2"></i>Edit Slide';
    document.getElementById("promoType").value = slide.type || "promo";
    document.getElementById("promoSortOrder").value = slide.sort_order ?? 0;
    document.getElementById("promoBadge").value = slide.badge_text || "";
    document.getElementById("promoTitle").value = slide.title || "";
    document.getElementById("promoDesc").value = slide.description || "";
    document.getElementById("promoCtaText").value = slide.cta_text || "";
    document.getElementById("promoCtaLink").value = slide.cta_link || "";
    document.getElementById("promoFullImage").checked = !!slide.full_image;
    if (slide.image_url) {
        promoImagePreview.src = slide.image_url;
        promoImagePreview.classList.remove("d-none");
    } else {
        promoImagePreview.src = "";
        promoImagePreview.classList.add("d-none");
    }
    if (slide.mobile_image_url) {
        promoMobileImagePreview.src = slide.mobile_image_url;
        promoMobileImagePreview.classList.remove("d-none");
    } else {
        promoMobileImagePreview.src = "";
        promoMobileImagePreview.classList.add("d-none");
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
    formData.append("full_image", document.getElementById("promoFullImage").checked);

    const file = promoImageInput.files[0];
    if (file) {
        formData.append("image", file);
    } else if (currentPromoImage) {
        formData.append("image_url", currentPromoImage);
    }

    const mobileFile = promoMobileImageInput.files[0];
    if (mobileFile) {
        formData.append("mobile_image", mobileFile);
    } else if (currentPromoMobileImage) {
        formData.append("mobile_image_url", currentPromoMobileImage);
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

const SENSITIVE_SETTINGS_TABS = new Set(["apikeys", "security", "store", "mascot"]);

function scrubSensitiveSettings() {
    hideRevealedSecrets();
    document.getElementById("apiKeysForm")?.reset();
    const blockedIps = document.getElementById("blockedIpsList");
    if (blockedIps) blockedIps.innerHTML = `<div class="text-muted text-center py-3 small">Security PIN diperlukan untuk memuat data.</div>`;
    const unlockInput = document.getElementById("unlockLoginIp");
    if (unlockInput) unlockInput.value = "";
}

function activateSettingsTab(tab, button) {
    document.querySelectorAll("#settingsTabs .nav-link").forEach(b => b.classList.toggle("active", b === button));
    document.getElementById("settingsTabProfile").classList.toggle("d-none", tab !== "profile");
    document.getElementById("settingsTabStore").classList.toggle("d-none", tab !== "store");
    document.getElementById("settingsTabContent").classList.toggle("d-none", tab !== "content");
    document.getElementById("settingsTabApiKeys").classList.toggle("d-none", tab !== "apikeys");
    document.getElementById("settingsTabSecurity").classList.toggle("d-none", tab !== "security");
    document.getElementById("settingsTabMascot").classList.toggle("d-none", tab !== "mascot");
}

document.querySelectorAll("#settingsTabs [data-settings-tab]").forEach(btn => {
    btn.addEventListener("click", async () => {
        const tab = btn.dataset.settingsTab;
        const previousTab = document.querySelector("#settingsTabs .nav-link.active")?.dataset.settingsTab;
        if (!SENSITIVE_SETTINGS_TABS.has(tab)) {
            if (SENSITIVE_SETTINGS_TABS.has(previousTab)) scrubSensitiveSettings();
            activateSettingsTab(tab, btn);
            return;
        }
        const purpose = tab === "apikeys" ? "membuka API Keys" : tab === "security" ? "membuka Keamanan" : "membuka pengaturan sensitif";
        try {
            await withAdminPin(async (security_pin) => {
                if (SENSITIVE_SETTINGS_TABS.has(previousTab) && previousTab !== tab) scrubSensitiveSettings();
                activateSettingsTab(tab, btn);
                if (tab === "apikeys") await loadApiKeys(security_pin);
                if (tab === "security") await loadBlockedIps(security_pin);
            }, purpose);
        } catch (err) {
            // Jangan pernah mengubah tab sebelum PIN sukses; Batal berarti tetap ditolak.
            showToast(err.message || "Security PIN diperlukan", true);
        }
    });
});

// Admin — daftar IP yang lagi diblokir (tab Settings > Keamanan), biar admin
// tinggal klik tombol, gak perlu cari-cari IP manual.
async function loadBlockedIps(security_pin) {
    const container = document.getElementById("blockedIpsList");
    container.innerHTML = `<div class="text-muted text-center py-3 small"><span class="spinner-border spinner-border-sm me-2"></span>Memuat...</div>`;

    try {
        const res = await apiFetch("/auth/admin/blocked-ips", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ security_pin })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Gagal memuat daftar IP");

        if (!data.length) {
            container.innerHTML = `<div class="text-muted text-center py-3 small">Gak ada IP yang lagi diblokir saat ini.</div>`;
            return;
        }

        container.innerHTML = data.map(item => `
            <div class="d-flex justify-content-between align-items-center border rounded p-2 mb-2" style="border-color:var(--line)!important;">
                <div>
                    <strong>${escapeHtml(item.ip)}</strong>
                    <div class="text-muted small">Kena blokir ${timeAgo(item.blockedAt)}</div>
                </div>
                <button class="btn btn-success btn-sm" onclick="unlockLoginIp('${escapeHtml(item.ip)}')">
                    <i class="bi bi-unlock"></i> Buka Blokir
                </button>
            </div>
        `).join("");
    } catch (err) {
        if (err.message === "unauthorized") return;
        console.error(err);
        container.innerHTML = `<div class="text-danger text-center py-3 small">${escapeHtml(err.message)}</div>`;
    }
}

function timeAgo(timestamp) {
    const diffMin = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
    if (diffMin < 1) return "barusan";
    if (diffMin === 1) return "1 menit lalu";
    return `${diffMin} menit lalu`;
}

// Admin — buka blokir rate-limit login untuk 1 IP (tab Settings > Keamanan).
// Dipanggil baik dari tombol di daftar (dikasih `ip` langsung), atau dari
// form manual di bawahnya (ip diambil dari input kalau parameter kosong).
async function unlockLoginIp(ip) {
    const errorEl = document.getElementById("unlockLoginError");
    const successEl = document.getElementById("unlockLoginSuccess");
    errorEl.textContent = "";
    successEl.textContent = "";

    if (typeof ip !== "string" || !ip) {
        ip = document.getElementById("unlockLoginIp").value.trim();
    }
    if (!ip) {
        errorEl.textContent = "IP wajib diisi";
        return;
    }

    try {
        await withAdminPin(async (security_pin) => {
        const res = await apiFetch("/auth/admin/unlock-login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ip, security_pin })
        });
        const data = await res.json();

        if (!res.ok) {
            errorEl.textContent = data.message || "Gagal membuka blokir";
            return;
        }

        successEl.textContent = data.message;
        showToast(data.message);
        document.getElementById("unlockLoginIp").value = "";
        withAdminPin(loadBlockedIps, "memuat daftar IP diblokir").catch(() => {});
        }, "membuka blokir IP");
    } catch (err) {
        if (err.message === "unauthorized") return;
        console.error(err);
        errorEl.textContent = "Terjadi kesalahan, coba lagi.";
    }
}

async function loadSettings() {
    settingsLoaded = true;
    try {
        const [meRes, storeRes] = await Promise.all([
            apiFetch("/settings/me"),
            apiFetch("/settings/store")
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
            document.getElementById("storeTrustBar").checked = store.trust_bar_enabled !== false;
            document.getElementById("storeTrustOrdersOffset").value = store.trust_bar_orders_offset || 0;
            document.getElementById("storeTrustGamesOffset").value = store.trust_bar_games_offset || 0;
            if (store.logo_url) {
                document.getElementById("storeLogoPreview").src = store.logo_url;
                document.getElementById("storeLogoPreview").classList.remove("d-none");
            }

            renderFaqEditor(Array.isArray(store.faq) ? store.faq : []);
            document.getElementById("termsContentInput").value = store.terms_content || "";
            document.getElementById("refundContentInput").value = store.refund_content || "";
            populateMascotSettings(store.event_mascot || {});
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
        const security_pin = await withAdminPin((pin) => pin, "menyimpan konten pengaturan");
        const res = await apiFetch("/settings/store", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...payload, security_pin })
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
        const security_pin = await withAdminPin((pin) => pin, "menyimpan pengaturan toko");
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
            address: document.getElementById("storeAddress").value.trim(),
            trust_bar_enabled: document.getElementById("storeTrustBar").checked,
            trust_bar_orders_offset: parseInt(document.getElementById("storeTrustOrdersOffset").value, 10) || 0,
            trust_bar_games_offset: parseInt(document.getElementById("storeTrustGamesOffset").value, 10) || 0
        };
        if (logoUrl) payload.logo_url = logoUrl;

        const res = await apiFetch("/settings/store", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...payload, security_pin })
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
        apigames_secret_key: document.getElementById("agSecretKey").value.trim(),
        brevo_api_key: document.getElementById("brevoApiKey").value.trim(),
        brevo_sender_email: document.getElementById("brevoSenderEmail").value.trim(),
        brevo_sender_name: document.getElementById("brevoSenderName").value.trim(),
        gemini_api_key: document.getElementById("geminiApiKey").value.trim(),
        gemini_news_model: document.getElementById("geminiNewsModel").value.trim(),
        smtp_host: document.getElementById("smtpHost").value.trim(),
        smtp_port: document.getElementById("smtpPort").value.trim(),
        smtp_user: document.getElementById("smtpUser").value.trim(),
        smtp_password: document.getElementById("smtpPassword").value.trim(),
        smtp_from_email: document.getElementById("smtpFromEmail").value.trim(),
        smtp_from_name: document.getElementById("smtpFromName").value.trim(),
        waapi_url: document.getElementById("waapiUrl").value.trim(),
        waapi_key: document.getElementById("waapiKey").value.trim(),
        waapi_target_number: document.getElementById("waapiTargetNumber").value.trim()
    };

    try {
        await withAdminPin(async (security_pin) => {
        const res = await apiFetch("/settings/api-keys", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...payload, security_pin })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Gagal menyimpan API keys");

        showToast("API keys berhasil disimpan");
        withAdminPin(loadApiKeys, "memuat ulang API Keys").catch(() => {});
        }, "menyimpan API Keys");
    } catch (err) {
        if (err.message === "unauthorized") return;
        errorEl.textContent = err.message;
    }
}

// Admin — test kirim WhatsApp langsung dari tab API Keys, gak perlu nunggu
// ada order/topup beneran cuma buat mastiin gateway-nya nyambung.
async function testWhatsApp() {
    const btn = document.getElementById("waapiTestBtn");
    const resultWrap = document.getElementById("waapiTestResult");
    const alertEl = document.getElementById("waapiTestAlert");
    const rawEl = document.getElementById("waapiTestRaw");

    const payload = {
        number: document.getElementById("waapiTestNumber").value.trim(),
        message: document.getElementById("waapiTestMessage").value.trim()
    };

    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span> Mengirim...`;
    resultWrap.classList.add("d-none");

    try {
        await withAdminPin(async (security_pin) => {
            const res = await apiFetch("/settings/test-whatsapp", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...payload, security_pin })
            });
            const data = await res.json().catch(() => ({}));
            const ok = res.ok && data.success !== false;
            resultWrap.classList.remove("d-none");
            alertEl.classList.remove("alert-success", "alert-danger");
            alertEl.classList.add(ok ? "alert-success" : "alert-danger");
            alertEl.textContent = data.message || (ok ? "Berhasil." : "Gagal mengirim pesan test.");
            if (data.gateway_response) {
                rawEl.classList.remove("d-none");
                rawEl.textContent = typeof data.gateway_response === "string"
                    ? data.gateway_response : JSON.stringify(data.gateway_response, null, 2);
            } else {
                rawEl.classList.add("d-none");
                rawEl.textContent = "";
            }
        }, "mengirim test WhatsApp");
    } catch (err) {
        if (err.message === "unauthorized") return;
        resultWrap.classList.remove("d-none");
        alertEl.classList.remove("alert-success");
        alertEl.classList.add("alert-danger");
        alertEl.textContent = "Gagal menghubungi server: " + err.message;
        rawEl.classList.add("d-none");
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="bi bi-whatsapp"></i> Kirim Test`;
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
        renderKategoriToggleList();
        renderTopupProducts();
        refreshTopupUndoRedoButtons();
    } catch (err) {
        if (err.message === "unauthorized") return;
        tbody.innerHTML = `<tr><td colspan="8" class="text-center text-danger py-4">${escapeHtml(err.message)}</td></tr>`;
    }
}

// Cek ke backend aksi apa yang bisa di-undo/redo saat ini, terus
// enable/disable + kasih tooltip di tombol Undo/Redo sesuai itu.
async function refreshTopupUndoRedoButtons() {
    const undoBtn = document.getElementById("topupUndoBtn");
    const redoBtn = document.getElementById("topupRedoBtn");
    if (!undoBtn || !redoBtn) return;

    try {
        const res = await apiFetch("/topup/admin/products/history-status");
        if (!res.ok) return;
        const data = await res.json();

        undoBtn.disabled = !data.canUndo;
        undoBtn.title = data.canUndo ? `Undo: ${data.undoLabel}` : "Gak ada aksi buat di-undo";

        redoBtn.disabled = !data.canRedo;
        redoBtn.title = data.canRedo ? `Redo: ${data.redoLabel}` : "Gak ada aksi buat di-redo";
    } catch (err) {
        // gak fatal, biarin tombol apa adanya kalau gagal cek status
    }
}

async function undoTopupAction() {
    try {
        const res = await apiFetch("/topup/admin/products/undo", { method: "POST" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Gagal undo");

        showToast(data.message || "Berhasil di-undo");
        loadTopupProducts();
    } catch (err) {
        if (err.message === "unauthorized") return;
        showToast(err.message, true);
    }
}

async function redoTopupAction() {
    try {
        const res = await apiFetch("/topup/admin/products/redo", { method: "POST" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Gagal redo");

        showToast(data.message || "Berhasil di-redo");
        loadTopupProducts();
    } catch (err) {
        if (err.message === "unauthorized") return;
        showToast(err.message, true);
    }
}

// State buat filter kategori & pencarian nama & seleksi checkbox produk topup
let topupKategoriFilter = "";
let topupSearchQuery = "";
let topupSelectedIds = new Set();

function getFilteredTopupProducts() {
    let list = topupKategoriFilter
        ? topupProducts.filter(p => (p.kategori || "Lainnya") === topupKategoriFilter)
        : topupProducts;
    if (topupSearchQuery) {
        const q = topupSearchQuery.toLowerCase();
        list = list.filter(p => String(p.nama || "").toLowerCase().includes(q));
    }
    return list;
}

// Bungkus bagian nama produk yang cocok sama kata pencarian pake <mark>,
// biar admin gampang lihat kenapa produk itu nongol pas ngetik "weekly".
function highlightSearchMatch(nama) {
    const safe = escapeHtml(nama || "");
    if (!topupSearchQuery) return safe;
    const q = topupSearchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // escape regex meta char dari input user
    return safe.replace(new RegExp(`(${q})`, "ig"), "<mark>$1</mark>");
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

    // Datalist buat tombol "Pindah Kategori" massal — admin bisa pilih kategori
    // yang udah ada atau ketik nama baru buat bikin kategori/kartu game baru.
    const datalist = document.getElementById("topupKategoriDatalist");
    if (datalist) datalist.innerHTML = kategoris.map(k => `<option value="${escapeHtml(k)}">`).join("");
}

// "Kelola Kategori" — satu toggle per kategori/game. Sebuah kategori dianggap
// AKTIF kalau minimal 1 produk di dalamnya aktif (sama persis logika yang
// nentuin kartu game itu tampil atau enggak di halaman toko). Nyalain/matiin
// toggle-nya bakal nyalain/matiin SEMUA produk di kategori itu sekaligus.
function renderKategoriToggleList() {
    const container = document.getElementById("kategoriToggleList");
    if (!container) return;

    const map = new Map(); // kategori -> { total, active }
    topupProducts.forEach(p => {
        const k = p.kategori || "Lainnya";
        if (!map.has(k)) map.set(k, { total: 0, active: 0 });
        const entry = map.get(k);
        entry.total += 1;
        if (p.is_active) entry.active += 1;
    });

    const kategoris = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    if (!kategoris.length) {
        container.innerHTML = `<p class="text-muted small mb-0">Sync produk dulu buat lihat daftar kategori</p>`;
        return;
    }

    container.innerHTML = kategoris.map(([kategori, info]) => {
        const isActive = info.active > 0;
        const safeId = `katToggle-${kategori.replace(/[^a-zA-Z0-9]/g, "_")}`;
        return `
            <div class="d-flex justify-content-between align-items-center border rounded px-3 py-2" style="border-color:var(--bs-border-color);">
                <div>
                    <div class="fw-semibold">${escapeHtml(kategori)}</div>
                    <div class="text-muted small">${info.total} produk • ${info.active} aktif</div>
                </div>
                <div class="form-check form-switch mb-0">
                    <input class="form-check-input" type="checkbox" role="switch" id="${safeId}" ${isActive ? "checked" : ""} data-kategori="${escapeHtml(kategori)}">
                </div>
            </div>
        `;
    }).join("");

    container.querySelectorAll("input[data-kategori]").forEach(input => {
        input.addEventListener("change", () => toggleKategoriActive(input.dataset.kategori, input.checked, input));
    });
}

async function toggleKategoriActive(kategori, isActive, inputEl) {
    if (inputEl) inputEl.disabled = true;
    try {
        const res = await apiFetch("/topup/admin/products/kategori-status", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kategori, is_active: isActive })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Gagal mengubah status kategori");

        showToast(data.message || "Status kategori berhasil diubah");
        loadTopupProducts();
    } catch (err) {
        if (inputEl) inputEl.checked = !isActive; // balikin toggle kalau gagal
        if (err.message === "unauthorized") return;
        showToast(err.message, true);
    } finally {
        if (inputEl) inputEl.disabled = false;
    }
}

document.getElementById("topupKategoriFilter").addEventListener("change", (e) => {
    topupKategoriFilter = e.target.value;
    renderTopupProducts();
});

document.getElementById("topupSearchInput").addEventListener("input", (e) => {
    topupSearchQuery = e.target.value.trim();
    renderTopupProducts();
});

function renderTopupProducts() {
    const tbody = document.getElementById("topupProducts");
    const list = getFilteredTopupProducts();

    // buang seleksi yang produknya udah gak kelihatan lagi (filter/refresh)
    const visibleIds = new Set(list.map(p => p.id));
    topupSelectedIds.forEach(id => { if (!visibleIds.has(id)) topupSelectedIds.delete(id); });

    if (!list.length) {
        const emptyMsg = !topupProducts.length
            ? "Belum ada produk. Sync dulu dari TokoVoucher di atas."
            : topupSearchQuery
                ? `Gak ada produk dengan nama mengandung "${escapeHtml(topupSearchQuery)}".`
                : "Gak ada produk di kategori ini.";
        tbody.innerHTML = `<tr><td colspan="11" class="text-center text-muted py-4">${emptyMsg}</td></tr>`;
        updateTopupSelectedCount();
        return;
    }

    const groups = groupTopupProductsByKategori(list);
    tbody.innerHTML = groups.map(([kategori, products]) => `
        <tr class="table-secondary">
            <td colspan="11" class="fw-semibold">
                <i class="bi bi-controller me-1"></i>${escapeHtml(kategori)}
                <span class="text-muted fw-normal small ms-1">(${products.length} produk)</span>
            </td>
        </tr>
        ${products.map(p => {
            const modal = Number(p.harga_beli) || 0;
            const jual = Number(p.harga_jual) || 0;
            const untung = jual - modal;
            const persen = modal > 0 ? (untung / modal) * 100 : 0;
            const untungClass = untung > 0 ? "text-success" : (untung < 0 ? "text-danger" : "text-muted");
            return `
        <tr>
            <td><input type="checkbox" class="form-check-input topup-row-check" data-id="${Number(p.id)}" ${topupSelectedIds.has(p.id) ? "checked" : ""}></td>
            <td>${p.item_icon ? `<img src="${p.item_icon}" alt="" style="width:32px;height:32px;object-fit:contain;">` : `<span class="text-muted">◆</span>`}</td>
            <td><code>${escapeHtml(p.kode_produk)}</code></td>
            <td>${highlightSearchMatch(p.nama)}</td>
            <td>${escapeHtml(p.kategori || "-")}</td>
            <td>Rp ${modal.toLocaleString("id-ID")}</td>
            <td>Rp ${jual.toLocaleString("id-ID")}</td>
            <td class="${untungClass} fw-semibold">
                Rp ${untung.toLocaleString("id-ID")}
                <div class="small fw-normal">${modal > 0 ? persen.toFixed(1) + "%" : "-"}</div>
            </td>
            <td>${p.butuh_server_id ? `<span class="badge bg-info">Ya</span>` : "-"}</td>
            <td>${p.is_active ? `<span class="badge bg-success">Aktif</span>` : `<span class="badge bg-secondary">Nonaktif</span>`}</td>
            <td>
                <button class="btn btn-warning btn-sm" onclick="editTopupProduct(${Number(p.id)})"><i class="bi bi-pencil"></i></button>
                <button class="btn btn-danger btn-sm" onclick="deleteTopupProduct(${Number(p.id)})"><i class="bi bi-trash"></i></button>
            </td>
        </tr>
        `;
        }).join("")}
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

document.getElementById("topupBulkIconInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = ""; // reset biar bisa pilih file yang sama lagi lain kali
    if (!file) return;

    if (topupSelectedIds.size === 0) {
        return showToast("Pilih minimal 1 produk dulu (atau centang \"Pilih semua yang tampil\" per kategori)", true);
    }
    if (!confirm(`Pasang icon ini ke ${topupSelectedIds.size} produk terpilih?`)) return;

    try {
        const formData = new FormData();
        formData.append("image", file);
        const uploadRes = await apiFetch("/upload?type=logo", { method: "POST", body: formData });
        const uploadData = await uploadRes.json().catch(() => ({}));
        if (!uploadRes.ok) throw new Error(uploadData.message || "Upload icon gagal");

        const res = await apiFetch("/topup/admin/products/bulk-icon", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: [...topupSelectedIds], item_icon: uploadData.url })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Gagal menerapkan icon");

        showToast(data.message || "Icon berhasil diterapkan");
        loadTopupProducts();
    } catch (err) {
        if (err.message === "unauthorized") return;
        showToast(err.message, true);
    }
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

// Toggle "butuh server id" massal buat produk terpilih (mis. abis sync
// produk Mobile Legends baru yang semuanya perlu Zone ID)
async function bulkSetTopupButuhServerId(butuhServerId) {
    if (topupSelectedIds.size === 0) return showToast("Pilih minimal 1 produk dulu", true);
    if (!confirm(`${butuhServerId ? "Aktifkan" : "Matikan"} "Butuh Server ID" utk ${topupSelectedIds.size} produk terpilih?`)) return;

    try {
        const res = await apiFetch("/topup/admin/products/bulk-server-id", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: [...topupSelectedIds], butuh_server_id: butuhServerId })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Gagal update produk");

        showToast(data.message || "Produk berhasil diperbarui");
        topupSelectedIds.clear();
        loadTopupProducts();
    } catch (err) {
        if (err.message === "unauthorized") return;
        showToast(err.message, true);
    }
}

async function bulkMoveTopupKategori() {
    if (topupSelectedIds.size === 0) return showToast("Pilih minimal 1 produk dulu", true);
    const input = document.getElementById("topupBulkKategoriInput");
    const kategori = input.value.trim();
    if (!kategori) return showToast("Isi/pilih nama kategori tujuan dulu", true);
    if (!confirm(`Pindahkan ${topupSelectedIds.size} produk terpilih ke kategori "${kategori}"?`)) return;

    try {
        const res = await apiFetch("/topup/admin/products/bulk-kategori", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: [...topupSelectedIds], kategori })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Gagal memindahkan kategori");

        showToast(data.message || "Produk berhasil dipindahkan ke kategori baru");
        topupSelectedIds.clear();
        input.value = "";
        loadTopupProducts();
    } catch (err) {
        if (err.message === "unauthorized") return;
        showToast(err.message, true);
    }
}

async function bulkMarkupTopupPrice() {
    if (topupSelectedIds.size === 0) return showToast("Pilih minimal 1 produk dulu", true);

    const type = document.getElementById("topupBulkMarkupType").value;
    const valueInput = document.getElementById("topupBulkMarkupValue");
    const value = parseFloat(valueInput.value);
    const rounding = document.getElementById("topupBulkMarkupRound").value;

    if (isNaN(value) || value < 0) return showToast("Isi angka markup dulu ya", true);

    const label = type === "percent" ? `${value}%` : `Rp${value.toLocaleString("id-ID")}`;
    if (!confirm(`Hitung ulang harga jual ${topupSelectedIds.size} produk terpilih = harga modal + markup ${label}?`)) return;

    try {
        const res = await apiFetch("/topup/admin/products/bulk-markup", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: [...topupSelectedIds], type, value, rounding })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Gagal menerapkan markup");

        showToast(data.message || "Harga jual berhasil diperbarui");
        topupSelectedIds.clear();
        valueInput.value = "";
        loadTopupProducts();
    } catch (err) {
        if (err.message === "unauthorized") return;
        showToast(err.message, true);
    }
}

// Sama kayak bulkMarkupTopupPrice, tapi gak perlu isi tipe/nilai/pembulatan —
// backend yang hitung sendiri persen wajarnya berdasarkan besaran harga
// modal tiap produk (lihat MARKUP_TIERS di topupController.js)
async function bulkAutoMarkupTopupPrice() {
    if (topupSelectedIds.size === 0) return showToast("Pilih minimal 1 produk dulu", true);

    if (!confirm(`Hitung otomatis harga jual ${topupSelectedIds.size} produk terpilih berdasarkan harga modal masing-masing?`)) return;

    try {
        const res = await apiFetch("/topup/admin/products/auto-markup", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: [...topupSelectedIds] })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Gagal menerapkan markup otomatis");

        showToast(data.message || "Harga jual berhasil dihitung otomatis");
        topupSelectedIds.clear();
        loadTopupProducts();
    } catch (err) {
        if (err.message === "unauthorized") return;
        showToast(err.message, true);
    }
}

// Aktivasi cerdas: dari produk terpilih, cuma varian termurah per nominal
// diamond yang sama/mirip yang diaktifin; kalau kategorinya udah punya
// histori order sukses, nominal yang gak pernah laku ikut dinonaktifin.
async function bulkSmartActivateTopup() {
    if (topupSelectedIds.size === 0) return showToast("Pilih minimal 1 produk dulu", true);

    const capInput = prompt(
        "Batas maksimal nominal aktif per kategori (opsional)\nKosongin kalau gak mau dibatasi, sistem cuma bakal nonaktifin nominal yang gak pernah laku (kalau udah ada histori order):",
        ""
    );
    if (capInput === null) return; // batal
    const cap = capInput.trim() === "" ? null : Number(capInput.trim());
    if (cap !== null && (isNaN(cap) || cap <= 0)) return showToast("Batas harus angka positif", true);

    if (!confirm(`Jalankan aktivasi cerdas ke ${topupSelectedIds.size} produk terpilih? (bisa di-undo)`)) return;

    try {
        const res = await apiFetch("/topup/admin/products/smart-activate", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: [...topupSelectedIds], maxAktifPerKategori: cap })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Gagal menjalankan aktivasi cerdas");

        showToast(data.message || "Aktivasi cerdas selesai");
        topupSelectedIds.clear();
        loadTopupProducts();
    } catch (err) {
        if (err.message === "unauthorized") return;
        showToast(err.message, true);
    }
}

async function bulkDeleteTopupSelected() {
    if (topupSelectedIds.size === 0) return showToast("Pilih minimal 1 produk dulu", true);
    if (!confirm(`Yakin hapus ${topupSelectedIds.size} produk terpilih? (bisa di-undo lewat tombol Undo kalau salah pencet)`)) return;

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

// Produk topup diamond dimuat lazy (biasanya baru ke-load pas admin buka tab
// Topup) -- picker kode promo butuh daftar ini juga, jadi pastiin ke-load
// duluan tanpa numpang di UI tabel Topup (beda dari loadTopupProducts()).
async function ensureTopupProductsForPromo() {
    if (topupProducts.length) return;
    try {
        const res = await apiFetch("/topup/admin/products");
        if (res.ok) {
            topupProducts = await res.json();
            topupProductsLoaded = true;
        }
    } catch (e) { /* silent -- picker tetap bisa jalan cuma buat produk biasa */ }
}

function renderPcProductList(selectedIds) {
    const selected = new Set((selectedIds || []).map(String));
    const listEl = document.getElementById("pcProductList");

    const regularHtml = products.map(p => `
        <div class="form-check">
            <input class="form-check-input pc-product-checkbox" type="checkbox" value="${p.id}" id="pcProductReg${p.id}" ${selected.has(String(p.id)) ? "checked" : ""}>
            <label class="form-check-label" for="pcProductReg${p.id}">${escapeHtml(p.name)}</label>
        </div>
    `).join("");

    const topupHtml = topupProducts.length ? `
        <div class="text-muted small mt-2 mb-1 border-top pt-2"><i class="bi bi-gem"></i> Produk Topup Diamond</div>
        ${topupProducts.map(p => `
            <div class="form-check">
                <input class="form-check-input pc-product-checkbox" type="checkbox" value="${escapeHtml(p.kode_produk)}" id="pcProductTp${escapeHtml(p.kode_produk)}" ${selected.has(String(p.kode_produk)) ? "checked" : ""}>
                <label class="form-check-label" for="pcProductTp${escapeHtml(p.kode_produk)}">💎 ${escapeHtml(p.nama)} <span class="text-muted">(${escapeHtml(p.kode_produk)})</span></label>
            </div>
        `).join("")}
    ` : "";

    listEl.innerHTML = (regularHtml + topupHtml) || `<div class="text-muted">Belum ada produk. Tambah produk dulu di menu Produk / Topup.</div>`;

    // ID yang udah dipilih tapi gak ketemu checkbox-nya (kode produk topup
    // yang belum sempet ke-load, atau ID yang emang mau ditempel manual)
    // ditaruh ke textarea, biar gak ilang pas modal dibuka lagi.
    const knownIds = new Set([...products.map(p => String(p.id)), ...topupProducts.map(p => String(p.kode_produk))]);
    const orphanIds = [...selected].filter((id) => !knownIds.has(id));
    document.getElementById("pcManualIds").value = orphanIds.join(", ");
}

async function openPromoCodeModal() {
    editingPromoCodeId = null;
    document.getElementById("promoCodeForm").reset();
    document.getElementById("pcIsActive").checked = true;
    document.getElementById("pcCode").disabled = false;
    document.getElementById("pcScope").value = "all";
    document.getElementById("pcProductPicker").classList.add("d-none");
    await ensureTopupProductsForPromo();
    renderPcProductList([]);
    document.getElementById("promoCodeModalTitle").innerHTML = '<i class="bi bi-ticket-perforated me-2"></i>Buat Kode Promo';
    document.getElementById("promoCodeError").textContent = "";
    promoCodeModal.show();
}

async function editPromoCode(id) {
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
    document.getElementById("pcMaxUsesPerUser").value = pc.max_uses_per_user || "";
    document.getElementById("pcExpiresAt").value = pc.expires_at ? pc.expires_at.slice(0, 10) : "";
    document.getElementById("pcIsActive").checked = !!pc.is_active;

    const hasRestriction = Array.isArray(pc.applicable_product_ids) && pc.applicable_product_ids.length > 0;
    document.getElementById("pcScope").value = hasRestriction ? "specific" : "all";
    document.getElementById("pcProductPicker").classList.toggle("d-none", !hasRestriction);
    await ensureTopupProductsForPromo();
    renderPcProductList(hasRestriction ? pc.applicable_product_ids : []);

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

    const scope = document.getElementById("pcScope").value;
    let applicable_product_ids = null;
    if (scope === "specific") {
        const checkedIds = Array.from(document.querySelectorAll(".pc-product-checkbox:checked")).map(cb => cb.value);
        const manualIds = (document.getElementById("pcManualIds").value || "")
            .split(/[,\n]/).map(s => s.trim()).filter(Boolean);
        applicable_product_ids = [...new Set([...checkedIds, ...manualIds])];
        if (!applicable_product_ids.length) {
            errorEl.textContent = "Pilih atau tempel minimal 1 ID/kode produk, atau ganti ke \"Semua Produk\"";
            return;
        }
    }

    const payload = {
        code,
        description: document.getElementById("pcDescription").value.trim(),
        discount_type: document.getElementById("pcDiscountType").value,
        discount_value,
        max_discount: document.getElementById("pcMaxDiscount").value || null,
        min_purchase: document.getElementById("pcMinPurchase").value || 0,
        max_uses: document.getElementById("pcMaxUses").value || null,
        max_uses_per_user: document.getElementById("pcMaxUsesPerUser").value || null,
        is_active: document.getElementById("pcIsActive").checked,
        expires_at: document.getElementById("pcExpiresAt").value || null,
        applicable_product_ids
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
        const hasRestriction = Array.isArray(pc.applicable_product_ids) && pc.applicable_product_ids.length > 0;
        const scopeLabel = hasRestriction
            ? `<div class="text-muted small"><i class="bi bi-tag"></i> Khusus ${pc.applicable_product_ids.length} produk</div>`
            : `<div class="text-muted small"><i class="bi bi-tags"></i> Semua produk</div>`;

        return `
        <tr>
            <td><code>${escapeHtml(pc.code)}</code>${pc.description ? `<div class="text-muted small">${escapeHtml(pc.description)}</div>` : ""}${scopeLabel}</td>
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
    localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
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
    const dashboardNotifEl = document.getElementById("dashboardUnreadNotif");
    if (dashboardNotifEl) {
        dashboardNotifEl.innerText = unreadCount;
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
        localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
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

function initThemeToggle() {
    const THEME_STORAGE_KEY = "nexshop-admin-theme";
    function applyTheme(theme) {
        document.documentElement.dataset.theme = theme;
        document.documentElement.setAttribute("data-theme", theme);
        try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch (e) {}
        const isLight = theme === "light";

        document.querySelectorAll("#themeToggle, .theme-toggle").forEach(btn => {
            const icon = btn.querySelector(".theme-toggle-icon");
            const label = btn.querySelector(".theme-toggle-label");
            if (icon) icon.innerHTML = isLight ? '<i class="fa-solid fa-sun" aria-hidden="true"></i>' : '<i class="fa-solid fa-moon" aria-hidden="true"></i>';
            if (label) label.textContent = isLight ? "Mode terang" : "Mode gelap";
            btn.setAttribute("aria-pressed", isLight ? "true" : "false");
        });
    }

    const currentTheme = localStorage.getItem(THEME_STORAGE_KEY) === "light" ? "light" : (document.documentElement.getAttribute("data-theme") || "dark");
    applyTheme(currentTheme);

    document.addEventListener("click", (e) => {
        const btn = e.target.closest("#themeToggle, .theme-toggle");
        if (btn) {
            e.preventDefault();
            e.stopPropagation();
            const activeTheme = document.documentElement.getAttribute("data-theme") || document.documentElement.dataset.theme || "dark";
            const nextTheme = activeTheme === "light" ? "dark" : "light";
            applyTheme(nextTheme);
        }
    });

    window.addEventListener("storage", (e) => {
        if (e.key === THEME_STORAGE_KEY) {
            applyTheme(e.newValue === "light" ? "light" : "dark");
        }
    });
}

function toDateTimeLocal(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function populateMascotSettings(config) {
    document.getElementById("mascotEnabled").checked = config.enabled === true;
    document.getElementById("mascotEventName").value = config.name || "Spider-Man: Brand New Day";
    document.getElementById("mascotSpeed").value = config.speed || 1;
    document.getElementById("mascotDelay").value = Number.isFinite(config.delay) ? config.delay : 500;
    document.getElementById("mascotScale").value = config.scale || 1;
    document.getElementById("mascotPosition").value = "center";
    document.getElementById("mascotStartDate").value = toDateTimeLocal(config.start_date);
    document.getElementById("mascotEndDate").value = toDateTimeLocal(config.end_date);
    document.getElementById("mascotImageInput").dataset.currentUrl = config.mascot_url || "";
    document.getElementById("mascotWebInput").dataset.currentUrl = config.web_url || "";
}

async function uploadMascotAsset(input) {
    const file = input.files[0];
    if (!file) return input.dataset.currentUrl || "";
    const formData = new FormData();
    formData.append("image", file);
    const res = await apiFetch("/upload?type=mascot", { method: "POST", body: formData });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || "Upload asset mascot gagal");
    return data.url;
}

async function saveMascotSettings() {
    const errorEl = document.getElementById("mascotError");
    errorEl.textContent = "";
    try {
        const security_pin = await withAdminPin((pin) => pin, "menyimpan Event Mascot");
        const mascot_url = await uploadMascotAsset(document.getElementById("mascotImageInput"));
        const web_url = await uploadMascotAsset(document.getElementById("mascotWebInput"));
        const event_mascot = {
            enabled: document.getElementById("mascotEnabled").checked,
            name: document.getElementById("mascotEventName").value.trim(), mascot_url, web_url,
            speed: Number(document.getElementById("mascotSpeed").value) || 1,
            delay: Number(document.getElementById("mascotDelay").value) || 0,
            scale: Number(document.getElementById("mascotScale").value) || 1,
            position: document.getElementById("mascotPosition").value,
            start_date: document.getElementById("mascotStartDate").value || null,
            end_date: document.getElementById("mascotEndDate").value || null
        };
        if (event_mascot.enabled && !mascot_url) throw new Error("Upload asset mascot sebelum mengaktifkan event.");
        const res = await apiFetch("/settings/store", {
            method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event_mascot, security_pin })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Gagal menyimpan Event Mascot");
        populateMascotSettings(event_mascot);
        showToast("Event Mascot berhasil disimpan");
    } catch (err) { errorEl.textContent = err.message; }
}

function previewMascotSettings() {
    const mascot_url = document.getElementById("mascotImageInput").files[0]
        ? URL.createObjectURL(document.getElementById("mascotImageInput").files[0])
        : document.getElementById("mascotImageInput").dataset.currentUrl;
    if (!mascot_url) return showToast("Upload mascot terlebih dahulu untuk preview.", true);
    window.open(`../index.html?mascotPreview=1&mascotAsset=${encodeURIComponent(mascot_url)}`, "_blank", "noopener");
}

const SECRET_API_FIELDS = {
    ipaymuApiKey: "ipaymu_api_key",
    tvSecret: "tokovoucher_secret",
    agSecretKey: "apigames_secret_key",
    brevoApiKey: "brevo_api_key",
    geminiApiKey: "gemini_api_key",
    smtpPassword: "smtp_password",
    waapiKey: "waapi_key"
};
let maskedApiKeys = {};
let revealedSecretField = null;
let revealedSecretTimer = null;
let selectedSecretField = null;

function hideRevealedSecrets() {
    if (revealedSecretTimer) clearTimeout(revealedSecretTimer);
    revealedSecretTimer = null;
    if (revealedSecretField) {
        const input = document.getElementById(revealedSecretField);
        if (input) {
            input.value = maskedApiKeys[revealedSecretField] || "";
            input.type = "password";
        }
    }
    revealedSecretField = null;
}

async function loadApiKeys(security_pin) {
    const errorEl = document.getElementById("apiKeysError");
    try {
        const res = await apiFetch("/settings/api-keys", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ security_pin })
        });
        const keys = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(keys.message || "Gagal memuat konfigurasi API");
        document.getElementById("ipaymuVa").value = keys.ipaymu_va || "";
        document.getElementById("ipaymuApiKey").value = keys.ipaymu_api_key || "";
        document.getElementById("ipaymuIsProduction").checked = !!keys.ipaymu_is_production;
        document.getElementById("tvMemberCode").value = keys.tokovoucher_member_code || "";
        document.getElementById("tvSecret").value = keys.tokovoucher_secret || "";
        document.getElementById("agMerchantId").value = keys.apigames_merchant_id || "";
        document.getElementById("agSecretKey").value = keys.apigames_secret_key || "";
        document.getElementById("brevoApiKey").value = keys.brevo_api_key || "";
        document.getElementById("brevoSenderEmail").value = keys.brevo_sender_email || "";
        document.getElementById("brevoSenderName").value = keys.brevo_sender_name || "";
        document.getElementById("geminiApiKey").value = keys.gemini_api_key || "";
        document.getElementById("geminiNewsModel").value = keys.gemini_news_model || "gemini-2.5-flash";
        document.getElementById("smtpHost").value = keys.smtp_host || "";
        document.getElementById("smtpPort").value = keys.smtp_port || "";
        document.getElementById("smtpUser").value = keys.smtp_user || "";
        document.getElementById("smtpPassword").value = keys.smtp_password || "";
        document.getElementById("smtpFromEmail").value = keys.smtp_from_email || "";
        document.getElementById("smtpFromName").value = keys.smtp_from_name || "";
        document.getElementById("waapiUrl").value = keys.waapi_url || "";
        document.getElementById("waapiKey").value = keys.waapi_key || "";
        document.getElementById("waapiTargetNumber").value = keys.waapi_target_number || "";
        maskedApiKeys = Object.fromEntries(Object.keys(SECRET_API_FIELDS).map(id => [id, document.getElementById(id).value]));
        Object.keys(SECRET_API_FIELDS).forEach(id => { document.getElementById(id).type = "password"; });
    } catch (err) {
        if (err.message !== "unauthorized") errorEl.textContent = err.message;
    }
}

async function revealApiKeys() {
    const selected = selectedSecretField;
    if (!selected) {
        showToast("Pilih salah satu field secret terlebih dahulu.", true);
        return;
    }
    try {
        await withAdminPin(async (security_pin) => {
            const res = await apiFetch("/settings/api-keys/reveal", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ security_pin, key: SECRET_API_FIELDS[selected], purpose: "reveal" })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.message || "Gagal menampilkan secret");
            hideRevealedSecrets();
            const input = document.getElementById(selected);
            input.type = "text";
            input.value = data.value;
            revealedSecretField = selected;
            revealedSecretTimer = setTimeout(hideRevealedSecrets, 15000);
            showToast("Secret ditampilkan selama 15 detik.");
        }, "menampilkan secret yang dipilih");
    } catch (err) {
        showToast(err.message || "Gagal membuka konfigurasi API", true);
    }
}

async function copySelectedSecret() {
    const selected = selectedSecretField || revealedSecretField;
    if (!selected) return showToast("Pilih salah satu field secret terlebih dahulu.", true);
    try {
        await withAdminPin(async (security_pin) => {
            const res = await apiFetch("/settings/api-keys/reveal", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ security_pin, key: SECRET_API_FIELDS[selected], purpose: "copy" })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.message || "Gagal menyalin secret");
            await navigator.clipboard.writeText(data.value || "");
            showToast("Secret berhasil disalin.");
        }, "menyalin secret yang dipilih");
    } catch (err) { showToast(err.message || "Gagal menyalin secret", true); }
}

Object.keys(SECRET_API_FIELDS).forEach((id) => {
    const field = document.getElementById(id);
    if (field) {
        field.addEventListener("copy", (event) => event.preventDefault());
        field.addEventListener("focus", () => { selectedSecretField = id; });
    }
});
window.addEventListener("blur", hideRevealedSecrets);
document.addEventListener("visibilitychange", () => { if (document.hidden) hideRevealedSecrets(); });

// ================================
// Curated Gaming News
// ================================
function formatNewsDateInput(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function formatNewsDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "-" : new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(date);
}

function renderNewsPreview(data) {
    const wrap = document.getElementById("newsPreviewWrap");
    const image = document.getElementById("newsPreviewImage");
    if (!data) {
        wrap.classList.add("d-none");
        image.removeAttribute("src");
        document.getElementById("newsPreviewLogoImage").removeAttribute("src");
        return;
    }
    image.src = data.image_url || "";
    image.alt = data.title ? `Preview ${data.title}` : "Preview berita";
    document.getElementById("newsPreviewSource").textContent = data.source || "Publisher";
    document.getElementById("newsPreviewCategory").textContent = data.category || "Gaming";
    document.getElementById("newsPreviewTitle").textContent = data.title || "";
    document.getElementById("newsPreviewDate").textContent = formatNewsDate(data.published_at);
    document.getElementById("newsPreviewSummary").textContent = data.summary || "";
    const logo = document.getElementById("newsPreviewLogoImage");
    const logoWrap = document.getElementById("newsPreviewPublisherLogo");
    if (data.publisher_logo_url) {
        logo.src = data.publisher_logo_url;
        logo.alt = `Logo ${data.source || "publisher"}`;
        logoWrap.classList.remove("d-none");
    } else {
        logo.removeAttribute("src");
        logoWrap.classList.add("d-none");
    }
    const url = document.getElementById("newsPreviewUrl");
    url.href = data.source_url || "#";
    wrap.classList.remove("d-none");
}

async function loadNews() {
    const tbody = document.getElementById("newsItems");
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4"><span class="spinner-border spinner-border-sm me-2"></span>Memuat berita...</td></tr>`;
    try {
        const res = await apiFetch("/news/all");
        if (!res.ok) throw new Error("Gagal mengambil berita game");
        newsEntries = await res.json();
        selectedNewsIds = new Set([...selectedNewsIds].filter((id) => newsEntries.some((item) => Number(item.id) === id)));
        newsLoaded = true;
        renderNews();
    } catch (err) {
        if (err.message === "unauthorized") return;
        tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger py-4">${escapeHtml(err.message)}</td></tr>`;
    }
}

function visibleNewsEntries() {
    const query = (document.getElementById("newsSearch")?.value || "").trim().toLocaleLowerCase("id-ID");
    const filter = document.getElementById("newsFilter")?.value || "all";
    const sort = document.getElementById("newsSort")?.value || "newest";
    const rows = newsEntries.filter((item) => {
        const matchesQuery = !query || [item.title, item.summary, item.source, item.category]
            .some((value) => String(value || "").toLocaleLowerCase("id-ID").includes(query));
        const matchesFilter = filter === "all"
            || (filter === "draft" && !item.is_active)
            || (filter === "published" && item.is_active && !item.is_hidden)
            || (filter === "hidden" && item.is_hidden)
            || (filter === "pinned" && item.is_pinned)
            || (filter === "featured" && item.is_featured);
        return matchesQuery && matchesFilter;
    });
    return rows.sort((left, right) => {
        if (sort === "title") return String(left.title || "").localeCompare(String(right.title || ""), "id-ID");
        if (sort === "source") return String(left.source || "").localeCompare(String(right.source || ""), "id-ID");
        const leftTime = new Date(left.published_at).getTime() || 0;
        const rightTime = new Date(right.published_at).getTime() || 0;
        return sort === "oldest" ? leftTime - rightTime : rightTime - leftTime;
    });
}

function newsStatusMarkup(item) {
    const status = [];
    status.push(item.is_active ? '<span class="badge bg-success">Published</span>' : '<span class="badge bg-secondary">Draft</span>');
    if (item.is_hidden) status.push('<span class="badge bg-dark">Disembunyikan</span>');
    if (item.is_pinned) status.push('<span class="badge bg-info text-dark">Dipin</span>');
    if (item.is_featured) status.push('<span class="badge bg-warning text-dark">Featured</span>');
    return status.join(" ");
}

function renderNews() {
    const tbody = document.getElementById("newsItems");
    const entries = visibleNewsEntries();
    if (!entries.length) {
        const message = newsEntries.length ? "Tidak ada berita yang cocok dengan pencarian." : "Belum ada berita. Tambahkan preview dari publisher tepercaya.";
        tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">${message}</td></tr>`;
        updateNewsBulkTools();
        return;
    }
    tbody.innerHTML = entries.map((item) => {
        const id = Number(item.id);
        return `
            <tr>
                <td><input type="checkbox" class="news-row-select" value="${id}" ${selectedNewsIds.has(id) ? "checked" : ""} onchange="toggleNewsSelection(${id}, this.checked)" aria-label="Pilih ${escapeHtml(item.title)}"></td>
                <td><div class="news-admin-title">${escapeHtml(item.title)}</div><small class="text-muted d-inline-block text-truncate news-admin-summary">${escapeHtml(item.summary)}</small><small class="d-block text-info">${escapeHtml(item.category || "Gaming")}</small></td>
                <td><a href="${escapeHtml(item.source_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.source)}</a></td>
                <td class="text-nowrap">${formatNewsDate(item.published_at)}</td>
                <td class="news-statuses">${newsStatusMarkup(item)}</td>
                <td class="text-nowrap news-row-actions">
                    <button class="btn btn-outline-info btn-sm" onclick="toggleNewsFlag(${id}, 'is_pinned')" title="${item.is_pinned ? "Lepas pin" : "Pin berita"}" aria-label="${item.is_pinned ? "Lepas pin" : "Pin berita"}"><i class="bi bi-pin-angle${item.is_pinned ? "-fill" : ""}"></i></button>
                    <button class="btn btn-outline-warning btn-sm" onclick="toggleNewsFlag(${id}, 'is_featured')" title="${item.is_featured ? "Batalkan feature" : "Feature berita"}" aria-label="${item.is_featured ? "Batalkan feature" : "Feature berita"}"><i class="bi bi-star${item.is_featured ? "-fill" : ""}"></i></button>
                    <button class="btn btn-outline-secondary btn-sm" onclick="toggleNewsFlag(${id}, 'is_hidden')" title="${item.is_hidden ? "Tampilkan di homepage" : "Sembunyikan dari homepage"}" aria-label="${item.is_hidden ? "Tampilkan di homepage" : "Sembunyikan dari homepage"}"><i class="bi bi-eye${item.is_hidden ? "-slash" : ""}"></i></button>
                    <button class="btn btn-outline-success btn-sm" onclick="toggleNewsFlag(${id}, 'is_active')" title="${item.is_active ? "Nonaktifkan berita" : "Aktifkan berita"}" aria-label="${item.is_active ? "Nonaktifkan berita" : "Aktifkan berita"}"><i class="bi bi-power"></i></button>
                    <button class="btn btn-warning btn-sm" onclick="editNews(${id})" title="Edit berita" aria-label="Edit berita"><i class="bi bi-pencil"></i></button>
                    <button class="btn btn-danger btn-sm" onclick="deleteNews(${id})" title="Hapus berita" aria-label="Hapus berita"><i class="bi bi-trash"></i></button>
                </td>
            </tr>`;
    }).join("");
    updateNewsBulkTools();
}

function applyNewsToForm(data) {
    document.getElementById("newsTitle").value = data.title || "";
    document.getElementById("newsSummary").value = data.summary || "";
    document.getElementById("newsSource").value = data.source || "";
    document.getElementById("newsSourceUrl").value = data.source_url || "";
    document.getElementById("newsCanonicalUrl").value = data.canonical_url || data.source_url || "";
    document.getElementById("newsImageUrl").value = data.image_url || "";
    document.getElementById("newsPublisherLogoUrl").value = data.publisher_logo_url || "";
    document.getElementById("newsCategory").value = data.category || "Gaming";
    document.getElementById("newsTags").value = Array.isArray(data.tags) ? data.tags.join(", ") : "";
    document.getElementById("newsPublishedAt").value = formatNewsDateInput(data.published_at);
    document.getElementById("newsSortOrder").value = Number(data.sort_order) || 0;
    document.getElementById("newsIsActive").checked = data.is_active !== false;
    document.getElementById("newsIsHidden").checked = !!data.is_hidden;
    document.getElementById("newsIsPinned").checked = !!data.is_pinned;
    document.getElementById("newsIsFeatured").checked = !!data.is_featured;
}

function openNewsModal() {
    editingNewsId = null;
    newsPreviewData = null;
    document.getElementById("newsForm").reset();
    document.getElementById("newsSortOrder").value = 0;
    document.getElementById("newsPublishedAt").value = formatNewsDateInput(new Date().toISOString());
    document.getElementById("newsIsActive").checked = true;
    document.getElementById("newsIsHidden").checked = false;
    document.getElementById("newsIsPinned").checked = false;
    document.getElementById("newsIsFeatured").checked = false;
    document.getElementById("newsModalTitle").innerHTML = '<i class="bi bi-newspaper me-2"></i>Tambah Berita dari URL';
    document.getElementById("newsError").textContent = "";
    renderNewsPreview(null);
    newsModal.show();
}

async function previewNewsUrl() {
    const errorEl = document.getElementById("newsError");
    const url = document.getElementById("newsImportUrl").value.trim();
    if (!url) { errorEl.textContent = "Tempel URL artikel publisher terlebih dahulu"; return; }
    const button = document.getElementById("previewNewsBtn");
    const previousHtml = button.innerHTML;
    errorEl.textContent = "";
    button.disabled = true;
    button.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Mengambil...';
    try {
        const res = await apiFetch("/news/preview", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url })
        });
        const result = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(result.message || "Metadata artikel tidak dapat diekstrak");
        newsPreviewData = result.data;
        applyNewsToForm(newsPreviewData);
        document.getElementById("newsImportUrl").value = newsPreviewData.source_url;
        renderNewsPreview(newsPreviewData);
        showToast(result.message || "Metadata artikel berhasil diekstrak");
    } catch (err) {
        if (err.message !== "unauthorized") errorEl.textContent = err.message;
    } finally {
        button.disabled = false;
        button.innerHTML = previousHtml;
    }
}

function editNews(id) {
    const item = newsEntries.find((entry) => Number(entry.id) === Number(id));
    if (!item) return;
    editingNewsId = Number(id);
    newsPreviewData = item;
    document.getElementById("newsImportUrl").value = item.source_url || "";
    applyNewsToForm(item);
    renderNewsPreview(item);
    document.getElementById("newsModalTitle").innerHTML = '<i class="bi bi-pencil-square me-2"></i>Edit Berita';
    document.getElementById("newsError").textContent = "";
    newsModal.show();
}

async function saveNews() {
    const errorEl = document.getElementById("newsError");
    const title = document.getElementById("newsTitle").value.trim();
    const summary = document.getElementById("newsSummary").value.trim();
    if (!editingNewsId && !newsPreviewData) { errorEl.textContent = "Preview URL terlebih dahulu sebelum menyimpan berita baru"; return; }
    if (!title || !summary) { errorEl.textContent = "Judul dan ringkasan wajib diisi"; return; }
    const summaryWords = summary.split(/\s+/).filter(Boolean).length;
    if (summaryWords < 300 || summaryWords > 600) { errorEl.textContent = "Ringkasan harus berisi 300–600 kata"; return; }
    const button = document.getElementById("saveNewsBtn");
    const previousHtml = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Menyimpan...';
    const payload = {
        title,
        summary,
        source: document.getElementById("newsSource").value,
        source_url: document.getElementById("newsSourceUrl").value.trim(),
        canonical_url: document.getElementById("newsCanonicalUrl").value.trim(),
        image_url: document.getElementById("newsImageUrl").value.trim(),
        publisher_logo_url: document.getElementById("newsPublisherLogoUrl").value.trim(),
        category: document.getElementById("newsCategory").value.trim(),
        tags: document.getElementById("newsTags").value.split(",").map((tag) => tag.trim()).filter(Boolean),
        published_at: document.getElementById("newsPublishedAt").value,
        sort_order: Number(document.getElementById("newsSortOrder").value || 0),
        is_active: document.getElementById("newsIsActive").checked,
        is_hidden: document.getElementById("newsIsHidden").checked,
        is_pinned: document.getElementById("newsIsPinned").checked,
        is_featured: document.getElementById("newsIsFeatured").checked
    };
    try {
        const res = await apiFetch(editingNewsId ? `/news/${editingNewsId}` : "/news", {
            method: editingNewsId ? "PUT" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Gagal menyimpan berita");
        newsModal.hide();
        newsLoaded = false;
        await loadNews();
        showToast(data.message || "Berita berhasil disimpan");
    } catch (err) {
        if (err.message !== "unauthorized") errorEl.textContent = err.message;
    } finally {
        button.disabled = false;
        button.innerHTML = previousHtml;
    }
}

function toggleNewsSelection(id, checked) {
    if (checked) selectedNewsIds.add(Number(id));
    else selectedNewsIds.delete(Number(id));
    updateNewsBulkTools();
}

function toggleAllNews(checked) {
    visibleNewsEntries().forEach((item) => {
        if (checked) selectedNewsIds.add(Number(item.id));
        else selectedNewsIds.delete(Number(item.id));
    });
    renderNews();
}

function updateNewsBulkTools() {
    const visibleIds = visibleNewsEntries().map((item) => Number(item.id));
    const selectedVisible = visibleIds.filter((id) => selectedNewsIds.has(id));
    const tools = document.getElementById("newsBulkTools");
    const count = document.getElementById("newsSelectionCount");
    const selectAll = document.getElementById("newsSelectAll");
    if (tools) tools.hidden = selectedNewsIds.size === 0;
    if (count) count.textContent = `${selectedNewsIds.size} dipilih`;
    if (selectAll) {
        selectAll.checked = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;
        selectAll.indeterminate = selectedVisible.length > 0 && selectedVisible.length < visibleIds.length;
    }
}

async function bulkNewsAction(action) {
    const ids = [...selectedNewsIds];
    if (!ids.length) return;
    const labels = { publish: "mempublikasikan", unpublish: "menjadikan draft", hide: "menyembunyikan", delete: "menghapus" };
    if (!confirm(`Yakin ingin ${labels[action]} ${ids.length} berita terpilih?`)) return;
    try {
        const res = await apiFetch("/news/bulk", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids, action })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Gagal menjalankan aksi bulk berita");
        selectedNewsIds.clear();
        newsLoaded = false;
        await loadNews();
        showToast(data.message || "Aksi bulk berita berhasil");
    } catch (err) {
        if (err.message !== "unauthorized") showToast(err.message, true);
    }
}

async function toggleNewsFlag(id, key) {
    const item = newsEntries.find((entry) => Number(entry.id) === Number(id));
    if (!item) return;
    try {
        const res = await apiFetch(`/news/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ [key]: !item[key] })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Gagal memperbarui status berita");
        newsLoaded = false;
        await loadNews();
        showToast(data.message || "Status berita berhasil diperbarui");
    } catch (err) {
        if (err.message !== "unauthorized") showToast(err.message, true);
    }
}

async function deleteNews(id) {
    if (!confirm("Hapus berita ini?")) return;
    try {
        const res = await apiFetch(`/news/${id}`, { method: "DELETE" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Gagal menghapus berita");
        newsLoaded = false;
        await loadNews();
        showToast(data.message || "Berita berhasil dihapus");
    } catch (err) {
        if (err.message !== "unauthorized") showToast(err.message, true);
    }
}

document.addEventListener("DOMContentLoaded", initThemeToggle);

