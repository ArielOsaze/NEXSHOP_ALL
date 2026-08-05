/* =========================================================
   NexShop — front-end store logic
   Data is persisted in localStorage. There is no real backend,
   so "login" and "checkout" are simulated for demo purposes.
   ========================================================= */

let PRODUCTS = [];
let selectedCategory = "Semua";
let searchQuery = "";
let cachedStoreSettings = null; // diisi loadStoreSettings(), dipakai buat WA CTA di renderTrackResult

const API_BASE = (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
    ? (window.location.port === "3000" ? "/api" : "http://localhost:3000/api")
    : (window.location.protocol.startsWith("http") ? "/api" : "https://nexshop.cloud/api");
const THEME_STORAGE_KEY = "nexshop_theme";

const PAYMENT_METHODS = [
    { id: "qris", label: "QRIS", desc: "Scan dengan m-banking atau e-wallet", icon: "fa-qrcode" },
    { id: "va", label: "Virtual Account", desc: "BCA, BRI, Mandiri, dan bank lain", icon: "fa-building-columns" },
    { id: "banktransfer", label: "Transfer Bank", desc: "Transfer langsung dari rekening bank", icon: "fa-money-bill-transfer" },
    { id: "card", label: "Kartu Kredit/Debit", desc: "Visa dan Mastercard", icon: "fa-credit-card" }
];

const appLoader = document.getElementById("appLoader");
const appLoaderMessage = document.getElementById("appLoaderMessage");
let activeRequests = 0;
let initialLoading = true;
let loaderShowTimer = null;

function showAppLoader(message = "Memuat data NexShop...") {
    if (!appLoader) return;
    if (appLoaderMessage) appLoaderMessage.textContent = message;
    appLoader.classList.add("is-visible");
    appLoader.setAttribute("aria-busy", "true");
}

function hideAppLoader() {
    if (!appLoader) return;
    appLoader.classList.remove("is-visible");
    appLoader.setAttribute("aria-busy", "false");
}

function beginAppRequest() {
    activeRequests += 1;
    if (initialLoading) return;
    clearTimeout(loaderShowTimer);
    loaderShowTimer = setTimeout(() => showAppLoader(), 160);
}

function endAppRequest() {
    activeRequests = Math.max(0, activeRequests - 1);
    if (activeRequests > 0 || initialLoading) return;
    clearTimeout(loaderShowTimer);
    hideAppLoader();
}

const nativeFetch = window.fetch.bind(window);
window.fetch = (...args) => {
    beginAppRequest();
    return nativeFetch(...args).finally(endAppRequest);
};

function finishInitialLoading() {
    initialLoading = false;
    if (activeRequests === 0) hideAppLoader();
    else showAppLoader("Menyiapkan data toko...");
}

function applyTheme(theme, persist = false) {
    const isLight = theme === "light";
    document.documentElement.dataset.theme = isLight ? "light" : "dark";

    const toggle = document.getElementById("themeToggle");
    if (toggle) {
        const icon = toggle.querySelector(".theme-toggle-icon");
        const label = toggle.querySelector(".theme-toggle-label");
        toggle.setAttribute("aria-pressed", String(isLight));
        toggle.setAttribute("aria-label", isLight ? "Aktifkan mode gelap" : "Aktifkan mode terang");
        toggle.title = isLight ? "Aktifkan mode gelap" : "Aktifkan mode terang";
        if (icon) icon.innerHTML = `<i class="fa-solid ${isLight ? "fa-sun" : "fa-moon"}" aria-hidden="true"></i>`;
        if (label) label.textContent = isLight ? "Mode terang" : "Mode gelap";
    }

    if (persist) localStorage.setItem(THEME_STORAGE_KEY, isLight ? "light" : "dark");
}

const themeToggle = document.getElementById("themeToggle");
if (themeToggle) {
    applyTheme(document.documentElement.dataset.theme);
    themeToggle.addEventListener("click", () => {
        applyTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light", true);
    });
}

const rupiah = (n) => "Rp" + (Number(n) || 0).toLocaleString("id-ID");

// Kalau Flash Sale aktif dan ada harga coret yang lebih tinggi dari harga
// jual, tampilkan harga coret + persentase diskon. Kalau enggak, tampilan
// normal seperti biasa.
function isFlashSaleActive(p) {
    return !!p.is_flash_sale && p.strike_price && Number(p.strike_price) > Number(p.price);
}
function discountPercent(p) {
    return Math.round((1 - Number(p.price) / Number(p.strike_price)) * 100);
}
function priceBlockHtml(p, size = "sm") {
    if (!isFlashSaleActive(p)) {
        return `<span class="price-now ${size}">${rupiah(p.price)}</span>`;
    }
    return `
        <div class="price-row">
            <div class="price-stack">
                <span class="price-now ${size} promo">${rupiah(p.price)}</span>
                <span class="price-strike ${size}">${rupiah(p.strike_price)}</span>
            </div>
            <span class="discount-chip"><i class="fa-solid fa-tag" aria-hidden="true"></i> -${discountPercent(p)}%</span>
        </div>
    `;
}
const stars = (rating) => "★".repeat(Math.round(rating)) + "☆".repeat(5 - Math.round(rating));

function safeJSONParse(value, fallback) {
    if (typeof value !== "string") return fallback;
    try {
        return JSON.parse(value);
    } catch (err) {
        console.warn("Failed to parse JSON from localStorage", err);
        return fallback;
    }
}

/* ---------- State (persisted) ---------- */
let currentUser = safeJSONParse(localStorage.getItem("nexshop_user"), null);

// Cart disimpan per-akun (key beda tiap user_id), plus 1 key terpisah buat
// guest (belum login). Jadi logout/ganti akun gak nyampur keranjang orang lain.
const cartKey = () => currentUser ? `nexshop_cart_${currentUser.id}` : "nexshop_cart_guest";
let cart = safeJSONParse(localStorage.getItem(cartKey()), []);
let activeProductId = null;
let pendingQty = 1;
let checkoutItems = null;
let checkoutSource = "cart";

const saveCart = () => localStorage.setItem(cartKey(), JSON.stringify(cart));
const saveUser = () => localStorage.setItem("nexshop_user", JSON.stringify(currentUser));

function switchCartContext() {
    cart = safeJSONParse(localStorage.getItem(cartKey()), []);
    updateCartCount();
}

/* ---------- Toast ---------- */
function toast(message, type = "default") {
    const container = document.getElementById("toastContainer");
    const el = document.createElement("div");
    el.className = "toast" + (type !== "default" ? " " + type : "");
    const icon = type === "success" ? "fa-circle-check" : type === "error" ? "fa-circle-exclamation" : "fa-circle-info";
    el.setAttribute("role", type === "error" ? "alert" : "status");
    el.innerHTML = `
        <span class="toast-icon" aria-hidden="true"><i class="fa-solid ${icon}"></i></span>
        <span class="toast-message">${escapeHtml(String(message))}</span>
    `;
    container.appendChild(el);
    setTimeout(() => el.remove(), 3000);
}

/* ---------- Overlay helpers ---------- */
function openOverlay(id) {
    document.getElementById(id).classList.add("active");
    document.body.style.overflow = "hidden";
}
function closeOverlay(id) {
    document.getElementById(id).classList.remove("active");
    document.body.style.overflow = "";
}
document.querySelectorAll("[data-close]").forEach(btn => {
    btn.addEventListener("click", () => closeOverlay(btn.dataset.close));
});
document.querySelectorAll(".overlay").forEach(ov => {
    ov.addEventListener("click", (e) => {
        if (e.target === ov) closeOverlay(ov.id);
    });
});
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        document.querySelectorAll(".overlay.active").forEach(ov => closeOverlay(ov.id));
        document.getElementById("accountDropdown").classList.remove("active");
    }
});

/* ---------- Render product catalog ---------- */

async function loadProducts() {
    try {
        const res = await fetch(`${API_BASE}/products`);
        if (!res.ok) {
            console.error("Produk gagal dimuat:", res.status, res.statusText);
            PRODUCTS = [];
            renderCategories();
            renderProducts();
            return;
        }

        const data = await res.json();
        PRODUCTS = Array.isArray(data) ? data : [];
        renderCategories();
        renderProducts();
    } catch (err) {
        console.error(err);
        PRODUCTS = [];
        renderCategories();
        renderProducts();
    }
}
function renderCategories() {
    const filter = document.getElementById("categoryFilter");
    if (!filter) return;

    const categories = [
        "Semua",
        ...new Set(PRODUCTS.map(p => p.category).filter(Boolean))
    ];

    filter.innerHTML = categories.map(cat => `
        <button
            class="category-btn ${cat === selectedCategory ? "active" : ""}"
            data-category="${escapeHtml(cat)}">
            ${escapeHtml(cat)}
        </button>
    `).join("");

    filter.querySelectorAll(".category-btn").forEach(btn => {
        btn.onclick = () => {
            selectedCategory = btn.dataset.category;
            renderCategories();
            renderProducts();
        };
    });
}

function renderProducts() {
    const grid = document.getElementById("cardGrid");
    if (!grid) return;

    let data = selectedCategory === "Semua"
        ? PRODUCTS
        : PRODUCTS.filter(p => p.category === selectedCategory);

    if (searchQuery.trim()) {
        const query = searchQuery.trim().toLowerCase();
        data = data.filter(p =>
            (p.name && p.name.toLowerCase().includes(query)) ||
            (p.category && p.category.toLowerCase().includes(query)) ||
            (p.badge && p.badge.toLowerCase().includes(query)) ||
            (p.description && p.description.toLowerCase().includes(query))
        );
    }

    const countBadge = document.getElementById("searchCountBadge");
    if (countBadge) {
        countBadge.textContent = `${data.length} Produk`;
    }

    const searchClearBtn = document.getElementById("searchClearBtn");
    if (searchClearBtn) {
        searchClearBtn.classList.toggle("hidden", !searchQuery.trim());
    }

    grid.style.opacity = 0;
    grid.style.transform = "translateY(16px)";

    setTimeout(() => {
        if (data.length === 0) {
            grid.innerHTML = `
                <div class="catalog-empty-state">
                    <div class="empty-icon"><i class="fa-solid fa-box-open" aria-hidden="true"></i></div>
                    <h4>Produk Tidak Ditemukan</h4>
                    <p>${searchQuery ? `Tidak ada hasil untuk "<strong>${escapeHtml(searchQuery)}</strong>"` : "Belum ada produk untuk kategori ini."}</p>
                    ${searchQuery || selectedCategory !== "Semua" ? `<button type="button" class="btn-primary btn-sm reset-search-btn" id="resetSearchBtn"><i class="fa-solid fa-rotate-left"></i> Reset Filter</button>` : ""}
                </div>
            `;
            const resetBtn = document.getElementById("resetSearchBtn");
            if (resetBtn) {
                resetBtn.addEventListener("click", () => {
                    searchQuery = "";
                    selectedCategory = "Semua";
                    const searchInput = document.getElementById("searchProductInput");
                    if (searchInput) searchInput.value = "";
                    renderCategories();
                    renderProducts();
                });
            }
        } else {
            grid.innerHTML = data.map(p => `
                <div class="card" data-id="${p.id}">
                    <div class="card-img">
                        <img src="${p.image}" alt="${escapeHtml(p.name)}" loading="lazy" decoding="async">
                        <div class="card-badges">
                            ${p.is_flash_sale ? '<span class="card-flag"><i class="fa-solid fa-bolt" aria-hidden="true"></i> FLASH SALE</span>' : ""}
                            ${p.badge ? `<span class="badge">${escapeHtml(p.badge)}</span>` : ""}
                        </div>
                    </div>
                    <div class="card-body">
                        ${p.category ? `<div class="card-category">${escapeHtml(p.category)}</div>` : ""}
                        <h4>${escapeHtml(p.name)}</h4>
                        <div class="card-rating"><span class="stars">${stars(p.rating || 5)}</span> ${p.rating || 5} · ${p.sold || 0} terjual</div>
                        <div class="card-footer">
                            <div class="card-price-block">${priceBlockHtml(p, "sm")}</div>
                            <div class="card-actions">
                                <button type="button" class="add-btn" data-id="${p.id}" aria-label="Tambah ke Keranjang"><i class="fa-solid fa-cart-plus" aria-hidden="true"></i></button>
                                <button type="button" class="buy-btn" data-id="${p.id}"><span>Beli</span></button>
                            </div>
                        </div>
                    </div>
                </div>
            `).join("");

            grid.querySelectorAll(".card").forEach(card => {
                card.addEventListener("click", (e) => {
                    if (e.target.closest(".add-btn, .buy-btn")) return;
                    openProductModal(Number(card.dataset.id));
                });
            });

            grid.querySelectorAll(".add-btn").forEach(btn => {
                btn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    addToCart(Number(btn.dataset.id), 1);
                });
            });

            grid.querySelectorAll(".buy-btn").forEach(btn => {
                btn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    openCheckout([{ id: Number(btn.dataset.id), qty: 1 }], "direct");
                });
            });
        }

        grid.style.opacity = 1;
        grid.style.transform = "translateY(0)";
    }, 120);
}

/* ---------- Product detail modal ---------- */
function openProductModal(id) {
    const p = PRODUCTS.find(x => x.id === id);
    if (!p) return;
    activeProductId = id;
    pendingQty = 1;

    document.getElementById("pmImage").src = p.image;
    document.getElementById("pmImage").alt = p.name;
    
    const pmFlash = document.getElementById("pmFlashFlag");
    if (pmFlash) pmFlash.classList.toggle("hidden", !p.is_flash_sale);
    const pmBadge = document.getElementById("pmBadge");
    if (pmBadge) {
        pmBadge.textContent = p.badge || "";
        pmBadge.classList.toggle("hidden", !p.badge);
    }

    document.getElementById("pmTitle").textContent = p.name;
    document.getElementById("pmStars").innerHTML = `<span class="stars">${stars(p.rating || 5)}</span> ${p.rating || 5}`;
    document.getElementById("pmSold").textContent = `· ${p.sold || 0} terjual`;
    document.getElementById("pmDesc").textContent = p.description || "";
    document.getElementById("pmPrice").innerHTML = priceBlockHtml(p, "lg");
    document.getElementById("pmQtyValue").value = pendingQty;

    openOverlay("productOverlay");
}

document.getElementById("pmQtyMinus").addEventListener("click", () => {
    pendingQty = Math.max(1, pendingQty - 1);
    document.getElementById("pmQtyValue").value = pendingQty;
});
document.getElementById("pmQtyPlus").addEventListener("click", () => {
    pendingQty = Math.min(99, pendingQty + 1);
    document.getElementById("pmQtyValue").value = pendingQty;
});
document.getElementById("pmQtyValue").addEventListener("input", (e) => {
    // biarin ngetik bebas dulu (termasuk kosong sementara), baru divalidasi pas selesai (blur/change)
    const n = parseInt(e.target.value, 10);
    if (!isNaN(n)) pendingQty = Math.min(99, Math.max(1, n));
});
document.getElementById("pmQtyValue").addEventListener("blur", (e) => {
    // kalau dikosongin/isi bukan angka valid, balikin ke 1
    if (!e.target.value || isNaN(parseInt(e.target.value, 10))) pendingQty = 1;
    e.target.value = pendingQty;
});
document.getElementById("pmAddBtn").addEventListener("click", () => {
    addToCart(activeProductId, pendingQty);
    closeOverlay("productOverlay");
});
document.getElementById("pmBuyNowBtn").addEventListener("click", () => {
    const id = activeProductId;
    const qty = pendingQty;
    closeOverlay("productOverlay");
    openCheckout([{ id, qty }], "direct");
});

/* ---------- Cart logic ---------- */
function addToCart(id, qty) {
    const existing = cart.find(item => item.id === id);
    if (existing) existing.qty += qty;
    else cart.push({ id, qty });
    saveCart();
    updateCartCount();
    const p = PRODUCTS.find(x => x.id === id);
    toast(`${p.name} ditambahkan ke keranjang`, "success");
}

function updateCartCount() {
    const count = cart.reduce((sum, item) => sum + item.qty, 0);
    document.getElementById("cartCount").textContent = count;
}

function renderCart() {
    // drop cart items whose product no longer exists (e.g. stale localStorage
    // from an older catalog) so this can't silently crash before the drawer opens
    const validIds = new Set(PRODUCTS.map(p => p.id));
    const hadInvalid = cart.some(item => !validIds.has(item.id));
    if (hadInvalid) {
        cart = cart.filter(item => validIds.has(item.id));
        saveCart();
        updateCartCount();
    }

    const container = document.getElementById("cartItems");
    if (cart.length === 0) {
        container.innerHTML = `<div class="cart-empty">Keranjang kamu masih kosong.<br>Yuk pilih game favoritmu!</div>`;
        document.getElementById("cartTotal").textContent = rupiah(0);
        return;
    }

    container.innerHTML = cart.map(item => {
        const p = PRODUCTS.find(x => x.id === item.id);
        return `
            <div class="cart-item" data-id="${p.id}">
                <img src="${p.image}" alt="${p.name}" loading="lazy" decoding="async">
                <div class="cart-item-info">
                    <h5>${p.name}</h5>
                    <div class="cart-item-price">${rupiah(p.price * item.qty)}</div>
                    <div class="cart-item-controls">
                        <button type="button" class="qty-minus">−</button>
                        <span>${item.qty}</span>
                        <button type="button" class="qty-plus">+</button>
                        <button type="button" class="cart-item-remove">Hapus</button>
                    </div>
                </div>
            </div>
        `;
    }).join("");

    const total = cart.reduce((sum, item) => {
        const p = PRODUCTS.find(x => x.id === item.id);
        return sum + p.price * item.qty;
    }, 0);
    document.getElementById("cartTotal").textContent = rupiah(total);

    container.querySelectorAll(".cart-item").forEach(row => {
        const id = Number(row.dataset.id);
        row.querySelector(".qty-plus").addEventListener("click", () => changeQty(id, 1));
        row.querySelector(".qty-minus").addEventListener("click", () => changeQty(id, -1));
        row.querySelector(".cart-item-remove").addEventListener("click", () => removeFromCart(id));
    });
}

function changeQty(id, delta) {
    const item = cart.find(x => x.id === id);
    if (!item) return;
    item.qty += delta;
    if (item.qty <= 0) cart = cart.filter(x => x.id !== id);
    saveCart();
    updateCartCount();
    renderCart();
}

function removeFromCart(id) {
    cart = cart.filter(x => x.id !== id);
    saveCart();
    updateCartCount();
    renderCart();
}

document.getElementById("cartBtn").addEventListener("click", () => {
    renderCart();
    openOverlay("cartOverlay");
});

/* ---------- Auth ---------- */
const accountBtn = document.getElementById("accountBtn");
const accountDropdown = document.getElementById("accountDropdown");

function refreshAccountUI() {
    if (currentUser) {
        accountBtn.textContent = currentUser.fullname.split(" ")[0];
        accountBtn.classList.add("logged-in");
        document.getElementById("accountAvatar").textContent = currentUser.fullname.charAt(0).toUpperCase();
        document.getElementById("accountName").textContent = currentUser.fullname;
        document.getElementById("accountEmail").textContent = currentUser.email;
    } else {
        accountBtn.textContent = "Login";
        accountBtn.classList.remove("logged-in");
    }
}

accountBtn.addEventListener("click", () => {
    if (currentUser) {
        accountDropdown.classList.toggle("active");
    } else {
        openOverlay("authOverlay");
    }
});

document.addEventListener("click", (e) => {
    if (!accountDropdown.contains(e.target) && e.target !== accountBtn) {
        accountDropdown.classList.remove("active");
    }
});

document.querySelectorAll(".auth-tab").forEach(tab => {
    tab.addEventListener("click", () => {
        document.querySelectorAll(".auth-tab").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        const isLogin = tab.dataset.tab === "login";
        document.getElementById("loginForm").classList.toggle("hidden", !isLogin);
        document.getElementById("registerForm").classList.toggle("hidden", isLogin);
        document.getElementById("otpForm").classList.add("hidden");
        document.getElementById("forgotPasswordForm").classList.add("hidden");
        document.getElementById("resetPasswordForm").classList.add("hidden");
    });
});

/* ---------- Lupa Password ---------- */
function showForgotPasswordForm() {
    document.querySelectorAll(".auth-tab").forEach(t => t.classList.remove("active"));
    document.getElementById("loginForm").classList.add("hidden");
    document.getElementById("registerForm").classList.add("hidden");
    document.getElementById("otpForm").classList.add("hidden");
    document.getElementById("resetPasswordForm").classList.add("hidden");
    document.getElementById("forgotPasswordForm").classList.remove("hidden");
    document.getElementById("forgotPasswordError").textContent = "";
    document.getElementById("forgotPasswordSuccess").classList.add("hidden");
    document.getElementById("forgotPasswordEmail").value = document.getElementById("loginEmail").value || "";
}

document.getElementById("forgotPasswordLink").addEventListener("click", showForgotPasswordForm);

document.getElementById("backToLoginFromForgotBtn").addEventListener("click", () => {
    document.getElementById("forgotPasswordForm").classList.add("hidden");
    document.querySelector('[data-tab="login"]').classList.add("active");
    document.getElementById("loginForm").classList.remove("hidden");
});

document.getElementById("forgotPasswordForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("forgotPasswordEmail").value.trim().toLowerCase();
    const errorEl = document.getElementById("forgotPasswordError");
    const successEl = document.getElementById("forgotPasswordSuccess");
    const btn = document.getElementById("forgotPasswordSubmitBtn");

    errorEl.textContent = "";
    successEl.classList.add("hidden");
    btn.disabled = true;
    btn.textContent = "Mengirim...";

    try {
        const res = await fetch(`${API_BASE}/auth/forgot-password`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email })
        });
        const data = await res.json();

        if (!res.ok) {
            errorEl.textContent = data.message || "Gagal mengirim link reset.";
            return;
        }

        successEl.textContent = data.message;
        successEl.classList.remove("hidden");
        e.target.querySelector("input").value = "";
    } catch (err) {
        errorEl.textContent = "Gagal terhubung ke server.";
    } finally {
        btn.disabled = false;
        btn.textContent = "Kirim Link Reset";
    }
});

/* ---------- Reset Password (dibuka via link di email, #/reset-password?token=...) ---------- */
function showResetPasswordForm(token) {
    document.querySelectorAll(".auth-tab").forEach(t => t.classList.remove("active"));
    document.getElementById("loginForm").classList.add("hidden");
    document.getElementById("registerForm").classList.add("hidden");
    document.getElementById("otpForm").classList.add("hidden");
    document.getElementById("forgotPasswordForm").classList.add("hidden");
    document.getElementById("resetPasswordForm").classList.remove("hidden");
    document.getElementById("resetPasswordToken").value = token;
    document.getElementById("resetPasswordError").textContent = "";
    document.getElementById("resetPasswordSuccess").classList.add("hidden");
    openOverlay("authOverlay");
}

function checkResetPasswordLink() {
    const hash = window.location.hash || "";
    if (!hash.startsWith("#/reset-password")) return;

    const query = new URLSearchParams(hash.split("?")[1] || "");
    const token = query.get("token");
    if (!token) return;

    showResetPasswordForm(token);
    history.replaceState(null, "", window.location.pathname + window.location.search);
}

document.getElementById("resetPasswordForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const token = document.getElementById("resetPasswordToken").value;
    const newPassword = document.getElementById("resetPasswordNew").value;
    const confirmPassword = document.getElementById("resetPasswordConfirm").value;
    const errorEl = document.getElementById("resetPasswordError");
    const successEl = document.getElementById("resetPasswordSuccess");
    const btn = document.getElementById("resetPasswordSubmitBtn");

    errorEl.textContent = "";
    successEl.classList.add("hidden");

    if (newPassword !== confirmPassword) {
        errorEl.textContent = "Password baru gak sama dengan ulangannya.";
        return;
    }

    btn.disabled = true;
    btn.textContent = "Menyimpan...";

    try {
        const res = await fetch(`${API_BASE}/auth/reset-password`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token, newPassword })
        });
        const data = await res.json();

        if (!res.ok) {
            errorEl.textContent = data.message || "Gagal mengganti password.";
            return;
        }

        successEl.textContent = data.message;
        successEl.classList.remove("hidden");
        e.target.reset();

        // otomatis balik ke tab login abis 2 detik, biar user bisa langsung
        // pakai password barunya
        setTimeout(() => {
            document.getElementById("resetPasswordForm").classList.add("hidden");
            document.querySelector('[data-tab="login"]').classList.add("active");
            document.getElementById("loginForm").classList.remove("hidden");
        }, 2000);
    } catch (err) {
        errorEl.textContent = "Gagal terhubung ke server.";
    } finally {
        btn.disabled = false;
        btn.textContent = "Ganti Password";
    }
});

document.getElementById("registerForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fullname = document.getElementById("regName").value.trim();
    const email = document.getElementById("regEmail").value.trim().toLowerCase();
    const password = document.getElementById("regPassword").value;
    const errorEl = document.getElementById("regError");

    try {
        const res = await fetch(`${API_BASE}/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fullname, email, password })
        });
        const data = await res.json();

        if (!res.ok) {
            errorEl.textContent = data.message;
            return;
        }
        errorEl.textContent = "";
        e.target.reset();
        showOtpForm(email);
        toast("Cek email kamu untuk kode verifikasi.", "success");
    } catch (err) {
        errorEl.textContent = "Gagal terhubung ke server.";
    }
});

function showOtpForm(email) {
    document.querySelectorAll(".auth-tab").forEach(t => t.classList.remove("active"));
    document.getElementById("loginForm").classList.add("hidden");
    document.getElementById("registerForm").classList.add("hidden");
    document.getElementById("otpForm").classList.remove("hidden");
    document.getElementById("otpEmail").value = email;
    document.getElementById("otpEmailLabel").textContent = email;
    document.getElementById("otpError").textContent = "";
    openOverlay("authOverlay");
}

document.getElementById("otpForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("otpEmail").value;
    const otp = document.getElementById("otpCode").value.trim();
    const errorEl = document.getElementById("otpError");

    try {
        const res = await fetch(`${API_BASE}/auth/verify-otp`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, otp })
        });
        const data = await res.json();

        if (!res.ok) {
            errorEl.textContent = data.message;
            return;
        }

        errorEl.textContent = "";
        e.target.reset();
        document.getElementById("otpForm").classList.add("hidden");
        document.querySelector('[data-tab="login"]').classList.add("active");
        document.getElementById("loginForm").classList.remove("hidden");
        document.getElementById("loginEmail").value = email;
        toast("Verifikasi berhasil! Silakan masuk.", "success");
    } catch (err) {
        errorEl.textContent = "Gagal terhubung ke server.";
    }
});

document.getElementById("otpResendBtn").addEventListener("click", async () => {
    const email = document.getElementById("otpEmail").value;
    const errorEl = document.getElementById("otpError");
    const btn = document.getElementById("otpResendBtn");

    btn.disabled = true;
    btn.textContent = "Mengirim...";

    try {
        const res = await fetch(`${API_BASE}/auth/resend-otp`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email })
        });
        const data = await res.json();

        if (!res.ok) {
            errorEl.textContent = data.message;
        } else {
            errorEl.textContent = "";
            toast("Kode baru sudah dikirim.", "success");
        }
    } catch (err) {
        errorEl.textContent = "Gagal terhubung ke server.";
    } finally {
        btn.disabled = false;
        btn.textContent = "Kirim ulang kode";
    }
});

document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("loginEmail").value.trim().toLowerCase();
    const password = document.getElementById("loginPassword").value;
    const errorEl = document.getElementById("loginError");

    try {
        const res = await fetch(`${API_BASE}/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();

        if (!res.ok) {
            if (data.needsVerification) {
                errorEl.textContent = "";
                showOtpForm(data.email || email);
                toast("Email belum diverifikasi. Cek kode OTP kamu.");
                return;
            }
            errorEl.textContent = data.message;
            return;
        }
        localStorage.setItem("nexshop_token", data.token);
        currentUser = data.user;
        saveUser();
        switchCartContext();
        refreshAccountUI();
        closeOverlay("authOverlay");
        toast(`Berhasil masuk. Selamat datang kembali, ${data.user.fullname}!`, "success");
        e.target.reset();
    } catch (err) {
        errorEl.textContent = "Gagal terhubung ke server.";
    }
});

document.getElementById("logoutBtn").addEventListener("click", () => {
    currentUser = null;
    saveUser();
    localStorage.removeItem("nexshop_token");

    // logout selalu nampilin keranjang kosong (bukan nyisa punya guest sebelumnya)
    cart = [];
    saveCart();
    updateCartCount();

    refreshAccountUI();
    accountDropdown.classList.remove("active");
    toast("Kamu berhasil keluar.");
});

document.getElementById("myOrdersBtn").addEventListener("click", () => {
    accountDropdown.classList.remove("active");
    openTrackModal("mine");
});

/* ---------- Checkout ---------- */
let appliedPromo = null; // { code, discount }
let selectedPaymentMethod = null;

function getCheckoutItems() {
    return checkoutItems || cart;
}

function renderCheckoutPaymentMethods() {
    const grid = document.getElementById("checkoutPaymentGrid");
    if (!grid) return;

    grid.innerHTML = PAYMENT_METHODS.map((method) => `
        <button type="button" class="checkout-payment-card ${selectedPaymentMethod === method.id ? "selected" : ""}" data-payment-method="${method.id}">
            <span class="checkout-payment-icon checkout-payment-icon--${method.id}" aria-hidden="true"><i class="fa-solid ${method.icon}"></i></span>
            <span class="checkout-payment-copy">
                <strong>${method.label}</strong>
                <small>${method.desc}</small>
            </span>
            <span class="checkout-payment-check" aria-hidden="true"><i class="fa-solid fa-check"></i></span>
        </button>
    `).join("");

    grid.querySelectorAll("[data-payment-method]").forEach((card) => {
        card.addEventListener("click", () => {
            selectedPaymentMethod = card.dataset.paymentMethod;
            renderCheckoutPaymentMethods();
        });
    });
}

function cartSubtotal(items = getCheckoutItems()) {
    return items.reduce((sum, item) => {
        const p = PRODUCTS.find(x => x.id === item.id);
        return p ? sum + p.price * item.qty : sum;
    }, 0);
}

function renderCheckoutSummary() {
    const subtotal = cartSubtotal();
    const itemCount = getCheckoutItems().reduce((sum, item) => sum + item.qty, 0);
    const discount = appliedPromo ? appliedPromo.discount : 0;
    const total = Math.max(subtotal - discount, 0);

    document.getElementById("checkoutSummary").innerHTML = `
        <div class="row"><span>${itemCount} item</span><span>${rupiah(subtotal)}</span></div>
        ${appliedPromo ? `<div class="row discount"><span>Diskon (${appliedPromo.code})</span><span>-${rupiah(discount)}</span></div>` : ""}
        <div class="row total"><span>Total Bayar</span><span>${rupiah(total)}</span></div>
    `;
}

function openCheckout(items, source = "cart") {
    const validItems = (items || []).filter(item => PRODUCTS.some(p => p.id === item.id) && item.qty > 0);
    if (validItems.length === 0) {
        toast("Keranjang masih kosong.", "error");
        return;
    }

    checkoutItems = validItems.map(item => ({ id: item.id, qty: item.qty }));
    checkoutSource = source;
    closeOverlay("cartOverlay");

    appliedPromo = null;
    selectedPaymentMethod = null;
    document.getElementById("promoCodeInput").value = "";
    document.getElementById("promoCodeMsg").textContent = "";
    document.getElementById("promoCodeMsg").className = "promo-code-msg";

    document.getElementById("checkoutGuestNote").classList.toggle("hidden", !!currentUser);

    if (currentUser) {
        document.getElementById("checkoutName").value = currentUser.fullname;
        document.getElementById("checkoutEmail").value = currentUser.email;
    } else {
        document.getElementById("checkoutName").value = "";
        document.getElementById("checkoutEmail").value = "";
    }

    renderCheckoutSummary();
    renderCheckoutPaymentMethods();

    document.getElementById("checkoutStep").classList.remove("hidden");
    document.getElementById("checkoutSuccess").classList.add("hidden");
    openOverlay("checkoutOverlay");
}

document.getElementById("checkoutBtn").addEventListener("click", () => {
    if (cart.length === 0) {
        toast("Keranjang masih kosong.", "error");
        return;
    }
    openCheckout(cart, "cart");
});

document.getElementById("applyPromoBtn").addEventListener("click", async () => {
    const code = document.getElementById("promoCodeInput").value.trim();
    const msgEl = document.getElementById("promoCodeMsg");

    if (!code) {
        msgEl.textContent = "Masukkan kode promo dulu";
        msgEl.className = "promo-code-msg error";
        return;
    }

    try {
        // kirim email juga kalau udah keisi (di form checkout atau dari akun
        // yang login) -- biar preview batas "1x per user" ke-cek dari awal,
        // bukan cuma pas submit order beneran
        const emailForPromo = document.getElementById("checkoutEmail").value.trim() || (currentUser ? currentUser.email : "");
        const res = await fetch(`${API_BASE}/promo-codes/validate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code, cart: getCheckoutItems().map(i => ({ id: i.id, qty: i.qty })), email: emailForPromo || undefined })
        });
        const data = await res.json();

        if (!res.ok || !data.valid) {
            appliedPromo = null;
            msgEl.textContent = data.message || "Kode promo tidak valid";
            msgEl.className = "promo-code-msg error";
            renderCheckoutSummary();
            return;
        }

        appliedPromo = { code: data.code, discount: data.discount };
        msgEl.textContent = `Kode "${data.code}" berhasil diterapkan! Hemat ${rupiah(data.discount)}`;
        msgEl.className = "promo-code-msg success";
        renderCheckoutSummary();
    } catch (err) {
        msgEl.textContent = "Gagal menghubungi server";
        msgEl.className = "promo-code-msg error";
    }
});

document.getElementById("checkoutLoginLink").addEventListener("click", () => {
    closeOverlay("checkoutOverlay");
    openOverlay("authOverlay");
});

document.getElementById("checkoutForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const recipient_name = document.getElementById("checkoutName").value.trim();
    const recipient_email = document.getElementById("checkoutEmail").value.trim();
    const token = localStorage.getItem("nexshop_token");
    const submitBtn = e.target.querySelector('button[type="submit"]');

    if (!selectedPaymentMethod) {
        toast("Pilih metode pembayaran dulu ya.", "error");
        return;
    }

    const items = getCheckoutItems();
    if (!items.length) {
        toast("Tidak ada produk untuk dibayar.", "error");
        return;
    }

    const subtotal = cartSubtotal(items);
    const total = appliedPromo ? Math.max(subtotal - appliedPromo.discount, 0) : subtotal;

    submitBtn.disabled = true;
    submitBtn.textContent = "Memproses...";

    try {
        // Backend membuat order DAN transaksi iPaymu (server-side, pakai VA/API
        // Key iPaymu), lalu mengembalikan paymentUrl (halaman bayar iPaymu) di sini.
        // Total dihitung ulang & divalidasi lagi di backend — nilai di sini cuma buat tampilan.
        const headers = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const res = await fetch(`${API_BASE}/orders`, {
            method: "POST",
            headers,
            body: JSON.stringify({
                recipient_name,
                recipient_email,
                payment_method: selectedPaymentMethod,
                items,
                total,
                promo_code: appliedPromo ? appliedPromo.code : undefined
            })
        });
        const data = await res.json();

        if (!res.ok) {
            toast(data.message || "Gagal membuat pesanan", "error");
            submitBtn.disabled = false;
            submitBtn.textContent = "Bayar Sekarang";
            return;
        }

        if (!data.paymentUrl) {
            toast("URL pembayaran tidak ditemukan dari server.", "error");
            submitBtn.disabled = false;
            submitBtn.textContent = "Bayar Sekarang";
            return;
        }

        // Pesanan sudah tercatat "pending" di server & bakal diupdate otomatis
        // lewat webhook iPaymu begitu lunas. Checkout dari keranjang dikosongkan
        // sebelum redirect, sedangkan "Beli Sekarang" membiarkan keranjang tetap utuh.
        if (checkoutSource === "cart") {
            cart = [];
            saveCart();
            updateCartCount();
        }
        checkoutItems = null;
        checkoutSource = "cart";

        window.location.href = data.paymentUrl;
    } catch (err) {
        toast("Gagal terhubung ke server.", "error");
        submitBtn.disabled = false;
        submitBtn.textContent = "Bayar Sekarang";
    }
});

function showCheckoutSuccess(recipient_name, total, statusText, orderId) {
    const trackingNote = currentUser
        ? `Kamu bisa cek status di "Pesanan Saya".`
        : `⚠️ Kamu checkout tanpa akun — catat Order ID ini baik-baik, karena tidak tersimpan di riwayat manapun: <strong>${orderId}</strong>`;

    document.getElementById("checkoutSuccessMsg").innerHTML =
        `Terima kasih, ${recipient_name}! Pesanan kamu senilai ${rupiah(total)} ${statusText}. ${trackingNote}`;

    document.getElementById("checkoutStep").classList.add("hidden");
    document.getElementById("checkoutSuccess").classList.remove("hidden");
    openOverlay("checkoutOverlay");

    if (checkoutSource === "cart") {
        cart = [];
        saveCart();
        updateCartCount();
    }
    checkoutItems = null;
    checkoutSource = "cart";
}

/* ---------- FAQ / Terms / Refund / Kontak modal ---------- */
function openPolicy(tab) {
    document.querySelectorAll(".policy-tab").forEach(t => {
        t.classList.toggle("active", t.dataset.policyTab === tab);
    });
    document.getElementById("policyFaq").classList.toggle("hidden", tab !== "faq");
    document.getElementById("policyTerms").classList.toggle("hidden", tab !== "terms");
    document.getElementById("policyRefund").classList.toggle("hidden", tab !== "refund");
    document.getElementById("policyContact").classList.toggle("hidden", tab !== "contact");
    openOverlay("policyOverlay");
}

document.querySelectorAll("[data-policy-tab]").forEach(btn => {
    btn.addEventListener("click", () => openPolicy(btn.dataset.policyTab));
});

/* ---------- Cek Transaksi (tab publik, cek status via Order ID) ---------- */
const STATUS_LABEL = {
    paid: "Dibayar — Diproses", sukses: "Sukses", processing: "Diproses",
    pending: "Menunggu Pembayaran", failed: "Gagal", gagal: "Gagal", cancel: "Dibatalkan"
};
const STATUS_CLASS = {
    paid: "success", sukses: "success", processing: "info",
    pending: "warning", failed: "danger", gagal: "danger", cancel: "danger"
};

function renderTrackResult(data, options = {}) {
    const label = STATUS_LABEL[data.status] || data.status;
    const cls = STATUS_CLASS[data.status] || "info";
    const tanggal = data.created_at ? new Date(data.created_at).toLocaleString("id-ID") : "-";
    const fromPaymentReturn = options.fromPaymentReturn === true;

    let itemsHtml = "";
    if (data.type === "order") {
        itemsHtml = (data.items || []).map(i =>
            `<div class="row"><span>${escapeHtml(i.name)}${i.quantity > 1 ? ` ×${i.quantity}` : ""}</span></div>`
        ).join("");
        if (data.discount_amount > 0) {
            itemsHtml += `<div class="row discount"><span>Diskon${data.promo_code ? ` (${escapeHtml(data.promo_code)})` : ""}</span><span>-${rupiah(data.discount_amount)}</span></div>`;
        }
    } else {
        itemsHtml = `
            <div class="row"><span>Produk</span><span>${escapeHtml(data.nama_produk || "-")}</span></div>
            <div class="row"><span>User ID</span><span>${escapeHtml(String(data.tujuan || "-"))}${data.server_id ? " (" + escapeHtml(String(data.server_id)) + ")" : ""}</span></div>
            ${data.serial_number ? `<div class="row"><span>Kode/SN</span><span>${escapeHtml(data.serial_number)}</span></div>` : ""}
        `;
        if (data.discount_amount > 0) {
            itemsHtml += `<div class="row"><span>Harga Awal</span><span>${rupiah(data.subtotal || 0)}</span></div>`;
            itemsHtml += `<div class="row discount"><span>Diskon${data.promo_code ? ` (${escapeHtml(data.promo_code)})` : ""}</span><span>-${rupiah(data.discount_amount)}</span></div>`;
        }
    }

    // Produk "biasa" (game key/Xbox Game Pass/bundle) dikirim MANUAL via WA
    // (beda dari topup diamond yang otomatis lewat TokoVoucher) — begitu
    // statusnya "paid", kasih tombol WA langsung dengan No. Transaksi
    // ter-prefill, biar pembeli gampang follow up tanpa nyari-nyari kontak.
    let waCta = "";
    const isPaid = data.status === "paid" || data.status === "sukses";
    const configuredWhatsApp = cachedStoreSettings?.contact_whatsapp || document.getElementById("footerWaLink")?.href || "";
    if (data.type === "order" && isPaid && configuredWhatsApp) {
        const waDigits = configuredWhatsApp.replace(/\D/g, "");
        const prefill = `Halo admin, saya sudah bayar pesanan dengan No. Transaksi ${data.id}. Saya akan melampirkan bukti pembayaran iPaymu di chat ini. Mohon diproses ya 🙏`;
        const waHref = `https://wa.me/${waDigits}?text=${encodeURIComponent(prefill)}`;
        waCta = `
            <div class="track-wa-cta">
                <p class="otp-info">🎮 Pembayaran sudah terverifikasi. Produk game ini diproses manual oleh admin. ${fromPaymentReturn ? "Klik tombol di bawah lalu lampirkan screenshot/bukti pembayaran iPaymu di chat." : `Sertakan <strong>No. Transaksi ${escapeHtml(data.id)}</strong> saat chat admin.`}</p>
                <a href="${waHref}" target="_blank" rel="noopener" class="btn-primary track-wa-btn"><i class="fa-brands fa-whatsapp" aria-hidden="true"></i> Chat Admin via WhatsApp</a>
            </div>
        `;
    }

    document.getElementById("trackResult").innerHTML = `
        <div class="track-status-badge ${cls}">${escapeHtml(label)}</div>
        <div class="row"><span>Order ID</span><span>${escapeHtml(data.id)}</span></div>
        <div class="row"><span>Tanggal</span><span>${tanggal}</span></div>
        ${itemsHtml}
        <div class="row total"><span>Total</span><span>${rupiah(data.total || 0)}</span></div>
        ${waCta}
    `;
    document.getElementById("trackResult").classList.remove("hidden");
}

document.getElementById("trackForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById("trackError");
    const resultEl = document.getElementById("trackResult");
    const btn = document.getElementById("trackSubmitBtn");
    const orderId = document.getElementById("trackOrderId").value.trim();

    errorEl.textContent = "";
    resultEl.classList.add("hidden");
    if (!orderId) return;

    const isTopup = orderId.toUpperCase().startsWith("TP");
    const endpoint = isTopup ? `${API_BASE}/topup/track/${encodeURIComponent(orderId)}` : `${API_BASE}/orders/track/${encodeURIComponent(orderId)}`;

    btn.disabled = true;
    btn.textContent = "Mengecek...";
    try {
        const res = await fetch(endpoint);
        const data = await res.json();
        if (!res.ok) {
            errorEl.textContent = data.message || "Transaksi tidak ditemukan. Periksa kembali Order ID kamu.";
            return;
        }
        renderTrackResult(data);
    } catch (err) {
        errorEl.textContent = "Gagal menghubungi server. Coba lagi sebentar.";
    } finally {
        btn.disabled = false;
        btn.textContent = "Cek Transaksi";
    }
});

function openTrackModal(tab) {
    document.getElementById("trackForm").reset();
    document.getElementById("trackError").textContent = "";
    document.getElementById("trackResult").classList.add("hidden");
    switchTrackTab(tab || "byid");
    openOverlay("trackOverlay");
}
document.getElementById("trackOrderBtn").addEventListener("click", () => openTrackModal("byid"));
document.getElementById("trackOrderBtnFooter").addEventListener("click", () => openTrackModal("byid"));

function switchTrackTab(tab) {
    document.querySelectorAll("[data-track-tab]").forEach(t => {
        t.classList.toggle("active", t.dataset.trackTab === tab);
    });
    document.querySelectorAll("[data-track-panel]").forEach(p => {
        p.classList.toggle("hidden", p.dataset.trackPanel !== tab);
    });
    document.getElementById("trackForm").classList.toggle("hidden", tab !== "byid");
    document.getElementById("trackResult").classList.toggle("hidden", tab !== "byid");
    if (tab === "mine") loadMyTransactions();
}
document.querySelectorAll("[data-track-tab]").forEach(btn => {
    btn.addEventListener("click", () => switchTrackTab(btn.dataset.trackTab));
});

async function loadMyTransactions() {
    const body = document.getElementById("trackMineBody");

    if (!currentUser) {
        body.innerHTML = `
            <p class="otp-info">Login dulu buat lihat riwayat transaksi kamu.</p>
            <button type="button" class="btn-primary" id="trackMineLoginBtn">Login / Daftar</button>
        `;
        document.getElementById("trackMineLoginBtn").addEventListener("click", () => {
            closeOverlay("trackOverlay");
            openOverlay("authOverlay");
        });
        return;
    }

    body.innerHTML = `<p class="otp-info">Memuat riwayat transaksi...</p>`;
    const token = localStorage.getItem("nexshop_token");

    try {
        const [ordersRes, topupRes] = await Promise.all([
            fetch(`${API_BASE}/orders/my`, { headers: { "Authorization": `Bearer ${token}` } }),
            fetch(`${API_BASE}/topup/my`, { headers: { "Authorization": `Bearer ${token}` } })
        ]);
        const orders = ordersRes.ok ? await ordersRes.json() : [];
        const topups = topupRes.ok ? await topupRes.json() : [];

        const merged = [
            ...(Array.isArray(orders) ? orders : []).map(o => ({
                id: o.id, type: "order", status: o.status, total: o.total, created_at: o.created_at
            })),
            ...(Array.isArray(topups) ? topups : []).map(t => ({
                id: t.id, type: "topup", status: t.status, total: t.harga,
                label: t.nama_produk, created_at: t.created_at
            }))
        ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        if (merged.length === 0) {
            body.innerHTML = `<p class="otp-info">Belum ada transaksi tercatat.</p>`;
            return;
        }

        body.innerHTML = `<div class="track-mine-list">${merged.map(t => {
            const label = STATUS_LABEL[t.status] || t.status;
            const cls = STATUS_CLASS[t.status] || "info";
            const tanggal = t.created_at ? new Date(t.created_at).toLocaleDateString("id-ID") : "-";
            return `
                <button type="button" class="track-mine-item" data-order-id="${escapeHtml(t.id)}">
                    <div>
                        <div class="track-mine-id">${escapeHtml(t.id)}</div>
                        <div class="track-mine-sub">${escapeHtml(t.label || (t.type === "topup" ? "Topup" : "Pesanan Produk"))} · ${tanggal}</div>
                    </div>
                    <div class="track-mine-right">
                        <span class="track-status-badge ${cls}">${escapeHtml(label)}</span>
                        <span class="track-mine-total">${rupiah(t.total || 0)}</span>
                    </div>
                </button>
            `;
        }).join("")}</div>`;

        body.querySelectorAll(".track-mine-item").forEach(item => {
            item.addEventListener("click", () => {
                document.getElementById("trackOrderId").value = item.dataset.orderId;
                switchTrackTab("byid");
                document.getElementById("trackForm").requestSubmit();
            });
        });
    } catch (err) {
        body.innerHTML = `<p class="auth-error">Gagal memuat riwayat transaksi. Coba lagi sebentar.</p>`;
    }
}

/* ---------- Mobile menu ---------- */
const menuToggle = document.getElementById("menuToggle");
const navMenu = document.getElementById("navMenu");
menuToggle.addEventListener("click", () => {
    const isOpen = navMenu.classList.toggle("active");
    menuToggle.setAttribute("aria-expanded", isOpen);
});
navMenu.querySelectorAll("a, .menu-link-btn").forEach(link => {
    link.addEventListener("click", () => navMenu.classList.remove("active"));
});
// Close mobile menu when clicking outside
document.addEventListener('click', (e) => {
    if (!navMenu.contains(e.target) && !menuToggle.contains(e.target)) {
        navMenu.classList.remove('active');
        menuToggle.setAttribute('aria-expanded', 'false');
    }
});

/* ---------- Promo/berita carousel ---------- */
let heroSlides = [];
let heroIndex = 0;
let heroTimer = null;

async function loadPromo() {
    try {
        const res = await fetch(`${API_BASE}/promo`);
        if (!res.ok) return;
        const slides = await res.json();
        if (!Array.isArray(slides) || slides.length === 0) return;

        heroSlides = slides;
        renderHeroSlides();
        startHeroAutoplay();
    } catch (err) {
        // diem aja, biarin section hero kosong kalau API gagal
    }
}

const heroMobileQuery = window.matchMedia("(max-width: 860px)");

function heroImageFor(slide) {
    if (heroMobileQuery.matches && slide.mobile_image_url) return slide.mobile_image_url;
    return slide.image_url;
}

function renderHeroSlides() {
    const track = document.getElementById("heroTrack");
    const dotsWrap = document.getElementById("heroDots");

    track.innerHTML = heroSlides.map(s => `
        <div class="hero-slide${s.full_image ? " full-image" : ""}" style="${heroImageFor(s) ? `background-image:url('${heroImageFor(s)}')` : ""}">
            ${s.full_image ? (s.cta_link ? `<a href="${s.cta_link}" class="hero-slide-link" aria-label="${escapeHtml(s.title || "Promo")}"></a>` : "") : `
            <div class="hero-text">
                ${s.badge_text ? `<span class="hero-badge">${escapeHtml(s.badge_text)}</span>` : ""}
                <h2>${escapeHtml(s.title || "")}</h2>
                ${s.description ? `<p>${escapeHtml(s.description)}</p>` : ""}
                ${s.cta_text ? `<a href="${s.cta_link || "#"}" class="hero-cta">${escapeHtml(s.cta_text)}</a>` : ""}
            </div>
            `}
        </div>
    `).join("");

    dotsWrap.innerHTML = heroSlides.map((_, i) =>
        `<button class="hero-dot${i === 0 ? " active" : ""}" data-index="${i}" aria-label="Slide ${i + 1}"></button>`
    ).join("");

    dotsWrap.querySelectorAll(".hero-dot").forEach(dot => {
        dot.addEventListener("click", () => {
            goToHeroSlide(Number(dot.dataset.index));
            resetHeroAutoplay();
        });
    });

    heroIndex = 0;
    goToHeroSlide(0);

    // sembunyiin panah/dots kalau cuma 1 slide, gak ada gunanya
    const onlyOne = heroSlides.length <= 1;
    document.getElementById("heroPrev").classList.toggle("hidden", onlyOne);
    document.getElementById("heroNext").classList.toggle("hidden", onlyOne);
    dotsWrap.classList.toggle("hidden", onlyOne);
}

function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
}

function goToHeroSlide(index) {
    heroIndex = (index + heroSlides.length) % heroSlides.length;
    document.getElementById("heroTrack").style.transform = `translateX(-${heroIndex * 100}%)`;
    document.querySelectorAll(".hero-dot").forEach((dot, i) => {
        dot.classList.toggle("active", i === heroIndex);
    });
}

function startHeroAutoplay() {
    if (heroSlides.length <= 1) return;
    clearInterval(heroTimer);
    heroTimer = setInterval(() => goToHeroSlide(heroIndex + 1), 5000);
}

// Kalau device diputar (atau browser di-resize) sampe lewatin breakpoint
// mobile/desktop, render ulang biar gambar banner-nya ikut ganti ke versi
// yang sesuai (mobile_image_url vs image_url).
heroMobileQuery.addEventListener("change", () => {
    if (heroSlides.length) renderHeroSlides();
});

function resetHeroAutoplay() {
    clearInterval(heroTimer);
    startHeroAutoplay();
}

document.getElementById("heroPrev").addEventListener("click", () => {
    goToHeroSlide(heroIndex - 1);
    resetHeroAutoplay();
});
document.getElementById("heroNext").addEventListener("click", () => {
    goToHeroSlide(heroIndex + 1);
    resetHeroAutoplay();
});

/* ---------- Store settings (nama toko, logo, kontak) ---------- */
function parseContactEmails(value) {
    return (String(value || "")
        .match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [])
        .map(email => email.trim())
        .filter(email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        .filter((email, index, emails) => emails.indexOf(email) === index)
        .slice(0, 2);
}

function updateContactEmailLinks(value) {
    const emails = parseContactEmails(value);
    const footerContact = document.querySelector(".footer-contact");
    footerContact?.classList.toggle("has-secondary-email", emails.length > 1);
    const targets = [
        {
            footerLink: document.getElementById("footerEmailLink"),
            footerLabel: document.getElementById("footerEmailLabel"),
            contactItem: document.getElementById("contactEmailItem"),
            contactLink: document.getElementById("contactEmailLink")
        },
        {
            footerLink: document.getElementById("footerEmailLinkSecondary"),
            footerLabel: document.getElementById("footerEmailLabelSecondary"),
            contactItem: document.getElementById("contactEmailItemSecondary"),
            contactLink: document.getElementById("contactEmailLinkSecondary")
        }
    ];

    targets.forEach((target, index) => {
        const email = emails[index];
        if (!email) {
            target.footerLink?.classList.toggle("hidden", index !== 0);
            target.contactItem?.classList.toggle("hidden", index !== 0);
            return;
        }

        const mailto = `mailto:${email}`;
        target.footerLink?.classList.remove("hidden");
        target.contactItem?.classList.remove("hidden");
        if (target.footerLink) target.footerLink.href = mailto;
        if (target.footerLabel) target.footerLabel.textContent = email;
        if (target.contactLink) {
            target.contactLink.href = mailto;
            target.contactLink.textContent = email;
        }
    });
}

async function loadStoreSettings() {
    try {
        const res = await fetch(`${API_BASE}/settings/store`);
        if (!res.ok) return;
        const s = await res.json();
        cachedStoreSettings = s;

        if (s.store_name) {
            document.title = `${s.store_name} — Digital Gaming Marketplace`;
            const brandEl = document.getElementById("storeNameText");
            // pertahankan style "Nex<span>Shop</span>" kalau nama masih default,
            // kalau admin ganti nama toko, tampilkan apa adanya
            if (s.store_name.toLowerCase() !== "nexshop") {
                brandEl.textContent = s.store_name;
            }
            document.getElementById("footerBrand").textContent = s.store_name;
        }
        if (s.tagline) {
            document.getElementById("storeTagline").textContent = s.tagline;
        }
        if (s.logo_url) {
            document.getElementById("storeLogoImg").src = s.logo_url;
        }
        if (s.contact_whatsapp) {
            const waLink = document.getElementById("footerWaLink");
            waLink.href = `https://wa.me/${s.contact_whatsapp.replace(/\D/g, "")}`;
            const waLabel = document.getElementById("footerWaLabel");
            if (waLabel) waLabel.textContent = s.contact_phone || s.contact_whatsapp;
            const contactWa = document.getElementById("contactWaLink");
            if (contactWa) {
                contactWa.href = waLink.href;
                contactWa.textContent = s.contact_phone || s.contact_whatsapp;
            }
        }
        if (s.contact_email) updateContactEmailLinks(s.contact_email);
        if (s.address) {
            const footerAddress = document.getElementById("footerAddress");
            footerAddress.replaceChildren();
            const addressIcon = document.createElement("i");
            addressIcon.className = "fa-solid fa-location-dot";
            addressIcon.setAttribute("aria-hidden", "true");
            footerAddress.append(addressIcon, document.createTextNode(` ${s.address}`));
            const contactAddress = document.getElementById("contactAddress");
            if (contactAddress) contactAddress.textContent = s.address;
        }
        // toggle trust bar sesuai Settings admin (default tampil kalau belum pernah diatur)
        const trustBar = document.getElementById("trustBar");
        if (trustBar) trustBar.classList.toggle("hidden", s.trust_bar_enabled === false);
        if (Array.isArray(s.faq) && s.faq.length > 0) {
            renderFaqList(s.faq);
        }
        if (s.terms_content) {
            document.getElementById("termsContent").innerHTML = formatPolicyText(s.terms_content);
        }
        if (s.refund_content) {
            document.getElementById("refundContent").innerHTML = formatPolicyText(s.refund_content);
        }
    } catch (err) {
        // diem aja, biarin brand default kalau API gagal
    }
}

function renderFaqList(faq) {
    const list = document.getElementById("faqList");
    if (!list) return;
    if (!faq.length) {
        list.innerHTML = `<p class="faq-empty">Belum ada FAQ.</p>`;
        return;
    }
    list.innerHTML = faq.map(item => `
        <details class="faq-item">
            <summary>${escapeHtml(item.q || "")}</summary>
            <p>${escapeHtml(item.a || "")}</p>
        </details>
    `).join("");
}

// Konten Syarat & Ketentuan / Refund dari admin disimpan sebagai teks polos
// (satu poin per baris) — di sini diubah jadi list <li>, sederhana & aman
// dari HTML injection karena tetap di-escape.
function formatPolicyText(text) {
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
    if (!lines.length) return "";
    return `<ol class="policy-list">${lines.map(l => `<li>${escapeHtml(l)}</li>`).join("")}</ol>`;
}

/* ---------- Topup Diamond: Game Grid -> 3-Step Detail Wizard ---------- */
// Alur baru: (1) grid game -> (2) halaman detail game (bukan modal) dengan
// step Akun & Nominal -> Pembayaran -> Ringkasan. Semua data (produk, logo
// game, kategori) tetap dari /api/topup/products (admin dashboard), TIDAK
// ada yang di-hardcode. Endpoint & kontrak API tidak berubah sama sekali
// dari implementasi lama (check-nickname, create order) supaya checkout,
// iPaymu, dan backend tetap jalan seperti sebelumnya.
let TOPUP_PRODUCTS = [];
let TOPUP_GAMES = [];

let twState = {
    kategori: null,
    step: 1,
    products: [],
    needsServerId: false,
    userId: "",
    serverId: "",
    email: "",
    nickname: null,
    nicknameSupported: false,
    product: null,
    payment: null,
    promo: null // { code, discount } -- diisi kalau kode promo berhasil diterapkan di step Ringkasan
};

async function loadTopupProducts() {
    renderTopupGameSkeleton();
    try {
        const res = await fetch(`${API_BASE}/topup/products`);
        if (!res.ok) { renderTopupGameGrid(); return; }
        TOPUP_PRODUCTS = await res.json();
        buildTopupGames();
        renderTopupGameGrid();
    } catch (err) {
        // biarin grid kosong kalau API gagal
        renderTopupGameGrid();
    }
}

// Kelompokkan produk topup per kategori (= 1 game/kartu di grid). Logo game
// diambil dari operator_logo yang diatur admin lewat Admin Dashboard.
function buildTopupGames() {
    const map = new Map();
    TOPUP_PRODUCTS.forEach(p => {
        const key = p.kategori || "Lainnya";
        if (!map.has(key)) map.set(key, { kategori: key, logo: p.operator_logo || null, products: [] });
        const g = map.get(key);
        g.products.push(p);
        if (!g.logo && p.operator_logo) g.logo = p.operator_logo;
    });
    TOPUP_GAMES = [...map.values()].sort((a, b) => a.kategori.localeCompare(b.kategori));
}

function renderTopupGameSkeleton() {
    const grid = document.getElementById("topupGameGrid");
    grid.innerHTML = Array.from({ length: 6 }).map(() => `
        <div class="topup-game-card skeleton" aria-hidden="true">
            <div class="tgc-logo skel-block"></div>
            <div class="skel-line" style="width:70%"></div>
            <div class="skel-line" style="width:40%"></div>
        </div>
    `).join("");
}

function renderTopupGameGrid() {
    const grid = document.getElementById("topupGameGrid");
    if (!TOPUP_GAMES.length) {
        grid.innerHTML = `<div class="topup-empty">Belum ada game topup tersedia saat ini.</div>`;
        return;
    }

    grid.innerHTML = TOPUP_GAMES.map(g => `
        <div class="topup-game-card" data-kategori="${escapeHtml(g.kategori)}" tabindex="0" role="button">
            <div class="tgc-logo">
                ${g.logo ? `<img src="${g.logo}" alt="${escapeHtml(g.kategori)}" loading="lazy">` : `<span class="diamond-icon"><i class="fa-solid fa-gem" aria-hidden="true"></i></span>`}
            </div>
            <h5>${escapeHtml(g.kategori)}</h5>
            <span class="tgc-count">${g.products.length} produk</span>
        </div>
    `).join("");

    grid.querySelectorAll(".topup-game-card").forEach(card => {
        card.addEventListener("click", () => openGameDetail(card.dataset.kategori));
        card.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openGameDetail(card.dataset.kategori); }
        });
    });
}

/* ---- Halaman Detail Game (bukan modal) ---- */

function openGameDetail(kategori) {
    const game = TOPUP_GAMES.find(g => g.kategori === kategori);
    if (!game) return;

    twState = {
        kategori: game.kategori,
        step: 1,
        products: game.products,
        needsServerId: game.products.some(p => p.butuh_server_id),
        userId: "",
        serverId: "",
        email: currentUser ? currentUser.email : "",
        nickname: null,
        nicknameSupported: false,
        product: null,
        payment: null,
        promo: null
    };

    document.getElementById("twLogo").src = game.logo || "images/nexshop-icon.svg";
    document.getElementById("twLogo").alt = game.kategori;
    document.getElementById("twGameName").textContent = game.kategori;
    document.getElementById("twGameDesc").textContent = `Topup ${game.kategori} resmi & instan, diproses otomatis 24 jam.`;
    document.getElementById("twBanner").style.backgroundImage = game.logo ? `url(${game.logo})` : "none";

    document.getElementById("twUserId").value = "";
    document.getElementById("twServerId").value = "";
    document.getElementById("twEmail").value = twState.email;
    document.getElementById("twServerWrap").classList.toggle("hidden", !twState.needsServerId);
    document.getElementById("twAccountResult").className = "tw-account-result hidden";
    document.getElementById("twAccountResult").innerHTML = "";
    document.getElementById("twStep1Error").textContent = "";

    renderTopupProductGrid();
    renderTopupPaymentGrid();
    goToTwStep(1);

    document.getElementById("topup").classList.add("hidden");
    document.getElementById("topupDetail").classList.remove("hidden");
    window.scrollTo({ top: document.getElementById("topupDetail").offsetTop - 90, behavior: "smooth" });
}

function closeGameDetail() {
    document.getElementById("topupDetail").classList.add("hidden");
    document.getElementById("topup").classList.remove("hidden");
    document.getElementById("topup").scrollIntoView({ behavior: "smooth", block: "start" });
}
document.getElementById("twBackBtn").addEventListener("click", closeGameDetail);

const TW_STEP_LABELS = { 1: "Lanjut", 2: "Lanjut", 3: "Bayar Sekarang" };

function goToTwStep(step) {
    twState.step = step;
    document.querySelectorAll(".tw-panel").forEach(p => {
        p.classList.toggle("hidden", Number(p.dataset.panel) !== step);
    });
    document.querySelectorAll(".tw-step-dot").forEach(dot => {
        const s = Number(dot.dataset.step);
        dot.classList.toggle("active", s === step);
        dot.classList.toggle("done", s < step);
    });
    document.getElementById("twPrevBtn").classList.toggle("hidden", step === 1);
    const nextBtn = document.getElementById("twNextBtn");
    nextBtn.disabled = false;
    nextBtn.textContent = TW_STEP_LABELS[step];
    if (step === 3) {
        twState.promo = null;
        document.getElementById("twPromoCodeInput").value = "";
        document.getElementById("twPromoCodeMsg").textContent = "";
        document.getElementById("twPromoCodeMsg").className = "promo-code-msg";
        renderTwSummary();
    }
}

document.getElementById("twPrevBtn").addEventListener("click", () => {
    if (twState.step > 1) goToTwStep(twState.step - 1);
});

document.getElementById("twNextBtn").addEventListener("click", async () => {
    if (twState.step === 1) {
        const userId = document.getElementById("twUserId").value.trim();
        const serverId = document.getElementById("twServerId").value.trim();
        const email = document.getElementById("twEmail").value.trim();
        const errorEl = document.getElementById("twStep1Error");
        errorEl.textContent = "";

        if (!userId) { errorEl.textContent = "User ID wajib diisi"; return; }
        if (twState.needsServerId && !serverId) { errorEl.textContent = "Server ID wajib diisi untuk game ini"; return; }
        if (!email || !email.includes("@")) { errorEl.textContent = "Email wajib diisi dengan format yang benar"; return; }
        if (!twState.product) { errorEl.textContent = "Pilih nominal top up dulu ya"; return; }

        twState.userId = userId;
        twState.serverId = serverId;
        twState.email = email;
        goToTwStep(2);
        return;
    }
    if (twState.step === 2) {
        if (!twState.payment) {
            toast("Pilih metode pembayaran dulu ya.", "error");
            return;
        }
        goToTwStep(3);
        return;
    }
    if (twState.step === 3) {
        await submitTopupOrder();
    }
});

/* ---- Step 1: Cek Akun (ApiGames, kalau didukung) ---- */
document.getElementById("twCheckBtn").addEventListener("click", async () => {
    const userId = document.getElementById("twUserId").value.trim();
    const serverId = document.getElementById("twServerId").value.trim();
    const resultEl = document.getElementById("twAccountResult");
    const errorEl = document.getElementById("twStep1Error");
    errorEl.textContent = "";

    if (!userId) { errorEl.textContent = "Masukkan User ID dulu sebelum cek akun"; return; }
    if (twState.needsServerId && !serverId) { errorEl.textContent = "Masukkan Server ID dulu sebelum cek akun"; return; }

    const btn = document.getElementById("twCheckBtn");
    btn.disabled = true;
    btn.textContent = "Mengecek...";

    try {
        const res = await fetch(`${API_BASE}/topup/check-nickname`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kategori: twState.kategori, tujuan: userId, serverId: serverId || undefined })
        });
        const data = await res.json();
        resultEl.classList.remove("hidden");

        if (data.supported) {
            twState.nicknameSupported = true;
            if (data.is_valid) {
                twState.nickname = data.username || "";
                resultEl.className = "tw-account-result valid";
                resultEl.innerHTML = `<span class="tw-check-icon"><i class="fa-solid fa-check" aria-hidden="true"></i></span> Akun ditemukan: <strong>${escapeHtml(data.username || "-")}</strong>`;
            } else {
                twState.nickname = null;
                resultEl.className = "tw-account-result invalid";
                resultEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> User ID${twState.needsServerId ? "/Server ID" : ""} tidak ditemukan. Periksa kembali sebelum melanjutkan.`;
            }
        } else {
            twState.nicknameSupported = false;
            twState.nickname = null;
            resultEl.className = "tw-account-result warning";
            resultEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Cek otomatis belum tersedia untuk game ini. Pastikan User ID${twState.needsServerId ? "/Server ID" : ""} sudah benar sebelum lanjut.`;
        }
    } catch (err) {
        resultEl.classList.remove("hidden");
        resultEl.className = "tw-account-result warning";
        resultEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Gagal menghubungi server cek akun. Pastikan data yang kamu masukkan sudah benar.`;
    } finally {
        btn.disabled = false;
        btn.textContent = "🔍 Cek Akun";
    }
});

/* ---- Step 2: Pilih Nominal (hanya produk milik game ini) ---- */
// Deteksi sub-grup dari nama produk, buat pengelompokan visual DI DALAM satu
// halaman game (bukan kategori/kartu game terpisah) — WDP & Twilight Pass
// ditaruh sebagai section sendiri di atas, baru produk diamond biasa di bawah.
const TW_PRODUCT_GROUPS = [
    { key: "wdp", label: "Weekly Diamond Pass", match: /weekly\s*diamond\s*pass|\bwdp\b/i },
    { key: "twilight", label: "Twilight Pass", match: /twilight\s*pass/i },
    { key: "regular", label: "Diamond", match: null } // fallback, semua yang gak cocok pattern di atas
];

function groupTwProducts(products) {
    const buckets = { wdp: [], twilight: [], regular: [] };
    products.forEach((p) => {
        const found = TW_PRODUCT_GROUPS.find((g) => g.match && g.match.test(p.nama || ""));
        buckets[found ? found.key : "regular"].push(p);
    });
    return buckets;
}

function renderTwProductCard(p) {
    return `
        <div class="tw-product-card ${twState.product && twState.product.kode_produk === p.kode_produk ? "selected" : ""}" data-kode="${p.kode_produk}">
            ${p.item_icon ? `<img class="tw-product-icon" src="${p.item_icon}" alt="${escapeHtml(p.nama)}" loading="lazy">` : `<span class="diamond-icon"><i class="fa-solid fa-gem" aria-hidden="true"></i></span>`}
            <h5>${escapeHtml(p.nama)}</h5>
            <div class="tw-product-price">${rupiah(p.harga_jual)}</div>
            <span class="tw-product-check"><i class="fa-solid fa-check" aria-hidden="true"></i></span>
        </div>
    `;
}

function renderTopupProductGrid() {
    const grid = document.getElementById("twProductGrid");
    if (!twState.products.length) {
        grid.innerHTML = `<div class="topup-empty">Belum ada produk untuk game ini.</div>`;
        return;
    }

    const buckets = groupTwProducts(twState.products);
    // section cuma muncul kalau isinya lebih dari 1 grup (mis. game tanpa WDP/Twilight
    // tetap tampil rata sebagai satu grid polos, gak perlu header "Diamond" sendirian)
    const activeGroupCount = TW_PRODUCT_GROUPS.filter((g) => buckets[g.key].length > 0).length;

    grid.innerHTML = TW_PRODUCT_GROUPS.map((g) => {
        const items = buckets[g.key];
        if (!items.length) return "";
        const heading = activeGroupCount > 1 ? `<h5 class="tw-product-group-heading">${g.label}</h5>` : "";
        return `<div class="tw-product-group">${heading}<div class="tw-product-group-grid">${items.map(renderTwProductCard).join("")}</div></div>`;
    }).join("");

    grid.querySelectorAll(".tw-product-card").forEach(card => {
        card.addEventListener("click", () => {
            twState.product = twState.products.find(x => x.kode_produk === card.dataset.kode);
            renderTopupProductGrid();
        });
    });
}

function renderTopupPaymentGrid() {
    const grid = document.getElementById("twPaymentGrid");
    if (!grid) return;

    grid.innerHTML = PAYMENT_METHODS.map((method) => `
        <button type="button" class="tw-payment-card ${twState.payment === method.id ? "selected" : ""}" data-payment-method="${method.id}">
            <span class="tw-payment-icon tw-payment-icon--${method.id}" aria-hidden="true"><i class="fa-solid ${method.icon}"></i></span>
            <span>
                <h5>${method.label}</h5>
                <p>${method.desc}</p>
            </span>
            <span class="tw-payment-check" aria-hidden="true"><i class="fa-solid fa-check"></i></span>
        </button>
    `).join("");

    grid.querySelectorAll("[data-payment-method]").forEach((card) => {
        card.addEventListener("click", () => {
            twState.payment = card.dataset.paymentMethod;
            renderTopupPaymentGrid();
        });
    });
}

/* ---- Promo top-up ---- */
document.getElementById("twApplyPromoBtn").addEventListener("click", async () => {
    const code = document.getElementById("twPromoCodeInput").value.trim();
    const msgEl = document.getElementById("twPromoCodeMsg");

    if (!code) {
        msgEl.textContent = "Masukkan kode promo dulu";
        msgEl.className = "promo-code-msg error";
        return;
    }
    if (!twState.product) {
        msgEl.textContent = "Produk belum dipilih";
        msgEl.className = "promo-code-msg error";
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/topup/validate-promo`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code, kode_produk: twState.product.kode_produk, email: twState.email || undefined })
        });
        const data = await res.json();

        if (!res.ok || !data.valid) {
            twState.promo = null;
            msgEl.textContent = data.message || "Kode promo tidak valid";
            msgEl.className = "promo-code-msg error";
            renderTwSummary();
            return;
        }

        twState.promo = { code: data.code, discount: data.discount };
        msgEl.textContent = `Kode "${data.code}" berhasil diterapkan! Hemat ${rupiah(data.discount)}`;
        msgEl.className = "promo-code-msg success";
        renderTwSummary();
    } catch (err) {
        msgEl.textContent = "Gagal menghubungi server";
        msgEl.className = "promo-code-msg error";
    }
});

/* ---- Ringkasan Pesanan ---- */
function renderTwSummary() {
    const el = document.getElementById("twSummary");
    const p = twState.product;
    const paymentLabel = (PAYMENT_METHODS.find((method) => method.id === twState.payment) || {}).label || "-";
    const subtotal = p ? p.harga_jual : 0;
    const discount = twState.promo ? twState.promo.discount : 0;
    const total = Math.max(subtotal - discount, 0);

    el.innerHTML = `
        <div class="tw-summary-row"><span>Game</span><strong>${escapeHtml(twState.kategori)}</strong></div>
        ${twState.nicknameSupported && twState.nickname ? `<div class="tw-summary-row"><span>Nickname</span><strong>${escapeHtml(twState.nickname)}</strong></div>` : ""}
        <div class="tw-summary-row"><span>User ID</span><strong>${escapeHtml(twState.userId)}${twState.serverId ? " (" + escapeHtml(twState.serverId) + ")" : ""}</strong></div>
        <div class="tw-summary-row"><span>Produk</span><strong>${escapeHtml(p ? p.nama : "-")}</strong></div>
        <div class="tw-summary-row"><span>Harga</span><strong>${rupiah(subtotal)}</strong></div>
        ${twState.promo ? `<div class="tw-summary-row"><span>Diskon (${escapeHtml(twState.promo.code)})</span><strong>-${rupiah(discount)}</strong></div>` : ""}
        <div class="tw-summary-row"><span>Metode Pembayaran</span><strong>${escapeHtml(paymentLabel)}</strong></div>
        <div class="tw-summary-row"><span>Total Bayar</span><strong>${rupiah(total)}</strong></div>
    `;
    document.getElementById("twConfirmCheck").checked = false;
    document.getElementById("twStep3Error").textContent = "";
}

// Submit topup lalu buka iPaymu dengan kanal yang sudah dipilih user di web.
async function submitTopupOrder() {
    const errorEl = document.getElementById("twStep3Error");
    const btn = document.getElementById("twNextBtn");
    const checkEl = document.getElementById("twConfirmCheck");

    if (!checkEl.checked) {
        errorEl.textContent = "Centang dulu konfirmasi kalau seluruh data sudah benar";
        return;
    }
    errorEl.textContent = "";
    btn.disabled = true;
    btn.textContent = "Memproses...";

    try {
        const token = localStorage.getItem("nexshop_token");
        const headers = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const res = await fetch(`${API_BASE}/topup`, {
            method: "POST",
            headers,
            body: JSON.stringify({
                kode_produk: twState.product.kode_produk,
                tujuan: twState.userId,
                server_id: twState.serverId || undefined,
                recipient_email: twState.email,
                promo_code: twState.promo ? twState.promo.code : undefined,
                payment_method: twState.payment
            })
        });
        const data = await res.json();

        if (!res.ok) {
            errorEl.textContent = data.message || "Gagal membuat pesanan topup";
            btn.disabled = false;
            btn.textContent = "Bayar Sekarang";
            return;
        }

        if (!data.paymentUrl) {
            toast("URL pembayaran tidak ditemukan dari server.", "error");
            btn.disabled = false;
            btn.textContent = "Bayar Sekarang";
            return;
        }

        window.location.href = data.paymentUrl;
    } catch (err) {
        errorEl.textContent = "Gagal terhubung ke server.";
        btn.disabled = false;
        btn.textContent = "Bayar Sekarang";
    }
}

/* ---------- Show/hide password ---------- */
document.querySelectorAll(".toggle-password").forEach(btn => {
    btn.addEventListener("click", () => {
        const input = document.getElementById(btn.dataset.target);
        const showing = input.type === "text";
        input.type = showing ? "password" : "text";
        btn.classList.toggle("showing", !showing);
        const icon = btn.querySelector("i");
        if (icon) icon.className = `fa-solid ${showing ? "fa-eye" : "fa-eye-slash"}`;
        btn.setAttribute("aria-label", showing ? "Tampilkan password" : "Sembunyikan password");
    });
});

/* ---------- Halaman kembali dari pembayaran iPaymu (returnUrl) ---------- */
function openTrackModalWithResult(data, options = {}) {
    // buka modal "Cek Transaksi" tapi langsung tampilin hasilnya, gak perlu
    // user ngetik ulang Order ID yang baru aja mereka bayar
    switchTrackTab("byid");
    document.getElementById("trackError").textContent = "";
    document.getElementById("trackForm").classList.add("hidden");
    renderTrackResult(data, options);
    openOverlay("trackOverlay");
}

async function checkPaymentReturn() {
    const hash = window.location.hash || "";
    if (!hash.startsWith("#/payment-status")) return;

    const query = new URLSearchParams(hash.split("?")[1] || "");
    const orderId = query.get("order");
    if (!orderId) return;

    const isTopup = orderId.toUpperCase().startsWith("TP");
    // pakai endpoint /track/ (detail lengkap, sama kayak "Cek Transaksi") biar
    // bisa langsung dirender pakai renderTrackResult() yang udah ada,
    // termasuk tombol WA buat pesanan produk yang statusnya "paid"
    const endpoint = isTopup
        ? `${API_BASE}/topup/track/${encodeURIComponent(orderId)}`
        : `${API_BASE}/orders/track/${encodeURIComponent(orderId)}`;

    try {
        const shouldWaitForWebhook = query.get("status") === "success";
        const maxAttempts = shouldWaitForWebhook ? 6 : 1;
        let data = null;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const res = await fetch(endpoint);
            data = await res.json();
            if (!res.ok) {
                toast(`Order ${orderId}: status belum bisa dicek. Simpan Order ID ini untuk cek manual ke admin.`);
                return;
            }
            if (data.status !== "pending" || attempt === maxAttempts - 1) break;
            await new Promise((resolve) => setTimeout(resolve, 1200));
        }

        // jaga-jaga: loadStoreSettings() (buat contact_whatsapp) jalan bareng
        // fungsi ini pas page load, jadi bisa aja belum selesai duluan —
        // pastiin dulu biar tombol WA gak ketinggalan render
        if (!cachedStoreSettings) {
            try {
                const settingsRes = await fetch(`${API_BASE}/settings/store`);
                if (settingsRes.ok) cachedStoreSettings = await settingsRes.json();
            } catch (e) { /* gak fatal, CTA WA cuma gak muncul kalau ini gagal */ }
        }

        openTrackModalWithResult(data, { fromPaymentReturn: true });
    } catch (err) {
        toast(`Order ${orderId} sudah dibuat — catat Order ID ini untuk cek status ke admin.`);
    }

    // bersihkan hash biar gak dicek ulang kalau user reload halaman
    history.replaceState(null, "", window.location.pathname + window.location.search);
}

/* ---------- Trust bar (stat publik + badge kepercayaan) ---------- */
function animateTrustCounter(el, target) {
    const duration = 900;
    const start = performance.now();
    function tick(now) {
        const progress = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3); // ease-out
        el.textContent = Math.round(target * eased).toLocaleString("id-ID");
        if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
}

async function loadTrustStats() {
    const ordersEl = document.getElementById("trustTotalOrders");
    const gamesEl = document.getElementById("trustTotalGames");
    if (!ordersEl || !gamesEl) return;

    try {
        const res = await fetch(`${API_BASE}/stats/public`);
        if (!res.ok) throw new Error("Gagal memuat statistik");
        const data = await res.json();

        animateTrustCounter(ordersEl, Number(data.total_transaksi_sukses || 0));
        animateTrustCounter(gamesEl, Number(data.total_game || 0));
    } catch (err) {
        // trust bar bukan fitur krusial — kalau gagal, biarin tampil "-" aja, gak ganggu belanja
        ordersEl.textContent = "-";
        gamesEl.textContent = "-";
    }
}

/* ---------- Init ---------- */
function initSearchListeners() {
    const searchInput = document.getElementById("searchProductInput");
    const searchClearBtn = document.getElementById("searchClearBtn");

    if (searchInput) {
        searchInput.addEventListener("input", (e) => {
            searchQuery = e.target.value;
            renderProducts();
        });
    }

    if (searchClearBtn) {
        searchClearBtn.addEventListener("click", () => {
            searchQuery = "";
            if (searchInput) searchInput.value = "";
            renderProducts();
        });
    }
}

async function bootstrapApp() {
    initSearchListeners();
    updateCartCount();
    checkResetPasswordLink();
    refreshAccountUI();

    await Promise.allSettled([
        loadStoreSettings(),
        loadProducts(),
        loadPromo(),
        loadTopupProducts(),
        loadTrustStats(),
        checkPaymentReturn()
    ]);

    finishInitialLoading();
}

bootstrapApp();
