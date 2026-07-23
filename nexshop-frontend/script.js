/* =========================================================
   NexShop — front-end store logic
   Data is persisted in localStorage. There is no real backend,
   so "login" and "checkout" are simulated for demo purposes.
   ========================================================= */

let PRODUCTS = [];
let selectedCategory = "Semua";

const API_BASE = "https://nexshop.cloud/api";

const rupiah = (n) => "Rp" + n.toLocaleString("id-ID");

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
        <span class="price-strike ${size}">${rupiah(p.strike_price)}</span>
        <span class="price-now ${size} promo">${rupiah(p.price)}</span>
        <span class="discount-chip">-${discountPercent(p)}%</span>
    `;
}
const stars = (rating) => "★".repeat(Math.round(rating)) + "☆".repeat(5 - Math.round(rating));

/* ---------- State (persisted) ---------- */
let currentUser = JSON.parse(localStorage.getItem("nexshop_user") || "null");

// Cart disimpan per-akun (key beda tiap user_id), plus 1 key terpisah buat
// guest (belum login). Jadi logout/ganti akun gak nyampur keranjang orang lain.
const cartKey = () => currentUser ? `nexshop_cart_${currentUser.id}` : "nexshop_cart_guest";
let cart = JSON.parse(localStorage.getItem(cartKey()) || "[]");
let activeProductId = null;
let pendingQty = 1;

const saveCart = () => localStorage.setItem(cartKey(), JSON.stringify(cart));
const saveUser = () => localStorage.setItem("nexshop_user", JSON.stringify(currentUser));

function switchCartContext() {
    cart = JSON.parse(localStorage.getItem(cartKey()) || "[]");
    updateCartCount();
}

/* ---------- Toast ---------- */
function toast(message, type = "default") {
    const container = document.getElementById("toastContainer");
    const el = document.createElement("div");
    el.className = "toast" + (type !== "default" ? " " + type : "");
    el.textContent = message;
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

     PRODUCTS = await res.json();

    renderCategories();
    renderProducts();

    } catch (err) {

        console.error(err);

    }

}
function renderCategories() {

    const filter = document.getElementById("categoryFilter");

    const categories = [
        "Semua",
        ...new Set(PRODUCTS.map(p => p.category))
    ];

    filter.innerHTML = categories.map(cat => `
        <button
            class="category-btn ${cat === selectedCategory ? "active" : ""}"
            data-category="${cat}">
            ${cat}
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
   const data =
    selectedCategory === "Semua"
        ? PRODUCTS
        : PRODUCTS.filter(p => p.category === selectedCategory);

grid.style.opacity = 0;
grid.style.transform = "translateY(20px)";

setTimeout(() => {

    grid.innerHTML = data.map(p => `

        <div class="card" data-id="${p.id}">
            <div class="card-img">
                <img src="${p.image}" alt="${p.name}">
                <span class="badge">${p.badge}</span>
                ${isFlashSaleActive(p) ? `<span class="flash-ribbon">🔥 -${discountPercent(p)}%</span>` : ""}
            </div>
            <div class="card-body">
                <h4>${p.name}</h4>
                <div class="card-rating"><span class="stars">${stars(p.rating)}</span> ${p.rating} · ${p.sold} terjual</div>
                <div class="card-footer">
                    <div class="card-price-block">${priceBlockHtml(p, "sm")}</div>
                    <button type="button" class="add-btn" data-id="${p.id}">Beli</button>
                </div>
            </div>
        </div>
    `).join("");

    grid.querySelectorAll(".card").forEach(card => {
        card.addEventListener("click", (e) => {
            if (e.target.closest(".add-btn")) return; // handled separately
            openProductModal(Number(card.dataset.id));
        });
    });

    grid.querySelectorAll(".add-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            addToCart(Number(btn.dataset.id), 1);
        });
    });

    grid.style.opacity = 1;
    grid.style.transform = "translateY(0)";

}, 150);
}

/* ---------- Product detail modal ---------- */
function openProductModal(id) {
    const p = PRODUCTS.find(x => x.id === id);
    if (!p) return;
    activeProductId = id;
    pendingQty = 1;

    document.getElementById("pmImage").src = p.image;
    document.getElementById("pmImage").alt = p.name;
    document.getElementById("pmBadge").textContent = p.badge;
    document.getElementById("pmTitle").textContent = p.name;
    document.getElementById("pmStars").innerHTML = `<span class="stars">${stars(p.rating)}</span> ${p.rating}`;
    document.getElementById("pmSold").textContent = `· ${p.sold} terjual`;
  document.getElementById("pmDesc").textContent = p.description;
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
                <img src="${p.image}" alt="${p.name}">
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
    });
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

function cartSubtotal() {
    return cart.reduce((sum, item) => {
        const p = PRODUCTS.find(x => x.id === item.id);
        return sum + p.price * item.qty;
    }, 0);
}

function renderCheckoutSummary() {
    const subtotal = cartSubtotal();
    const itemCount = cart.reduce((sum, item) => sum + item.qty, 0);
    const discount = appliedPromo ? appliedPromo.discount : 0;
    const total = Math.max(subtotal - discount, 0);

    document.getElementById("checkoutSummary").innerHTML = `
        <div class="row"><span>${itemCount} item</span><span>${rupiah(subtotal)}</span></div>
        ${appliedPromo ? `<div class="row discount"><span>Diskon (${appliedPromo.code})</span><span>-${rupiah(discount)}</span></div>` : ""}
        <div class="row total"><span>Total Bayar</span><span>${rupiah(total)}</span></div>
    `;
}

document.getElementById("checkoutBtn").addEventListener("click", () => {
    if (cart.length === 0) {
        toast("Keranjang masih kosong.", "error");
        return;
    }
    closeOverlay("cartOverlay");

    appliedPromo = null;
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

    document.getElementById("checkoutStep").classList.remove("hidden");
    document.getElementById("checkoutSuccess").classList.add("hidden");
    openOverlay("checkoutOverlay");
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
        const res = await fetch(`${API_BASE}/promo-codes/validate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code, subtotal: cartSubtotal() })
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

    const subtotal = cartSubtotal();
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
                payment_method: "ipaymu",
                items: cart,
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
        // lewat webhook iPaymu begitu lunas — cart dikosongkan sebelum redirect
        // supaya gak nyangkut kalau user gak balik lagi ke tab ini.
        cart = [];
        saveCart();
        updateCartCount();

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

    cart = [];
    saveCart();
    updateCartCount();
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

function renderTrackResult(data) {
    const label = STATUS_LABEL[data.status] || data.status;
    const cls = STATUS_CLASS[data.status] || "info";
    const tanggal = data.created_at ? new Date(data.created_at).toLocaleString("id-ID") : "-";

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
    }

    document.getElementById("trackResult").innerHTML = `
        <div class="track-status-badge ${cls}">${escapeHtml(label)}</div>
        <div class="row"><span>Order ID</span><span>${escapeHtml(data.id)}</span></div>
        <div class="row"><span>Tanggal</span><span>${tanggal}</span></div>
        ${itemsHtml}
        <div class="row total"><span>Total</span><span>${rupiah(data.total || 0)}</span></div>
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
async function loadStoreSettings() {
    try {
        const res = await fetch(`${API_BASE}/settings/store`);
        if (!res.ok) return;
        const s = await res.json();

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
            if (waLabel) waLabel.textContent = `WhatsApp/Telepon: ${s.contact_phone || s.contact_whatsapp}`;
            const contactWa = document.getElementById("contactWaLink");
            if (contactWa) {
                contactWa.href = waLink.href;
                contactWa.textContent = s.contact_phone || s.contact_whatsapp;
            }
        }
        if (s.contact_email) {
            const emailLink = document.getElementById("footerEmailLink");
            emailLink.href = `mailto:${s.contact_email}`;
            const emailLabel = document.getElementById("footerEmailLabel");
            if (emailLabel) emailLabel.textContent = s.contact_email;
            const contactEmail = document.getElementById("contactEmailLink");
            if (contactEmail) {
                contactEmail.href = emailLink.href;
                contactEmail.textContent = s.contact_email;
            }
        }
        if (s.address) {
            document.getElementById("footerAddress").textContent = `📍 ${s.address}`;
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

/* ---------- Topup Diamond: Game Grid -> 4-Step Detail Wizard ---------- */
// Alur baru: (1) grid game -> (2) halaman detail game (bukan modal) dengan
// step Akun -> Nominal -> Pembayaran -> Ringkasan. Semua data (produk, logo
// game, kategori) tetap dari /api/topup/products (admin dashboard), TIDAK
// ada yang di-hardcode. Endpoint & kontrak API tidak berubah sama sekali
// dari implementasi lama (check-nickname, create order) supaya checkout,
// iPaymu, dan backend tetap jalan seperti sebelumnya.
let TOPUP_PRODUCTS = [];
let TOPUP_GAMES = [];

// Kanal pembayaran ini murni lapisan UX/preferensi tampilan — backend cuma
// punya 1 gateway (iPaymu) yang di dalam halamannya sendiri sudah
// menyediakan semua kanal ini, jadi tidak ada payload baru yang dikirim ke
// server hanya karena user memilih salah satu kartu di Step 3.
const TW_PAYMENT_METHODS = [
    { id: "qris", label: "QRIS", desc: "Scan sekali, bisa pakai e-wallet/m-banking apa saja", icon: "🔳" },
    { id: "va", label: "Virtual Account", desc: "Transfer via BCA, BRI, Mandiri, dan bank lain", icon: "🏦" },
    { id: "ewallet", label: "E-Wallet", desc: "OVO, DANA, ShopeePay, LinkAja", icon: "📱" },
    { id: "card", label: "Kartu Kredit/Debit", desc: "Visa & Mastercard", icon: "💳" }
];

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
    payment: null
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
                ${g.logo ? `<img src="${g.logo}" alt="${escapeHtml(g.kategori)}" loading="lazy">` : `<span class="diamond-icon">◆</span>`}
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
        payment: null
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
    if (step === 3) renderTwSummary();
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
        if (!twState.payment) { toast("Pilih metode pembayaran dulu ya", "error"); return; }
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
                resultEl.innerHTML = `<span class="tw-check-icon">✓</span> Akun ditemukan: <strong>${escapeHtml(data.username || "-")}</strong>`;
            } else {
                twState.nickname = null;
                resultEl.className = "tw-account-result invalid";
                resultEl.innerHTML = `⚠️ User ID${twState.needsServerId ? "/Server ID" : ""} tidak ditemukan. Periksa kembali sebelum melanjutkan.`;
            }
        } else {
            twState.nicknameSupported = false;
            twState.nickname = null;
            resultEl.className = "tw-account-result warning";
            resultEl.innerHTML = `⚠️ Cek otomatis belum tersedia untuk game ini. Pastikan User ID${twState.needsServerId ? "/Server ID" : ""} sudah benar sebelum lanjut.`;
        }
    } catch (err) {
        resultEl.classList.remove("hidden");
        resultEl.className = "tw-account-result warning";
        resultEl.innerHTML = `⚠️ Gagal menghubungi server cek akun. Pastikan data yang kamu masukkan sudah benar.`;
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
            ${p.item_icon ? `<img class="tw-product-icon" src="${p.item_icon}" alt="${escapeHtml(p.nama)}" loading="lazy">` : `<span class="diamond-icon">◆</span>`}
            <h5>${escapeHtml(p.nama)}</h5>
            <div class="tw-product-price">${rupiah(p.harga_jual)}</div>
            <span class="tw-product-check">✓</span>
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

/* ---- Step 3: Pilih Metode Pembayaran ---- */
function renderTopupPaymentGrid() {
    const grid = document.getElementById("twPaymentGrid");
    grid.innerHTML = TW_PAYMENT_METHODS.map(m => `
        <div class="tw-payment-card ${twState.payment === m.id ? "selected" : ""}" data-id="${m.id}">
            <span class="tw-payment-icon">${m.icon}</span>
            <div>
                <h5>${m.label}</h5>
                <p>${m.desc}</p>
            </div>
            <span class="tw-payment-check">✓</span>
        </div>
    `).join("");

    grid.querySelectorAll(".tw-payment-card").forEach(card => {
        card.addEventListener("click", () => {
            twState.payment = card.dataset.id;
            renderTopupPaymentGrid();
        });
    });
}

/* ---- Step 4: Ringkasan Pesanan ---- */
function renderTwSummary() {
    const el = document.getElementById("twSummary");
    const p = twState.product;
    const paymentLabel = (TW_PAYMENT_METHODS.find(m => m.id === twState.payment) || {}).label || "-";

    el.innerHTML = `
        <div class="tw-summary-row"><span>Game</span><strong>${escapeHtml(twState.kategori)}</strong></div>
        ${twState.nicknameSupported && twState.nickname ? `<div class="tw-summary-row"><span>Nickname</span><strong>${escapeHtml(twState.nickname)}</strong></div>` : ""}
        <div class="tw-summary-row"><span>User ID</span><strong>${escapeHtml(twState.userId)}${twState.serverId ? " (" + escapeHtml(twState.serverId) + ")" : ""}</strong></div>
        <div class="tw-summary-row"><span>Produk</span><strong>${escapeHtml(p ? p.nama : "-")}</strong></div>
        <div class="tw-summary-row"><span>Harga</span><strong>${rupiah(p ? p.harga_jual : 0)}</strong></div>
        <div class="tw-summary-row"><span>Metode Pembayaran</span><strong>${escapeHtml(paymentLabel)}</strong></div>
    `;
    document.getElementById("twConfirmCheck").checked = false;
    document.getElementById("twStep4Error").textContent = "";
}

// Submit — kontrak API PERSIS sama seperti implementasi lama (kode_produk,
// tujuan, server_id, recipient_email ke POST /api/topup), jadi backend,
// iPaymu, dan webhook TIDAK perlu diubah sama sekali.
async function submitTopupOrder() {
    const errorEl = document.getElementById("twStep4Error");
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
                recipient_email: twState.email
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

        btn.disabled = false;
        btn.textContent = "Bayar Sekarang";
        openOrderConfirm(data);
    } catch (err) {
        errorEl.textContent = "Gagal terhubung ke server.";
        btn.disabled = false;
        btn.textContent = "Bayar Sekarang";
    }
}

// Ringkasan pesanan final (Order ID asli dari server) sebelum lari ke iPaymu —
// murni langkah konfirmasi tambahan di frontend, tidak mengubah kontrak API.
function openOrderConfirm(orderData) {
    const p = twState.product;
    const paymentLabel = (TW_PAYMENT_METHODS.find(m => m.id === twState.payment) || {}).label || "-";

    const iconEl = document.getElementById("twOrderConfirmIcon");
    if (p && p.item_icon) {
        iconEl.outerHTML = `<img class="tw-confirm-icon" id="twOrderConfirmIcon" src="${p.item_icon}" alt="${escapeHtml(p.nama)}">`;
    } else {
        iconEl.outerHTML = `<span class="diamond-icon" id="twOrderConfirmIcon">◆</span>`;
    }

    document.getElementById("twOrderConfirmProduct").textContent = p ? p.nama : "-";
    document.getElementById("twOrderConfirmGame").textContent = twState.kategori;

    document.getElementById("twOrderConfirmSummary").innerHTML = `
        <div class="tw-summary-row"><span>ID Transaksi</span><strong>${escapeHtml(String(orderData.orderId))}</strong></div>
        <div class="tw-summary-row"><span>User ID</span><strong>${escapeHtml(twState.userId)}${twState.serverId ? " (" + escapeHtml(twState.serverId) + ")" : ""}</strong></div>
        <div class="tw-summary-row"><span>Metode Pembayaran</span><strong>${escapeHtml(paymentLabel)}</strong></div>
        <div class="tw-summary-row"><span>Total</span><strong>${rupiah(p ? p.harga_jual : 0)}</strong></div>
    `;

    const proceedBtn = document.getElementById("twOrderConfirmProceed");
    proceedBtn.onclick = () => { window.location.href = orderData.paymentUrl; };

    openOverlay("twOrderConfirmOverlay");
}
document.getElementById("twOrderConfirmClose").addEventListener("click", () => closeOverlay("twOrderConfirmOverlay"));

/* ---------- Show/hide password ---------- */
document.querySelectorAll(".toggle-password").forEach(btn => {
    btn.addEventListener("click", () => {
        const input = document.getElementById(btn.dataset.target);
        const showing = input.type === "text";
        input.type = showing ? "password" : "text";
        btn.classList.toggle("showing", !showing);
        btn.textContent = showing ? "👁" : "🙈";
    });
});

/* ---------- Halaman kembali dari pembayaran iPaymu (returnUrl) ---------- */
async function checkPaymentReturn() {
    const hash = window.location.hash || "";
    if (!hash.startsWith("#/payment-status")) return;

    const query = new URLSearchParams(hash.split("?")[1] || "");
    const orderId = query.get("order");
    if (!orderId) return;

    const isTopup = orderId.startsWith("TP");
    const endpoint = isTopup ? `${API_BASE}/topup/public-status/${orderId}` : `${API_BASE}/orders/status/${orderId}`;

    try {
        const res = await fetch(endpoint);
        const data = await res.json();
        if (!res.ok) {
            toast(`Order ${orderId}: status belum bisa dicek. Simpan Order ID ini untuk cek manual ke admin.`);
            return;
        }

        if (data.status === "paid" || data.status === "sukses") {
            toast(`Pembayaran ${orderId} berhasil! ${isTopup ? "Diamond akan segera diproses." : "Pesanan sedang diproses."}`, "success");
        } else if (data.status === "pending" || data.status === "processing") {
            toast(`Order ${orderId} sedang menunggu konfirmasi pembayaran. Status akan otomatis update begitu lunas.`);
        } else if (data.status === "failed" || data.status === "gagal") {
            toast(`Pembayaran ${orderId} tidak berhasil/dibatalkan. Silakan coba checkout ulang.`, "error");
        } else {
            toast(`Order ${orderId}: status "${data.status}".`);
        }
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
loadStoreSettings();
loadProducts();
loadPromo();
loadTopupProducts();
loadTrustStats();
updateCartCount();
checkPaymentReturn();
refreshAccountUI();