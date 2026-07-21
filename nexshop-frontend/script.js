/* =========================================================
   NexShop — front-end store logic
   Data is persisted in localStorage. There is no real backend,
   so "login" and "checkout" are simulated for demo purposes.
   ========================================================= */

let PRODUCTS = [];
let selectedCategory = "Semua";

const API_BASE = "https://nexshop-backend-production.up.railway.app/api";

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
    document.getElementById("pmQtyValue").textContent = pendingQty;

    openOverlay("productOverlay");
}

document.getElementById("pmQtyMinus").addEventListener("click", () => {
    pendingQty = Math.max(1, pendingQty - 1);
    document.getElementById("pmQtyValue").textContent = pendingQty;
});
document.getElementById("pmQtyPlus").addEventListener("click", () => {
    pendingQty = Math.min(99, pendingQty + 1);
    document.getElementById("pmQtyValue").textContent = pendingQty;
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

document.getElementById("myOrdersBtn").addEventListener("click", async () => {
    accountDropdown.classList.remove("active");
    const token = localStorage.getItem("nexshop_token");

    try {
        const res = await fetch(`${API_BASE}/orders/my`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        const orders = await res.json();

        if (!res.ok || orders.length === 0) {
            toast("Belum ada pesanan.");
        } else {
            toast(`Kamu punya ${orders.length} pesanan tercatat.`);
        }
    } catch (err) {
        toast("Gagal mengambil data pesanan.", "error");
    }
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

function renderHeroSlides() {
    const track = document.getElementById("heroTrack");
    const dotsWrap = document.getElementById("heroDots");

    track.innerHTML = heroSlides.map(s => `
        <div class="hero-slide" style="${s.image_url ? `background-image:url('${s.image_url}')` : ""}">
            <div class="hero-text">
                ${s.badge_text ? `<span class="hero-badge">${escapeHtml(s.badge_text)}</span>` : ""}
                <h2>${escapeHtml(s.title || "")}</h2>
                ${s.description ? `<p>${escapeHtml(s.description)}</p>` : ""}
                ${s.cta_text ? `<a href="${s.cta_link || "#"}" class="hero-cta">${escapeHtml(s.cta_text)}</a>` : ""}
            </div>
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
            waLink.textContent = `📱 WhatsApp/Telepon: ${s.contact_phone || s.contact_whatsapp}`;
            const contactWa = document.getElementById("contactWaLink");
            if (contactWa) {
                contactWa.href = waLink.href;
                contactWa.textContent = s.contact_phone || s.contact_whatsapp;
            }
        }
        if (s.contact_email) {
            const emailLink = document.getElementById("footerEmailLink");
            emailLink.href = `mailto:${s.contact_email}`;
            emailLink.textContent = `✉️ ${s.contact_email}`;
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

/* ---------- Topup Diamond ---------- */
let TOPUP_PRODUCTS = [];
let selectedTopupCategory = "Semua";
let activeTopupProduct = null;

async function loadTopupProducts() {
    try {
        const res = await fetch(`${API_BASE}/topup/products`);
        if (!res.ok) return;
        TOPUP_PRODUCTS = await res.json();
        renderTopupCategories();
        renderTopupGrid();
    } catch (err) {
        // biarin section kosong kalau API gagal
    }
}

function renderTopupCategories() {
    const filter = document.getElementById("topupCategoryFilter");
    const categories = ["Semua", ...new Set(TOPUP_PRODUCTS.map(p => p.kategori).filter(Boolean))];

    if (categories.length <= 1) {
        filter.innerHTML = "";
        return;
    }

    filter.innerHTML = categories.map(cat => {
        const logo = cat !== "Semua" ? (TOPUP_PRODUCTS.find(p => p.kategori === cat && p.operator_logo) || {}).operator_logo : null;
        return `
        <button class="category-btn ${cat === selectedTopupCategory ? "active" : ""}" data-cat="${cat}">
            ${logo ? `<img class="category-btn-logo" src="${logo}" alt="">` : ""}${escapeHtml(cat)}
        </button>`;
    }).join("");

    filter.querySelectorAll(".category-btn").forEach(btn => {
        btn.onclick = () => {
            selectedTopupCategory = btn.dataset.cat;
            renderTopupCategories();
            renderTopupGrid();
        };
    });
}

function renderTopupGrid() {
    const grid = document.getElementById("topupGrid");
    const data = selectedTopupCategory === "Semua"
        ? TOPUP_PRODUCTS
        : TOPUP_PRODUCTS.filter(p => p.kategori === selectedTopupCategory);

    if (data.length === 0) {
        grid.innerHTML = `<div class="topup-empty">Belum ada produk topup tersedia saat ini.</div>`;
        return;
    }

    grid.innerHTML = data.map(p => `
        <div class="topup-card" data-kode="${p.kode_produk}">
            ${p.kategori ? `<span class="topup-cat-tag">${escapeHtml(p.kategori)}</span>` : ""}
            ${p.item_icon
                ? `<img class="topup-item-icon" src="${p.item_icon}" alt="${escapeHtml(p.nama)}" loading="lazy">`
                : `<span class="diamond-icon">◆</span>`}
            <h5>${escapeHtml(p.nama)}</h5>
            <div class="topup-price">${rupiah(p.harga_jual)}</div>
        </div>
    `).join("");

    grid.querySelectorAll(".topup-card").forEach(card => {
        card.addEventListener("click", () => openTopupModal(card.dataset.kode));
    });
}

function openTopupModal(kodeProduk) {
    const p = TOPUP_PRODUCTS.find(x => x.kode_produk === kodeProduk);
    if (!p) return;
    activeTopupProduct = p;

    document.getElementById("tpTitle").textContent = p.nama;
    document.getElementById("tpPrice").textContent = rupiah(p.harga_jual);
    const iconEl = document.getElementById("tpIcon");
    if (iconEl) {
        if (p.operator_logo) {
            iconEl.innerHTML = `<img src="${p.operator_logo}" alt="${escapeHtml(p.kategori || p.nama)}">`;
        } else {
            iconEl.innerHTML = `<span class="diamond-icon">◆</span>`;
        }
    }
    document.getElementById("tpTujuan").value = "";
    document.getElementById("tpServerId").value = "";
    document.getElementById("tpEmail").value = currentUser ? currentUser.email : "";
    document.getElementById("tpError").textContent = "";
    document.getElementById("tpServerWrap").classList.toggle("hidden", !p.butuh_server_id);
    document.getElementById("tpServerId").required = !!p.butuh_server_id;

    openOverlay("topupOverlay");
}

document.getElementById("topupForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!activeTopupProduct) return;

    const tujuan = document.getElementById("tpTujuan").value.trim();
    const server_id = document.getElementById("tpServerId").value.trim();
    const recipient_email = document.getElementById("tpEmail").value.trim();
    const errorEl = document.getElementById("tpError");
    const submitBtn = document.getElementById("tpSubmitBtn");
    const token = localStorage.getItem("nexshop_token");

    errorEl.textContent = "";
    submitBtn.disabled = true;
    submitBtn.textContent = "Memproses...";

    try {
        const headers = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const res = await fetch(`${API_BASE}/topup`, {
            method: "POST",
            headers,
            body: JSON.stringify({
                kode_produk: activeTopupProduct.kode_produk,
                tujuan,
                server_id: server_id || undefined,
                recipient_email
            })
        });
        const data = await res.json();

        if (!res.ok) {
            errorEl.textContent = data.message || "Gagal membuat pesanan topup";
            submitBtn.disabled = false;
            submitBtn.textContent = "Bayar Sekarang";
            return;
        }

        submitBtn.disabled = false;
        submitBtn.textContent = "Bayar Sekarang";
        closeOverlay("topupOverlay");

        if (!data.paymentUrl) {
            toast("URL pembayaran tidak ditemukan dari server.", "error");
            return;
        }

        toast(`Pesanan dibuat! Kamu akan diarahkan ke halaman pembayaran. Catat Order ID: ${data.orderId}`);
        window.location.href = data.paymentUrl;
    } catch (err) {
        errorEl.textContent = "Gagal terhubung ke server.";
        submitBtn.disabled = false;
        submitBtn.textContent = "Bayar Sekarang";
    }
});

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

/* ---------- Init ---------- */
loadStoreSettings();
loadProducts();
loadPromo();
loadTopupProducts();
updateCartCount();
checkPaymentReturn();
refreshAccountUI();