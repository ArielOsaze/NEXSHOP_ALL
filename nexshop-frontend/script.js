/* =========================================================
   NexShop — front-end store logic
   Data is persisted in localStorage. There is no real backend,
   so "login" and "checkout" are simulated for demo purposes.
   ========================================================= */

let PRODUCTS = [];
let selectedCategory = "Semua";
let searchQuery = "";
let topupSearchQuery = "";
let cachedStoreSettings = null; // diisi loadStoreSettings(), dipakai buat WA CTA di renderTrackResult

const API_BASE = (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
    ? (window.location.port === "3000" ? "/api" : "http://localhost:3000/api")
    : (window.location.protocol.startsWith("http") ? "/api" : "https://nexshop.cloud/api");
const THEME_STORAGE_KEY = "nexshop-public-theme";
const PUBLIC_TOKEN_STORAGE_KEY = "nexshop-public-token";

const PAYMENT_METHODS = [
    { id: "wallet", label: "NexShop Wallet", desc: "Bayar instan pakai Saldo Akun", icon: "fa-wallet" },
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
let initialReadyDispatched = false;

function notifyInitialReady() {
    if (initialReadyDispatched) return;
    initialReadyDispatched = true;
    // Match the loader fade so entrance animations never run while obscured.
    window.setTimeout(() => {
        document.body.classList.add("app-ready");
        document.dispatchEvent(new Event("nexshop:initial-ready"));
    }, 320);
}

// Safety net: if the app-ready class hasn't been applied within 5 seconds of
// script execution (regardless of loader/fetch state), force it. This prevents
// a blank hero on slow or stalled network conditions.
window.setTimeout(() => {
    if (!initialReadyDispatched) {
        if (appLoader) { appLoader.classList.remove("is-visible"); appLoader.setAttribute("aria-busy", "false"); }
        notifyInitialReady();
    }
}, 5000);

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
    
    // Delayed NexBot appearance
    setTimeout(() => {
        const nexbot = document.getElementById("nexbotWidget");
        if (nexbot) {
            nexbot.style.opacity = "1";
            nexbot.style.pointerEvents = "auto";
        }
    }, 2000);
    // Always notify once the loader is dismissed — the previous guard
    // `if (!initialLoading)` caused a race where cached fetches resolved
    // before finishInitialLoading set the flag.
    notifyInitialReady();
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
    const url = typeof args[0] === "string" ? args[0] : (args[0] && args[0].url ? args[0].url : "");
    if (url.includes("/ai/chat")) {
        return nativeFetch(...args);
    }
    beginAppRequest();
    return nativeFetch(...args).finally(endAppRequest);
};

function finishInitialLoading(force = false) {
    initialLoading = false;
    if (force || activeRequests === 0) hideAppLoader();
    else showAppLoader("Menyiapkan data toko...");
}

function applyTheme(theme, persist = false) {
    const isLight = theme === "light";
    document.documentElement.dataset.theme = isLight ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", isLight ? "light" : "dark");
    if (isLight) document.documentElement.classList.remove("dark");
    else document.documentElement.classList.add("dark");

    document.querySelectorAll("#themeToggle, .theme-toggle").forEach(btn => {
        const icon = btn.querySelector(".theme-toggle-icon");
        const label = btn.querySelector(".theme-toggle-label");
        btn.setAttribute("aria-pressed", String(isLight));
        btn.setAttribute("aria-label", isLight ? "Aktifkan mode gelap" : "Aktifkan mode terang");
        btn.title = isLight ? "Aktifkan mode gelap" : "Aktifkan mode terang";
        if (icon) icon.innerHTML = `<i class="fa-solid ${isLight ? "fa-sun" : "fa-moon"}" aria-hidden="true"></i>`;
        if (label) label.textContent = isLight ? "Mode terang" : "Mode gelap";
    });

    if (persist) {
        try { localStorage.setItem(THEME_STORAGE_KEY, isLight ? "light" : "dark"); } catch (e) {}
    }
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
    const isPromo = isFlashSaleActive(p);
    if (!isPromo) {
        return `
            <div class="price-block">
                <div class="price-stack">
                    <span class="price-main ${size}">${rupiah(p.price)}</span>
                </div>
            </div>
        `;
    }
    return `
        <div class="price-block promo">
            <div class="price-stack">
                <span class="price-strike ${size}">${rupiah(p.strike_price)}</span>
                <span class="price-main ${size} is-discounted">${rupiah(p.price)}</span>
            </div>
        </div>
    `;
}
// Bintang rating memakai ikon Font Awesome, bukan karakter emoji
// bintang. Glif emoji dirender berbeda-beda di tiap sistem operasi dan
// warnanya tidak bisa diatur CSS, jadi tampilan rating tidak konsisten
// antar perangkat.
const stars = (rating) => {
    const penuh = Math.round(Number(rating) || 0);
    const aman = Math.max(0, Math.min(5, penuh));
    return '<i class="fa-solid fa-star" aria-hidden="true"></i>'.repeat(aman)
        + '<i class="fa-regular fa-star" aria-hidden="true"></i>'.repeat(5 - aman);
};

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
let productRenderVersion = 0;

const saveCart = () => {
    try { localStorage.setItem(cartKey(), JSON.stringify(cart)); } catch (err) {
        console.warn("Keranjang tidak dapat disimpan di browser ini", err);
    }
};
const saveUser = () => {
    try { localStorage.setItem("nexshop_user", JSON.stringify(currentUser)); } catch (err) {
        console.warn("Sesi pengguna tidak dapat disimpan di browser ini", err);
    }
};

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

/* ---------- Event target helpers ----------
   BUG FIX (mobile): di WebKit/iOS, `event.target` buat click yang berasal
   dari tap bisa berupa TEXT NODE, bukan Element -- khususnya kalau jarinya
   mendarat persis di atas teks (mis. nominal "Rp 250.000" di tombol saldo
   navbar). Text node gak punya .closest(), jadi pemanggilan
   `event.target.closest(...)` melempar TypeError, listener-nya mati, dan
   tombolnya kelihatan "gak bisa diklik" -- padahal di desktop (yang
   target-nya selalu Element) sama sekali gak kelihatan masalahnya.
   Semua delegasi event di file ini WAJIB lewat dua helper di bawah. */
function eventElement(target) {
    if (!target) return null;
    // Node.ELEMENT_NODE === 1; text node (3) dinaikin ke elemen induknya.
    if (target.nodeType === 1) return target;
    return target.parentElement || null;
}

function closestFromEvent(target, selector) {
    const el = eventElement(target);
    return el ? el.closest(selector) : null;
}

/* ---------- Overlay helpers ---------- */
let lastFocusedElement = null;

function getFocusableElements(container) {
    return [...container.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
        .filter((element) => !element.closest(".hidden"));
}

function openOverlay(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const wasOpen = el.classList.contains("active");
    if (!wasOpen) lastFocusedElement = document.activeElement;
    el.setAttribute("aria-hidden", "false");
    el.classList.add("active");
    document.body.style.overflow = "hidden";
    if (!wasOpen) {
        const focusTarget = getFocusableElements(el)[0];
        if (focusTarget) requestAnimationFrame(() => focusTarget.focus());
    }
}
function closeOverlay(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove("active");
    el.setAttribute("aria-hidden", "true");
    
    if (id === "trackOverlay" && window.trackPollingTimer) {
        clearTimeout(window.trackPollingTimer);
        window.trackPollingTimer = null;
    }

    // Tutup lewat backdrop click / Escape juga harus menghentikan polling
    // status pembayaran, sama seperti tombol X-nya (lihat stopIpaymuPolling).
    if (id === "directPaymentOverlay" || id === "paymentWaitingOverlay") {
        stopIpaymuPolling();
    }

    if (!document.querySelector(".overlay.active")) {
        document.body.style.overflow = "";
        if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
            lastFocusedElement.focus();
        }
        lastFocusedElement = null;
    }
}
document.querySelectorAll("[data-close]").forEach(btn => {
    btn.addEventListener("click", () => closeOverlay(btn.dataset.close));
});
document.querySelectorAll(".overlay").forEach(ov => {
    ov.setAttribute("aria-hidden", String(!ov.classList.contains("active")));
    ov.addEventListener("click", (e) => {
        if (e.target === ov) closeOverlay(ov.id);
    });
});
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        document.querySelectorAll(".overlay.active").forEach(ov => closeOverlay(ov.id));
        document.getElementById("accountDropdown").classList.remove("active");
        const navMenu = document.getElementById("navMenu");
        const menuToggle = document.getElementById("menuToggle");
        if (navMenu) navMenu.classList.remove("active");
        if (menuToggle) menuToggle.setAttribute("aria-expanded", "false");
        return;
    }

    if (e.key === "Tab") {
        const activeOverlay = document.querySelector(".overlay.active");
        if (!activeOverlay) return;
        const focusable = getFocusableElements(activeOverlay);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    }
});

/* ---------- Render product catalog ---------- */

let promoSlides = [];
let promoIndex = 0;
let promoTimer = null;

async function loadPromo() {
    try {
        const res = await fetch(`${API_BASE}/promo`);
        if (!res.ok) return;
        promoSlides = await res.json();
        
        const section = document.getElementById("promoCarouselSection");
        if (!promoSlides || promoSlides.length === 0) {
            if (section) section.classList.add("hidden");
            return;
        }
        
        if (section) section.classList.remove("hidden");
        renderPromoCarousel();
    } catch (err) {
        console.error("Failed to load promo slides", err);
    }
}

function renderPromoCarousel() {
    const inner = document.getElementById("promoCarouselInner");
    const indicators = document.getElementById("promoIndicators");
    
    if (!inner || !indicators) return;
    
    inner.innerHTML = promoSlides.map((slide, i) => {
        if (slide.full_image) {
            return `
                <a href="${slide.cta_link || '#'}" class="min-w-full h-full shrink-0 relative block">
                    <picture>
                        <source media="(max-width: 768px)" srcset="${slide.mobile_image_url || slide.image_url}">
                        <img src="${slide.image_url}" alt="${slide.title}" class="absolute inset-0 w-full h-full object-cover">
                    </picture>
                </a>
            `;
        }
        
        return `
            <div class="min-w-full h-full shrink-0 relative flex items-center p-6 sm:p-12">
                <picture>
                    <source media="(max-width: 768px)" srcset="${slide.mobile_image_url || slide.image_url}">
                    <img src="${slide.image_url}" alt="" class="absolute inset-0 w-full h-full object-cover opacity-50 mix-blend-overlay">
                </picture>
                <div class="absolute inset-0 bg-gradient-to-r from-gray-900 via-gray-900/80 to-transparent"></div>
                <div class="relative z-10 max-w-lg">
                    ${slide.badge_text ? `<span class="inline-block px-3 py-1 bg-brand-indigo text-white text-xs font-bold uppercase tracking-wider rounded-full mb-3">${escapeHtml(slide.badge_text)}</span>` : ''}
                    <h2 class="text-xl sm:text-3xl md:text-4xl font-black text-white mb-2 sm:mb-3 leading-tight">${escapeHtml(slide.title)}</h2>
                    ${slide.description ? `<p class="text-sm sm:text-base text-gray-300 mb-4 sm:mb-6 line-clamp-2">${escapeHtml(slide.description)}</p>` : ''}
                    ${slide.cta_text ? `<a href="${slide.cta_link || '#'}" class="btn-primary inline-flex text-sm sm:text-base">${escapeHtml(slide.cta_text)}</a>` : ''}
                </div>
            </div>
        `;
    }).join("");
    
    indicators.innerHTML = promoSlides.map((_, i) => `
        <button class="transition-all duration-300 ${i === 0 ? 'w-6 h-2 rounded-full bg-brand-cyan' : 'w-2 h-2 rounded-full bg-black/20 dark:bg-white/50'}" onclick="goToPromoSlide(${i})"></button>
    `).join("");
    
    promoIndex = 0;
    startPromoAutoplay();
}

function goToPromoSlide(index) {
    if (promoSlides.length === 0) return;
    promoIndex = (index + promoSlides.length) % promoSlides.length;
    
    const inner = document.getElementById("promoCarouselInner");
    if (inner) {
        inner.style.transform = `translateX(-${promoIndex * 100}%)`;
    }
    
    const dots = document.getElementById("promoIndicators").children;
    Array.from(dots).forEach((dot, i) => {
        if (i === promoIndex) {
            dot.className = "w-6 h-2 rounded-full transition-all duration-300 bg-brand-cyan";
        } else {
            dot.className = "w-2 h-2 rounded-full transition-all duration-300 bg-black/20 dark:bg-white/50";
        }
    });
}

function startPromoAutoplay() {
    if (promoSlides.length <= 1) return;
    clearInterval(promoTimer);
    promoTimer = setInterval(() => goToPromoSlide(promoIndex + 1), 5000);
}

document.getElementById("promoPrev")?.addEventListener("click", () => {
    goToPromoSlide(promoIndex - 1);
    startPromoAutoplay();
});
document.getElementById("promoNext")?.addEventListener("click", () => {
    goToPromoSlide(promoIndex + 1);
    startPromoAutoplay();
});

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

    const renderVersion = ++productRenderVersion;
    grid.style.opacity = 0;
    grid.style.transform = "translateY(10px)";

    requestAnimationFrame(() => {
        // Pencarian/filter dapat berubah lebih cepat dari frame render. Abaikan
        // render lama supaya markup dan event yang tampil selalu versi terakhir.
        if (renderVersion !== productRenderVersion) return;
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
                <article class="group relative home-glass-card rounded-2xl sm:rounded-3xl flex flex-col h-full" data-product-card data-id="${p.id}" tabindex="0">
                    <div class="relative w-full aspect-[4/3] rounded-t-2xl sm:rounded-t-3xl overflow-hidden bg-transparent shrink-0">
                        <img src="${escapeHtml(safeUrl(p.image))}" alt="${escapeHtml(p.name)}" class="absolute inset-0 w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-700 fallback-clear" loading="lazy" decoding="async">
                        <div class="absolute inset-0 bg-gradient-to-t from-black/60 via-black/0 to-black/0 pointer-events-none"></div>
                        ${(isFlashSaleActive(p) || p.badge) ? `<div class="absolute top-2 left-2 flex flex-col gap-1">${isFlashSaleActive(p) ? '<span class="bg-red-500 text-white text-[8px] sm:text-[10px] font-bold px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-full shadow-lg backdrop-blur-md flex items-center gap-1 border border-white/10"><i class="fa-solid fa-bolt text-[8px] sm:text-[10px]" aria-hidden="true"></i> FLASH SALE</span>' : ""}${p.badge ? `<span class="bg-black/50 backdrop-blur-md text-white text-[8px] sm:text-[10px] font-bold px-1.5 py-0.5 sm:px-2.5 sm:py-1 rounded-full uppercase tracking-widest border border-white/10">${escapeHtml(p.badge)}</span>` : ""}</div>` : ""}
                    </div>
                    <div class="p-[clamp(6px,2vw,20px)] flex flex-col flex-1">
                        <div class="flex-1">
                            ${p.category ? `<div class="text-[clamp(0.5rem,1.5vw,0.625rem)] font-bold text-brand-indigo dark:text-brand-cyan uppercase tracking-wider mb-1 truncate">${escapeHtml(p.category)}</div>` : ""}
                            <h4 class="font-bold text-gray-900 dark:text-white text-[clamp(0.65rem,2.2vw,1.125rem)] leading-tight line-clamp-2 group-hover:text-brand-indigo dark:group-hover:text-brand-cyan transition-colors">${escapeHtml(p.name)}</h4>
                            <div class="flex items-center gap-1 text-[clamp(0.55rem,1.7vw,0.75rem)] text-gray-500 dark:text-gray-400 mt-1 sm:mt-2 font-medium">
                                <i class="fa-solid fa-star text-amber-400 text-[clamp(0.5rem,1.5vw,0.75rem)]" aria-hidden="true"></i> <span>${p.rating || 5} · ${p.sold || 0} sold</span>
                            </div>
                        </div>
                        <div class="flex items-center justify-between mt-2 sm:mt-4 shrink-0">
                            <div class="font-bold text-gray-900 dark:text-white text-[clamp(0.65rem,2vw,1rem)] truncate">${priceBlockHtml(p, "sm")}</div>
                            <div class="flex gap-1 sm:gap-2 relative z-10 shrink-0">
                                <button class="w-[clamp(24px,5vw,32px)] h-[clamp(24px,5vw,32px)] rounded-full bg-brand-indigo/10 dark:bg-white/5 flex items-center justify-center text-brand-indigo dark:text-brand-cyan hover:bg-brand-indigo hover:text-white transition-colors" data-product-action="add" data-id="${p.id}" title="Tambah ke keranjang">
                                    <i class="fa-solid fa-cart-plus text-[clamp(0.75rem,2.5vw,1rem)]" aria-hidden="true"></i>
                                </button>
                                <button class="w-[clamp(24px,5vw,32px)] h-[clamp(24px,5vw,32px)] rounded-full bg-gray-900 dark:bg-white flex items-center justify-center text-white dark:text-gray-900 hover:scale-110 transition-transform" data-product-action="buy" data-id="${p.id}" title="Beli sekarang">
                                    <i class="fa-solid fa-bag-shopping text-[clamp(0.75rem,2.5vw,1rem)]" aria-hidden="true"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                </article>
            `).join("");
        }

        grid.style.opacity = 1;
        grid.style.transform = "translateY(0)";
    });
}

// Satu handler permanen untuk seluruh katalog. Ini menghilangkan listener
// ganda saat katalog dirender ulang dan memisahkan tegas area kartu dari aksi
// pembelian: kartu hanya boleh membuka detail; checkout hanya dari tombol Buy.
function initProductGridInteractions() {
    const grid = document.getElementById("cardGrid");
    if (!grid) return;

    grid.addEventListener("click", (event) => {
        const action = closestFromEvent(event.target, "[data-product-action]");
        if (action && grid.contains(action)) {
            const id = Number(action.dataset.id);
            if (!Number.isFinite(id)) return;
            if (action.dataset.productAction === "add") addToCart(id, 1);
            if (action.dataset.productAction === "buy") openCheckout([{ id, qty: 1 }], "direct");
            return;
        }

        const card = closestFromEvent(event.target, "[data-product-card]");
        if (card && grid.contains(card)) openProductModal(Number(card.dataset.id));
    });

    grid.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        if (closestFromEvent(event.target, "[data-product-action]")) return;
        const card = closestFromEvent(event.target, "[data-product-card]");
        if (!card || !grid.contains(card)) return;
        event.preventDefault();
        openProductModal(Number(card.dataset.id));
    });
}

/* ---------- Product detail modal ---------- */
function openProductModal(id) {
    const p = PRODUCTS.find(x => x.id === id);
    if (!p) return;
    activeProductId = id;
    pendingQty = 1;

    const image = document.getElementById("pmImage");
    image.classList.remove("is-loaded");
    image.classList.add("is-loading");
    image.src = safeUrl(p.image);
    image.alt = p.name;
    
    const pmFlash = document.getElementById("pmFlashFlag");
    if (pmFlash) pmFlash.classList.toggle("hidden", !isFlashSaleActive(p));
    const pmBadge = document.getElementById("pmBadge");
    if (pmBadge) {
        pmBadge.textContent = p.badge || "";
        pmBadge.classList.toggle("hidden", !p.badge);
    }

    document.getElementById("pmTitle").textContent = p.name;
    document.getElementById("pmCategory").textContent = p.category || "Produk digital";
    document.getElementById("pmStars").innerHTML = `<span class="stars">${stars(p.rating || 5)}</span> ${p.rating || 5}`;
    document.getElementById("pmSold").textContent = `· ${p.sold || 0} sold`;
    document.getElementById("pmDesc").textContent = p.description || "";
    document.getElementById("pmPrice").innerHTML = priceBlockHtml(p, "lg");
    document.getElementById("pmQtyValue").value = pendingQty;

    openOverlay("productOverlay");
}

document.getElementById("pmImage").addEventListener("load", (event) => {
    event.currentTarget.classList.remove("is-loading");
    event.currentTarget.classList.add("is-loaded");
});
document.getElementById("pmImage").addEventListener("error", (event) => {
    event.currentTarget.classList.remove("is-loading");
    event.currentTarget.classList.add("is-loaded");
});

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
    if (!Number.isFinite(id)) return;
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
                <img src="${escapeHtml(safeUrl(p.image))}" alt="${escapeHtml(p.name)}" loading="lazy" decoding="async">
                <div class="cart-item-info">
                    <h5>${escapeHtml(p.name)}</h5>
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

const mobileMenuBtn = document.getElementById("mobileMenuBtn");
if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener("click", () => {
        document.getElementById("mobileMenuOverlay").classList.add("active");
    });
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
        accountBtn.querySelector("#accountBtnLabel").textContent = currentUser.fullname.split(" ")[0];
        accountBtn.classList.add("logged-in");
        const accountAvatar = document.getElementById("accountAvatar");
        if (currentUser.avatar_url) {
            accountAvatar.innerHTML = `
                <img src="${escapeHtml(safeUrl(currentUser.avatar_url))}" alt="" style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0;">
                <button type="button" class="account-avatar-edit" id="accountAvatarEditBtn" aria-label="Ganti foto profil">
                    <i class="fa-solid fa-camera"></i>
                </button>
            `;
        } else {
            accountAvatar.innerHTML = `
                ${escapeHtml(currentUser.fullname.charAt(0).toUpperCase())}
                <button type="button" class="account-avatar-edit" id="accountAvatarEditBtn" aria-label="Ganti foto profil">
                    <i class="fa-solid fa-camera"></i>
                </button>
            `;
        }
        document.getElementById("accountName").textContent = currentUser.fullname;
        document.getElementById("accountEmail").textContent = currentUser.email;
        attachAvatarUploadListeners();
    } else {
        accountBtn.querySelector("#accountBtnLabel").textContent = "Login";
        accountBtn.classList.remove("logged-in");
    }
}

function attachAvatarUploadListeners() {
    const editBtn = document.getElementById("accountAvatarEditBtn");
    const fileInput = document.getElementById("accountAvatarInput");
    if (!editBtn || !fileInput) return;
    
    editBtn.onclick = () => fileInput.click();
    fileInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        try {
            const token = localStorage.getItem(PUBLIC_TOKEN_STORAGE_KEY);
            if (!token) throw new Error("Silakan login terlebih dahulu");
            
            editBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            const formData = new FormData();
            formData.append("image", file);
            
            const uploadRes = await fetch(`${API_BASE}/upload?type=avatar`, {
                method: "POST",
                headers: { "Authorization": `Bearer ${token}` },
                body: formData
            });
            const uploadData = await uploadRes.json();
            if (!uploadRes.ok) throw new Error(uploadData.message || "Gagal upload gambar");
            
            const updateRes = await fetch(`${API_BASE}/users/me/avatar`, {
                method: "PUT",
                headers: { 
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}` 
                },
                body: JSON.stringify({ avatar_url: uploadData.url })
            });
            const updateData = await updateRes.json();
            if (!updateRes.ok) throw new Error(updateData.message || "Gagal update foto profil");
            
            currentUser.avatar_url = updateData.avatar_url;
            localStorage.setItem("nexshop_user", JSON.stringify(currentUser));
            refreshAccountUI();
            
            if (typeof showToast === 'function') {
                showToast("Sukses", "Foto profil berhasil diperbarui");
            } else {
                alert("Foto profil berhasil diperbarui");
            }
        } catch (err) {
            console.error("Avatar upload error:", err);
            alert("Gagal upload foto profil: " + err.message);
            editBtn.innerHTML = '<i class="fa-solid fa-camera"></i>';
        } finally {
            fileInput.value = "";
        }
    };
}

function toggleAccountMenu() {
    if (currentUser) {
        const open = accountDropdown.classList.toggle("active");
        accountBtn.setAttribute("aria-expanded", String(open));
    } else {
        openOverlay("authOverlay");
    }
}

accountBtn.addEventListener("click", toggleAccountMenu);
// #accountBtn adalah <div>, bukan <button>, jadi keyboard gak otomatis
// ngirim click. Tanpa ini tombol akun gak bisa dibuka pakai Tab + Enter.
accountBtn.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
    e.preventDefault();
    toggleAccountMenu();
});

document.addEventListener("click", (e) => {
    // BUG FIX (desktop): dulu pengecekannya `e.target !== accountBtn`.
    // #accountBtn punya anak (<i> ikon + <span> label nama), jadi begitu
    // user ngeklik ikon/labelnya -- yang justru bagian yang kelihatan --
    // e.target adalah anak itu, bukan #accountBtn sendiri. Listener klik
    // tombol membuka dropdown, lalu listener ini (yang jalan belakangan di
    // fase bubble pada event YANG SAMA) langsung nutup lagi. Efeknya
    // dropdown akun gak pernah kebuka. Sekarang dipakai closest() biar klik
    // di mana pun di dalam tombol dihitung sebagai klik tombolnya.
    const el = eventElement(e.target);
    if (!el) return;
    if (!accountDropdown.contains(el) && !el.closest("#accountBtn")) {
        accountDropdown.classList.remove("active");
        accountBtn.setAttribute("aria-expanded", "false");
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

const GOOGLE_OAUTH_MESSAGES = {
    cancelled: "Login Google dibatalkan.",
    invalid_state: "Sesi login Google tidak valid. Silakan coba lagi.",
    verification_failed: "Identitas Google tidak dapat diverifikasi. Silakan coba lagi.",
    google_email_unverified: "Email Google harus sudah terverifikasi untuk digunakan di NexShop.",
    account_link_required: "Email ini sudah memiliki akun NexShop. Masuk dengan password terlebih dahulu, lalu hubungkan Google dari menu akun.",
    google_already_linked: "Akun Google tersebut sudah terhubung ke akun NexShop lain.",
    link_email_mismatch: "Email Google harus sama dengan email akun NexShop yang sedang masuk.",
    provider_schema_missing: "Login Google belum siap di server. Hubungi admin NexShop.",
    not_configured: "Login Google belum dikonfigurasi. Silakan gunakan email dan password.",
    access_denied: "Akun ini tidak dapat menggunakan login Google."
};

async function initAuthSecurity() {
    const security = window.NexShopAuthSecurity;
    if (!security) return;

    await Promise.all([
        security.mountCaptcha("login", "loginTurnstile", "loginTurnstileStatus"),
        security.mountCaptcha("register", "registerTurnstile", "registerTurnstileStatus")
    ]);

    const beginGoogle = async () => {
        const errorEl = document.getElementById("loginError");
        errorEl.textContent = "";
        try {
            await security.beginGoogle("login");
        } catch (error) {
            errorEl.textContent = error.message || "Login Google belum dapat dimulai.";
        }
    };
    document.getElementById("googleLoginBtn")?.addEventListener("click", beginGoogle);
    document.getElementById("googleRegisterBtn")?.addEventListener("click", beginGoogle);

    document.getElementById("linkGoogleBtn")?.addEventListener("click", async () => {
        const token = localStorage.getItem(PUBLIC_TOKEN_STORAGE_KEY);
        if (!token) return;
        try {
            await security.beginGoogle("link", token);
        } catch (error) {
            toast(error.message || "Google belum dapat dihubungkan.", "error");
        }
    });

    await security.consumeGoogleCallback((data, mode) => {
        localStorage.setItem(PUBLIC_TOKEN_STORAGE_KEY, data.token);
        currentUser = data.user;
        saveUser();
        switchCartContext();
        refreshAccountUI();
        if (mode === "link") {
            toast("Akun Google berhasil dihubungkan.", "success");
            return;
        }
        if (!currentUser.phone) {
            openOverlay("phoneOverlay");
        } else {
            toast(`Berhasil masuk. Selamat datang, ${currentUser.fullname}!`, "success");
        }
    }, (error) => {
        const errorEl = document.getElementById("loginError");
        errorEl.textContent = GOOGLE_OAUTH_MESSAGES[error] || error || "Login Google tidak dapat diselesaikan.";
        openOverlay("authOverlay");
    });
}

initAuthSecurity();

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

document.getElementById("regOtpMethod")?.addEventListener("change", (e) => {
    document.getElementById("regWhatsappContainer").style.display = e.target.value === "whatsapp" ? "block" : "none";
});

document.getElementById("registerForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fullname = document.getElementById("regName").value.trim();
    const email = document.getElementById("regEmail").value.trim().toLowerCase();
    const password = document.getElementById("regPassword").value;
    const otp_method = document.getElementById("regOtpMethod").value;
    const whatsapp = document.getElementById("regWhatsapp").value.trim();
    const errorEl = document.getElementById("regError");

    try {
        const captcha_token = window.NexShopAuthSecurity
            ? await window.NexShopAuthSecurity.captchaToken("register")
            : "";
        const res = await fetch(`${API_BASE}/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fullname, email, password, otp_method, whatsapp, captcha_token })
        });
        const data = await res.json();

        if (!res.ok) {
            errorEl.textContent = data.message;
            window.NexShopAuthSecurity?.resetCaptcha("register");
            return;
        }
        errorEl.textContent = "";
        window.NexShopAuthSecurity?.resetCaptcha("register");
        e.target.reset();
        showOtpForm(email, data.otp_method || otp_method);
        toast(`Cek ${data.otp_method === "whatsapp" ? "WhatsApp" : "email"} kamu untuk kode verifikasi.`, "success");
    } catch (err) {
        errorEl.textContent = "Gagal terhubung ke server.";
    }
});

let currentOtpMethod = "email";

function showOtpForm(email, method = "email") {
    currentOtpMethod = method;
    document.querySelectorAll(".auth-tab").forEach(t => t.classList.remove("active"));
    document.getElementById("loginForm").classList.add("hidden");
    document.getElementById("registerForm").classList.add("hidden");
    document.getElementById("otpForm").classList.remove("hidden");
    document.getElementById("otpEmail").value = email;
    document.getElementById("otpEmailLabel").textContent = method === "whatsapp" ? "WhatsApp" : email;
    
    const spamNotice = document.getElementById("otpSpamNotice");
    if (spamNotice) spamNotice.style.display = method === "whatsapp" ? "none" : "inline";

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
            body: JSON.stringify({ email, otp_method: currentOtpMethod })
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
        const captcha_token = window.NexShopAuthSecurity
            ? await window.NexShopAuthSecurity.captchaToken("login")
            : "";
        const res = await fetch(`${API_BASE}/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password, captcha_token })
        });
        const data = await res.json();

        if (!res.ok) {
            window.NexShopAuthSecurity?.resetCaptcha("login");
            if (data.needsVerification) {
                errorEl.textContent = "";
                showOtpForm(data.email || email);
                toast("Email belum diverifikasi. Cek kode OTP kamu.");
                return;
            }
            errorEl.textContent = data.message;
            return;
        }
        window.NexShopAuthSecurity?.resetCaptcha("login");
        localStorage.setItem(PUBLIC_TOKEN_STORAGE_KEY, data.token);
        currentUser = data.user;
        saveUser();
        switchCartContext();
        refreshAccountUI();
        
        if (!currentUser.phone) {
            closeOverlay("authOverlay");
            openOverlay("phoneOverlay");
        } else {
            closeOverlay("authOverlay");
            toast(`Berhasil masuk. Selamat datang kembali, ${data.user.fullname}!`, "success");
        }
        e.target.reset();
    } catch (err) {
        errorEl.textContent = "Gagal terhubung ke server.";
    }
});

document.getElementById("phoneForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const phone = document.getElementById("userPhoneInput").value.trim();
    const errorEl = document.getElementById("phoneError");
    const btn = document.getElementById("phoneSubmitBtn");
    
    errorEl.textContent = "";
    btn.disabled = true;
    btn.textContent = "Menyimpan...";
    
    try {
        const token = localStorage.getItem(PUBLIC_TOKEN_STORAGE_KEY);
        const res = await fetch(`${API_BASE}/users/me/phone`, {
            method: "PUT",
            headers: { 
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}` 
            },
            body: JSON.stringify({ phone })
        });
        const data = await res.json();
        
        if (!res.ok) {
            errorEl.textContent = data.message || "Gagal menyimpan nomor WA.";
            return;
        }
        
        if (currentUser) {
            currentUser.phone = data.phone;
            saveUser();
        }
        
        closeOverlay("phoneOverlay");
        toast("Nomor WhatsApp berhasil disimpan!", "success");
        e.target.reset();
        
        // Also pre-fill & hide the field if checkout is open (nomor sudah tersimpan, ga perlu ditampilin lagi)
        const checkoutPhone = document.getElementById("checkoutPhone");
        if (checkoutPhone) {
            checkoutPhone.value = data.phone;
            checkoutPhone.parentElement.classList.add("hidden");
        }
        const twPhone = document.getElementById("twPhone");
        if (twPhone) {
            twPhone.value = data.phone;
            twPhone.closest(".tw-field-group").classList.add("hidden");
        }
        
    } catch (err) {
        errorEl.textContent = "Gagal terhubung ke server.";
    } finally {
        btn.disabled = false;
        btn.textContent = "Simpan Nomor WA";
    }
});

document.getElementById("logoutBtn").addEventListener("click", () => {
    currentUser = null;
    saveUser();
    localStorage.removeItem(PUBLIC_TOKEN_STORAGE_KEY);

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
let checkoutVaBank = "bca";

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
        ${method.id === "va" && selectedPaymentMethod === "va" ? `
            <div class="mt-1 mb-4 p-4 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50/50 dark:bg-white/5">
                <label class="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-3">Pilih Bank</label>
                <div class="grid grid-cols-2 min-[400px]:grid-cols-3 gap-2">
                    ${['bca', 'bni', 'mandiri', 'bri', 'cimb'].map(bank => `
                        <label class="relative flex items-center justify-center p-3 border-2 rounded-lg cursor-pointer transition-all duration-200 ${checkoutVaBank === bank ? 'border-brand-indigo bg-brand-indigo/10 dark:bg-brand-indigo/20 text-brand-indigo dark:text-brand-cyan' : 'border-gray-200 dark:border-white/10 hover:border-gray-300 dark:hover:border-white/20 text-gray-700 dark:text-gray-400'}">
                            <input type="radio" name="checkoutVaBankRadio" value="${bank}" ${checkoutVaBank === bank ? 'checked' : ''} class="hidden">
                            <span class="text-sm font-bold uppercase tracking-wider">${bank === 'cimb' ? 'CIMB' : bank}</span>
                        </label>
                    `).join('')}
                </div>
            </div>
        ` : ''}
    `).join("");

    grid.querySelectorAll("[data-payment-method]").forEach((card) => {
        card.addEventListener("click", () => {
            selectedPaymentMethod = card.dataset.paymentMethod;
            renderCheckoutPaymentMethods();
        });
    });

    grid.querySelectorAll("input[name='checkoutVaBankRadio']").forEach((radio) => {
        radio.addEventListener("change", (e) => {
            checkoutVaBank = e.target.value;
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
        ${appliedPromo ? `<div class="row discount"><span>Diskon (${escapeHtml(appliedPromo.code)})</span><span>-${rupiah(discount)}</span></div>` : ""}
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
        let cleanPhone = currentUser.phone || "";
        cleanPhone = cleanPhone.replace(/[^0-9]/g, "");
        if (cleanPhone.startsWith("62")) {
            // Keep 62
        } else if (!cleanPhone.startsWith("0") && cleanPhone.length > 5) {
            cleanPhone = "0" + cleanPhone; // Fallback to 0 if they entered like 8222...
        }
        
        if (cleanPhone && /^(0|62)[0-9]{8,14}$/.test(cleanPhone)) {
            document.getElementById("checkoutPhone").value = cleanPhone;
            document.getElementById("checkoutPhone").parentElement.classList.add("hidden");
        } else {
            document.getElementById("checkoutPhone").value = currentUser.phone || "";
            document.getElementById("checkoutPhone").parentElement.classList.remove("hidden");
        }
    } else {
        document.getElementById("checkoutName").value = "";
        document.getElementById("checkoutEmail").value = "";
        document.getElementById("checkoutPhone").value = "";
        document.getElementById("checkoutPhone").parentElement.classList.remove("hidden");
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
    const recipient_phone = document.getElementById("checkoutPhone").value.trim();
    const token = localStorage.getItem(PUBLIC_TOKEN_STORAGE_KEY);

    if (!/^(0|62)[0-9]{8,14}$/.test(recipient_phone)) {
        toast("Masukkan nomor HP yang valid (contoh: 081234567890).", "error");
        return;
    }
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
                recipient_phone,
                payment_method: selectedPaymentMethod,
                payment_channel: checkoutVaBank,
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

        if (data.flow === "direct" && data.paymentData) {
            showDirectPaymentModal(data.paymentData, data.orderId, false);
        } else if (data.paymentUrl) {
            openIpaymuPopup(data.paymentUrl, data.orderId, false);
        } else {
            toast("Data pembayaran tidak valid dari server.", "error");
            submitBtn.disabled = false;
            submitBtn.textContent = "Bayar Sekarang";
        }
    } catch (err) {
        toast("Gagal terhubung ke server.", "error");
        submitBtn.disabled = false;
        submitBtn.textContent = "Bayar Sekarang";
    }
});

async function showPaidOrderSuccess(orderData, isTopup) {
    if (isTopup || (orderData.status !== "paid" && orderData.status !== "sukses")) return;

    const orderId = orderData.id || orderData.orderId || orderData.reference_id;
    const trackingNote = currentUser
        ? `Kamu bisa cek status di "Pesanan Saya".`
        : `<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Kamu checkout tanpa akun — catat Order ID ini baik-baik, karena tidak tersimpan di riwayat manapun: <strong>${escapeHtml(orderId)}</strong>`;

    document.getElementById("checkoutSuccessMsg").innerHTML =
        `Terima kasih, pesanan kamu senilai ${rupiah(orderData.total || 0)} telah lunas. ${trackingNote}`;

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

    // Render rating ke dalam #ratingCard di success overlay
    const ratingCard = document.getElementById("ratingCard");
    if (ratingCard) {
        await renderRatingPrompt(orderData, ratingCard);
    }
}

// ---------------------------------------------------------------------------
// renderRatingPrompt(orderData, container)
// ---------------------------------------------------------------------------
// Fungsi reusable tunggal untuk seluruh lifecycle rating:
//   • Selalu cek backend (source of truth — bukan localStorage)
//   • Render UI ke container manapun (success overlay, track modal, dll.)
//   • Cegah duplicate listener karena innerHTML di-reset setiap kali
//   • Tampilkan "sudah dirating" jika backend menyatakan already_rated
//   • Token diambil dari PUBLIC_TOKEN_STORAGE_KEY (bukan "token")
// ---------------------------------------------------------------------------
async function renderRatingPrompt(orderData, container) {
    if (!container || !orderData) return;

    // FEATURE (Agustus 2026): topup sekarang juga bisa dirating (lihat
    // topup_ratings di ratingController.js) -- sebelumnya fungsi ini
    // langsung `return` untuk type "topup". isTopup dipakai di bawah untuk
    // milih endpoint eligibility/submit yang benar (order vs topup pakai
    // tabel & rute backend yang beda).
    const isTopup = orderData.type === "topup";
    const orderId = orderData.id || orderData.orderId || orderData.reference_id;
    if (!orderId) return;

    // Hanya untuk order yang sudah dibayar
    const isPaid = orderData.status === "paid" || orderData.status === "sukses";
    if (!isPaid) return;

    // Ambil token dengan key yang benar — seluruh app pakai PUBLIC_TOKEN_STORAGE_KEY
    const headers = {};
    const token = localStorage.getItem(PUBLIC_TOKEN_STORAGE_KEY);
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const eligibilityUrl = isTopup
        ? `${API_BASE}/ratings/topup/eligibility/${encodeURIComponent(orderId)}`
        : `${API_BASE}/ratings/eligibility/${encodeURIComponent(orderId)}`;

    let eligibility;
    try {
        const res = await fetch(eligibilityUrl, { headers });
        if (!res.ok) {
            // 401 = tidak login tapi order punya user_id
            // 403 = bukan pemilik order
            // 404 = order tidak ditemukan
            // 500 = server error
            // Jangan tampilkan rating palsu untuk semua kasus ini.
            console.warn(`[Rating] eligibility HTTP ${res.status} untuk order ${orderId}`);
            return;
        }
        eligibility = await res.json();
    } catch (err) {
        console.error("[Rating] Gagal cek eligibility:", err);
        return;
    }

    // Buat uid unik supaya elemen dari berbagai container tidak bentrok
    const uid = orderId.replace(/[^a-zA-Z0-9]/g, "");

    if (!eligibility.eligible) {
        if (eligibility.reason === "already_rated") {
            // Tampilkan status "sudah dirating" agar user tahu
            container.innerHTML = `
                <div style="text-align:center;padding:0.75rem 0;color:var(--text-muted);font-size:0.95rem;">
                    <i class="fa-solid fa-star-half-stroke" style="color:#facc15;margin-right:0.4rem;"></i>
                    Rating sudah diberikan untuk pesanan ini. Terima kasih!
                </div>`;
            container.classList.remove("hidden");
        }
        // Untuk reason lain (order_not_paid dll.) tidak perlu tampilkan apapun
        return;
    }

    // Inject HTML rating form sepenuhnya ke container
    // (innerHTML di-reset sehingga tidak ada duplicate listener lama)
    container.innerHTML = `
        <h4 style="margin-bottom:0.5rem;font-size:1.05rem;color:var(--text);"><i class="fa-solid fa-star" aria-hidden="true"></i> Bagaimana pengalamanmu berbelanja di NexShop?</h4>
        <p style="color:var(--text-muted);font-size:0.88rem;margin-bottom:1rem;">Masukan kamu membantu kami meningkatkan layanan.</p>
        <div id="rp_stars_${uid}" style="display:flex;justify-content:center;gap:0.5rem;margin-bottom:1rem;">
            ${[1,2,3,4,5].map(n => `
                <button type="button" class="rp-star" data-score="${n}" aria-label="Bintang ${n}"
                    style="background:transparent;border:none;color:var(--text-muted);font-size:1.5rem;cursor:pointer;padding:0.15rem;">
                    <i class="fa-regular fa-star"></i>
                </button>`).join("")}
        </div>
        <div id="rp_form_${uid}" class="hidden">
            ${isTopup ? `
            <input id="rp_name_${uid}" type="text" maxlength="60"
                placeholder="Nama kamu (opsional, tampil di testimoni)"
                style="width:100%;padding:0.65rem 0.75rem;border-radius:8px;border:1px solid var(--line);
                       background:var(--bg-body);color:var(--text);margin-bottom:0.6rem;
                       font-family:inherit;font-size:0.92rem;box-sizing:border-box;">
            ` : ""}
            <label style="display:flex;align-items:flex-start;gap:0.5rem;margin-bottom:0.75rem;
                   font-size:0.85rem;color:var(--text-muted);cursor:pointer;">
                <input type="checkbox" id="rp_showname_${uid}" style="margin-top:0.2rem;flex-shrink:0;">
                <span>Tampilkan nama saya apa adanya di testimoni publik. Jika tidak dicentang, nama akan otomatis disensor (contoh: "Budi S.").</span>
            </label>
            <textarea id="rp_txt_${uid}" placeholder="Ceritakan pengalamanmu (opsional)" maxlength="500"
                style="width:100%;min-height:80px;padding:0.75rem;border-radius:8px;border:1px solid var(--line);
                       background:var(--bg-body);color:var(--text);margin-bottom:0.5rem;
                       resize:vertical;font-family:inherit;font-size:0.92rem;box-sizing:border-box;"></textarea>
            <div style="text-align:right;color:var(--text-muted);font-size:0.8rem;margin-bottom:1rem;">
                <span id="rp_cnt_${uid}">0</span>/500
            </div>
            <div id="rp_err_${uid}" class="hidden"
                style="color:var(--danger);font-size:0.9rem;margin-bottom:1rem;"></div>
            <div style="display:flex;gap:0.5rem;justify-content:center;">
                <button type="button" id="rp_submit_${uid}" class="btn-primary" style="flex:1;">Kirim Rating</button>
                <button type="button" id="rp_skip_${uid}" class="btn-secondary" style="flex:1;">Nanti saja</button>
            </div>
        </div>
        <div id="rp_done_${uid}" class="hidden"
            style="color:var(--success);font-weight:600;font-size:1.05rem;text-align:center;margin-top:1rem;">
            <i class="fa-solid fa-check-circle" style="margin-right:0.5rem;"></i>Terima kasih atas penilaian Anda!
        </div>
    `;
    container.classList.remove("hidden");

    // ADDITIONAL BUG FIX (audit): baris-baris di bawah sebelumnya memakai
    // document.getElementById(`rp_xxx_${uid}`) -- pencarian GLOBAL di
    // seluruh dokumen. uid dibuat dari orderId, jadi kalau order yang SAMA
    // sedang ditampilkan di DUA tempat sekaligus (mis. popup sukses
    // checkout MASIH terbuka, lalu user juga membuka "Cek Transaksi" dan
    // memasukkan Order ID yang sama), akan ada dua elemen dengan id
    // "rp_form_<uid>" dkk di DOM secara bersamaan.
    // document.getElementById() hanya mengembalikan elemen PERTAMA yang
    // match -- jadi form/tombol di modal kedua bisa salah sasaran
    // memanipulasi elemen milik modal pertama (klik bintang di satu modal
    // bisa membuka form rating di modal yang lain). Diganti jadi
    // container.querySelector(...) supaya lookup selalu scoped ke
    // container ini saja, terlepas dari duplikasi id di tempat lain.
    let selectedScore = 0;
    const stars   = container.querySelectorAll(".rp-star");
    const form    = container.querySelector(`#rp_form_${uid}`);
    const errDiv  = container.querySelector(`#rp_err_${uid}`);
    const txtArea = container.querySelector(`#rp_txt_${uid}`);
    const charCnt = container.querySelector(`#rp_cnt_${uid}`);
    const doneDiv = container.querySelector(`#rp_done_${uid}`);
    const starsWrap = container.querySelector(`#rp_stars_${uid}`);

    stars.forEach(star => {
        star.onclick = () => {
            selectedScore = parseInt(star.dataset.score, 10);
            stars.forEach(s => {
                s.innerHTML = parseInt(s.dataset.score, 10) <= selectedScore
                    ? '<i class="fa-solid fa-star" style="color:#facc15"></i>'
                    : '<i class="fa-regular fa-star"></i>';
            });
            form.classList.remove("hidden");
            errDiv.classList.add("hidden");
        };
    });

    if (txtArea) txtArea.oninput = () => { if (charCnt) charCnt.textContent = txtArea.value.length; };

    const skipBtn = container.querySelector(`#rp_skip_${uid}`);
    if (skipBtn) skipBtn.onclick = () => { container.classList.add("hidden"); };

    const nameInput = isTopup ? container.querySelector(`#rp_name_${uid}`) : null;
    const showNameInput = container.querySelector(`#rp_showname_${uid}`);
    const submitBtn = container.querySelector(`#rp_submit_${uid}`);
    if (submitBtn) {
        submitBtn.onclick = async () => {
            if (selectedScore < 1) {
                errDiv.textContent = "Pilih bintang terlebih dahulu.";
                errDiv.classList.remove("hidden");
                return;
            }
            submitBtn.disabled = true;
            submitBtn.textContent = "Mengirim...";
            errDiv.classList.add("hidden");

            try {
                const subHeaders = { "Content-Type": "application/json" };
                const subToken = localStorage.getItem(PUBLIC_TOKEN_STORAGE_KEY);
                if (subToken) subHeaders["Authorization"] = `Bearer ${subToken}`;

                const submitUrl = isTopup ? `${API_BASE}/ratings/topup` : `${API_BASE}/ratings`;
                const submitBody = {
                    order_id: orderId,
                    score: selectedScore,
                    comment: txtArea?.value.trim() || undefined,
                    show_name: !!showNameInput?.checked
                };
                if (isTopup) submitBody.display_name = nameInput?.value.trim() || undefined;

                const subRes = await fetch(submitUrl, {
                    method: "POST",
                    headers: subHeaders,
                    body: JSON.stringify(submitBody)
                });

                if (!subRes.ok) {
                    const errData = await subRes.json().catch(() => ({}));
                    throw new Error(errData.message || "Gagal mengirim rating");
                }

                // Tampilkan state sukses
                if (starsWrap) starsWrap.style.display = "none";
                form.classList.add("hidden");
                doneDiv.classList.remove("hidden");

            } catch (err) {
                errDiv.textContent = err.message;
                errDiv.classList.remove("hidden");
                submitBtn.disabled = false;
                submitBtn.textContent = "Kirim Rating";
            }
        };
    }
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
    if (document.getElementById("policyLegal")) {
        document.getElementById("policyLegal").classList.toggle("hidden", tab !== "legal");
    }
    openOverlay("policyOverlay");
}

document.querySelectorAll("[data-policy-tab]").forEach(btn => {
    btn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openPolicy(btn.dataset.policyTab);
    });
});

// URL publik /legalitas tetap memakai modal legalitas homepage, tetapi URL
// kanoniknya bersih dan bisa dibagikan langsung tanpa ekstensi .html.
if (["/legalitas", "/legalitas/"].includes(window.location.pathname)) {
    openPolicy("legal");
}

/* ---------- NexShop News (artikel editorial) ---------- */
function formatNewsDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("id-ID", {
        day: "numeric", month: "short", year: "numeric"
    }).format(date);
}

function renderNexshopNewsSkeleton() {
    const section = document.getElementById("news");
    const grid = document.getElementById("newsGrid");
    if (!section || !grid) return;
    section.classList.remove("hidden");
    grid.innerHTML = Array.from({ length: 9 }, () => `
        <article class="bg-white dark:bg-[#0a0a0c] rounded-2xl overflow-hidden border border-gray-200 dark:border-white/5 flex flex-col" aria-label="Memuat berita">
            <div class="w-full aspect-video bg-gray-200 dark:bg-white/5 animate-pulse"></div>
            <div class="p-6 flex flex-col flex-1 gap-4">
                <div class="flex items-center gap-2">
                    <div class="w-6 h-6 rounded-full bg-gray-200 dark:bg-white/10 animate-pulse"></div>
                    <div class="w-20 h-4 bg-gray-200 dark:bg-white/10 animate-pulse rounded"></div>
                </div>
                <div class="w-full h-6 bg-gray-200 dark:bg-white/10 animate-pulse rounded"></div>
                <div class="w-3/4 h-6 bg-gray-200 dark:bg-white/10 animate-pulse rounded mb-2"></div>
                <div class="w-full h-4 bg-gray-200 dark:bg-white/5 animate-pulse rounded"></div>
                <div class="w-full h-4 bg-gray-200 dark:bg-white/5 animate-pulse rounded"></div>
                <div class="mt-auto w-24 h-4 bg-gray-200 dark:bg-white/10 animate-pulse rounded"></div>
            </div>
        </article>`).join("");
}

function renderNexshopNews(items) {
    const section = document.getElementById("news");
    const grid = document.getElementById("newsGrid");
    if (!section || !grid) return;
    
    if (!Array.isArray(items) || !items.length) {
        section.classList.remove("hidden");
        grid.innerHTML = `<div class="col-span-full text-center text-gray-500 py-10 text-sm font-medium">Belum ada berita terbaru.</div>`;
        return;
    }
    
    grid.innerHTML = items.map((item) => {
        const imageUrl = safeUrl(item.image_url) || "/images/placeholder-news.jpg";
        const category = String(item.category || "Berita");
        
        return `
            <a href="/berita/${encodeURIComponent(item.slug)}" class="group relative home-glass-card rounded-2xl overflow-hidden flex flex-col no-underline text-left transition-all duration-300">
                <div class="relative w-full aspect-video overflow-hidden bg-transparent">
                    <img src="${escapeHtml(imageUrl)}" alt="" class="w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-700" loading="lazy" decoding="async">
                    <div class="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent pointer-events-none"></div>
                    <div class="absolute bottom-3 left-4 z-10">
                        <span class="home-glass-badge">
                            ${escapeHtml(category)}
                        </span>
                    </div>
                </div>
                <div class="p-5 flex flex-col flex-1 relative z-10">
                    <div class="flex items-center gap-2 mb-2 text-xs text-gray-500 dark:text-gray-400 font-medium">
                        <i class="fa-regular fa-calendar-alt"></i>
                        <span>${escapeHtml(formatNewsDate(item.published_at))}</span>
                    </div>
                    <h4 class="text-lg font-bold text-gray-900 dark:text-white mb-2 line-clamp-2 group-hover:text-brand-indigo transition-colors leading-snug">
                        ${escapeHtml(item.title)}
                    </h4>
                    <p class="text-sm text-gray-600 dark:text-gray-400 line-clamp-2 mb-5 leading-relaxed">
                        ${escapeHtml(item.excerpt || item.title)}
                    </p>
                    <div class="mt-auto flex items-center justify-between text-sm font-bold text-brand-indigo group-hover:text-brand-cyan transition-colors">
                        <span>Baca Selengkapnya</span>
                        <div class="w-8 h-8 rounded-full bg-brand-indigo/10 flex items-center justify-center group-hover:bg-brand-indigo/20 transition-colors">
                            <i class="fa-solid fa-arrow-right text-xs"></i>
                        </div>
                    </div>
                </div>
            </a>
        `;
    }).join("");
    section.classList.remove("hidden");
}

async function loadNexshopNews() {
    renderNexshopNewsSkeleton();
    try {
        // Ambil artikel terbaru LINTAS SEMUA KATEGORI, jangan difilter
        // per kategori: ARTICLE_CATEGORIES punya 10 kategori (Esports,
        // Gaming, Xbox, PlayStation, PC, Mobile, dst), dan filter kategori
        // bikin artikel yang ditag selain satu kategori itu gak pernah
        // nongol di homepage walau sudah published dan tampil normal di
        // portal berita (berita.html juga gak filter kategori).
        // Tampil 9 biar grid 3 kolomnya penuh.
        const res = await fetch(`${API_BASE}/news/articles?limit=9`);
        if (!res.ok) throw new Error("Gagal memuat berita game");
        const json = await res.json();
        const articles = Array.isArray(json.data) ? json.data.slice(0, 9) : [];
        renderNexshopNews(articles);
    } catch (err) {
        console.error("loadNexshopNews error:", err);
        renderNexshopNews([]);
    }
}

/* ---------- FEATURE: "Apa Kata Mereka" testimonial marquee ---------- */
// Ambil inisial buat avatar bulat (mis. "Budi S." -> "BS", "Pembeli Topup" -> "P").
function testimonialInitials(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function testimonialCardHtml(item) {
    const score = Math.max(1, Math.min(5, parseInt(item.score, 10) || 5));
    const stars = '<i class="fa-solid fa-star" aria-hidden="true"></i>'.repeat(score)
        + '<i class="fa-regular fa-star" aria-hidden="true"></i>'.repeat(5 - score);
    // Testimoni kustom (dibuat admin dari dashboard) bisa punya foto profil
    // asli (item.avatar) -- kalau ada, tampilkan foto itu; kalau tidak
    // (rating asli dari pembeli), fallback ke inisial seperti sebelumnya.
    const avatarHtml = item.avatar
        ? `<img class="testimonial-card__avatar" src="${escapeHtml(item.avatar)}" alt="" loading="lazy">`
        : `<div class="testimonial-card__avatar" aria-hidden="true">${escapeHtml(testimonialInitials(item.name))}</div>`;
    // .home-glass-card = design system glassmorphism yang sama dipakai kartu
    // News/Produk di halaman ini -- supaya kartu testimoni konsisten visual,
    // bukan gaya kartu baru sendiri.
    return `
        <div class="testimonial-card home-glass-card rounded-2xl" tabindex="0">
            <div class="testimonial-card__stars" aria-label="${score} dari 5 bintang">${stars}</div>
            <p class="testimonial-card__comment">${escapeHtml(item.comment || "")}</p>
            <div class="testimonial-card__footer">
                ${avatarHtml}
                <div class="testimonial-card__meta">
                    <div class="testimonial-card__name">${escapeHtml(item.name || "Pembeli NexShop")}</div>
                    <div class="testimonial-card__context">${escapeHtml(item.context || "")}</div>
                </div>
            </div>
        </div>`;
}

function renderTestimonials(items) {
    const section = document.getElementById("testimonials");
    const row1 = document.getElementById("testimonialRow1");
    const row2 = document.getElementById("testimonialRow2");
    if (!section || !row1 || !row2) return;

    // Tidak ada testimoni sama sekali -> section tetap hidden (bukan
    // ditampilkan kosong/skeleton kosong). Beda dari #news yang selalu
    // nampilin section (dengan pesan "belum ada berita") -- testimoni
    // kosong lebih baik tidak usah muncul sama sekali daripada terlihat sepi.
    if (!Array.isArray(items) || items.length === 0) {
        section.classList.add("hidden");
        return;
    }

    // Split jadi 2 baris (ganjil/genap) supaya dua baris kelihatan beda
    // walau sumber datanya sama, lalu tiap baris DIDUPLIKASI 2x (bukan cuma
    // dirender sekali) -- ini kuncinya biar animasi translateX(-50%) di CSS
    // looping mulus tanpa "patahan" begitu sampai ujung.
    const row1Items = items.filter((_, i) => i % 2 === 0);
    const row2Items = items.filter((_, i) => i % 2 === 1);

    // Baris butuh minimal beberapa card supaya lebar totalnya cukup buat
    // animasi looping terasa "penuh" (bukan cuma 1-2 card doang yang keulang).
    // Kalau testimoni yang eligible dikit banget, ulang list itu sendiri
    // dulu sebelum diduplikasi buat animasi.
    const padRow = (arr) => {
        if (arr.length === 0) return items; // fallback: baris kosong isi dari gabungan semua
        let padded = [...arr];
        while (padded.length < 6) padded = padded.concat(arr);
        return padded;
    };

    const finalRow1 = padRow(row1Items.length ? row1Items : items);
    const finalRow2 = padRow(row2Items.length ? row2Items : items);

    row1.innerHTML = finalRow1.map(testimonialCardHtml).join("") + finalRow1.map(testimonialCardHtml).join("");
    row2.innerHTML = finalRow2.map(testimonialCardHtml).join("") + finalRow2.map(testimonialCardHtml).join("");

    section.classList.remove("hidden");
}

// Klik salah satu kartu testimoni -> overlay "spotlight" muncul BESAR DI
// TENGAH LAYAR nampilin testimoni itu (bukan scale kartu aslinya di
// tempat seperti sebelumnya -- lihat komentar panjang di CSS
// .testimonial-card & .testimonial-spotlight kenapa pendekatan lama
// diganti: dulu transform scale-nya ketimpa sama .home-glass-card:hover
// yang specificity-nya lebih tinggi, jadi animasinya cuma keliatan kalau
// cursor dijauhin dulu, dan mentok di mobile karena :hover nyangkut abis
// tap; scale itu juga bikin kartu nabrak baris satunya).
// Marquee auto-scroll di-pause selama overlay terbuka. Klik kartu lain
// saat overlay masih terbuka -> konten overlay langsung ganti ke
// testimoni yang baru diklik. Tutup lewat: klik backdrop, tombol close,
// tombol Escape, atau klik kartu sumber yang sama lagi.
// Pakai event delegation di #testimonialMarquee (bukan pasang listener per
// kartu) supaya tetap jalan walau kartu-nya di-render ulang oleh
// renderTestimonials/loadTestimonials.
(function setupTestimonialSpotlight() {
    const marquee = document.getElementById("testimonialMarquee");
    const overlay = document.getElementById("testimonialSpotlightOverlay");
    const spotlightBody = document.getElementById("testimonialSpotlightBody");
    if (!marquee || !overlay || !spotlightBody) return;

    let sourceCard = null;

    function clearSourceHighlight() {
        if (sourceCard) sourceCard.classList.remove("testimonial-card--active");
        sourceCard = null;
    }

    // Overlay-nya dibuka/ditutup lewat openOverlay()/closeOverlay() yang
    // sudah ada (lihat definisinya di atas) -- gratis dapet focus-trap,
    // body-scroll-lock, Escape-to-close, & klik backdrop-to-close yang
    // udah dipakai modal lain di project ini, gak perlu nulis ulang.
    // Yang testimonial-spesifik cuma: isi overlay, ring highlight di
    // kartu sumber, & pause/resume marquee -- makanya dipantau lewat
    // MutationObserver di class "active" overlay ini (bukan nimpa
    // closeOverlay), jadi tetap "nyambung" mau ditutup lewat cara apapun
    // (tombol X, klik backdrop, ataupun Escape).
    const observer = new MutationObserver(() => {
        if (!overlay.classList.contains("active")) {
            clearSourceHighlight();
            marquee.classList.remove("is-paused");
        }
    });
    observer.observe(overlay, { attributes: true, attributeFilter: ["class"] });

    function openSpotlight(card) {
        const reopeningSame = sourceCard === card && overlay.classList.contains("active");
        if (reopeningSame) {
            closeOverlay("testimonialSpotlightOverlay");
            return;
        }
        clearSourceHighlight();
        sourceCard = card;
        card.classList.add("testimonial-card--active");
        spotlightBody.innerHTML = card.innerHTML;
        marquee.classList.add("is-paused"); // hentikan animasi geser selagi overlay kebuka
        openOverlay("testimonialSpotlightOverlay");
    }

    marquee.addEventListener("click", (e) => {
        const card = closestFromEvent(e.target, ".testimonial-card");
        if (!card || !marquee.contains(card)) return;
        openSpotlight(card);
    });

    // Kartu punya tabindex="0" (aksesibilitas) -- Enter/Space di kartu yang
    // lagi fokus keyboard juga buka spotlight, konsisten sama klik mouse.
    marquee.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        const card = closestFromEvent(e.target, ".testimonial-card");
        if (!card || !marquee.contains(card)) return;
        e.preventDefault();
        openSpotlight(card);
    });
})();

async function loadTestimonials() {
    try {
        const res = await fetch(`${API_BASE}/ratings/public/testimonials?limit=20`);
        if (!res.ok) throw new Error("Gagal memuat testimoni");
        const items = await res.json();
        renderTestimonials(Array.isArray(items) ? items : []);
    } catch (err) {
        console.error("loadTestimonials error:", err);
        renderTestimonials([]);
    }
}

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
        // Kode/SN: kalau ini token PLN Prabayar, backend udah misahin jadi
        // token_number (20 digit yang HARUS dimasukin ke meteran) & token_keterangan
        // (nama pelanggan/daya/tarif/kwh) -- ditampilin sebagai "No Token" &
        // "Keterangan" terpisah, bukan satu baris mentah gabungan kayak
        // sebelumnya. Produk lain yang keluarin kode/SN (voucher game, dst)
        // tetap tampil sebagai baris "Kode/SN" biasa.
        let serialHtml = "";
        if (data.token_number) {
            serialHtml = `
                <div class="track-token-box">
                    <div class="row"><span>No Token</span><span>${escapeHtml(data.token_number)}</span></div>
                    ${data.token_keterangan ? `<div class="row"><span>Keterangan</span><span>${escapeHtml(data.token_keterangan)}</span></div>` : ""}
                    ${data.serial_instruction ? `<div class="track-token-note"><i class="fa-solid fa-circle-info"></i><span>${escapeHtml(data.serial_instruction)}</span></div>` : ""}
                </div>
            `;
        } else if (data.serial_number) {
            serialHtml = `
                <div class="track-token-box">
                    <div class="row"><span>Kode/SN</span><span>${escapeHtml(data.serial_number)}</span></div>
                    ${data.serial_instruction ? `<div class="track-token-note"><i class="fa-solid fa-circle-info"></i><span>${escapeHtml(data.serial_instruction)}</span></div>` : ""}
                </div>
            `;
        }

        itemsHtml = `
            <div class="row"><span>Produk</span><span>${escapeHtml(data.nama_produk || "-")}</span></div>
            <div class="row"><span>${escapeHtml(data.target_label || "User ID")}</span><span>${escapeHtml(String(data.tujuan || "-"))}${data.server_id ? " (" + escapeHtml(String(data.server_id)) + ")" : ""}</span></div>
            ${serialHtml}
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
        const prefill = `Halo admin, saya sudah bayar pesanan dengan No. Transaksi ${data.id}. Saya akan melampirkan bukti pembayaran iPaymu di chat ini. Mohon diproses ya, terima kasih.`;
        const waHref = `https://wa.me/${waDigits}?text=${encodeURIComponent(prefill)}`;
        waCta = `
            <div class="track-wa-cta">
                <p class="otp-info"><i class="fa-solid fa-circle-check" aria-hidden="true"></i> Pembayaran sudah terverifikasi. Produk game ini diproses manual oleh admin. ${fromPaymentReturn ? "Klik tombol di bawah lalu lampirkan screenshot/bukti pembayaran iPaymu di chat." : `Sertakan <strong>No. Transaksi ${escapeHtml(data.id)}</strong> saat chat admin.`}</p>
                <a href="${waHref}" target="_blank" rel="noopener" class="btn-primary track-wa-btn"><i class="fa-brands fa-whatsapp" aria-hidden="true"></i> Chat Admin via WhatsApp</a>
            </div>
        `;
    }

    // Rating slot: di-render setelah innerHTML supaya slot-nya bisa dicari via getElementById.
    // Tambahkan placeholder ke innerHTML agar ada tempat untuk rating.
    // FEATURE (Agustus 2026): sebelumnya di-gate `data.type === "order"` doang
    // (topup tidak dapat slot rating sama sekali). Topup sekarang juga bisa
    // dirating (lihat topup_ratings di ratingController.js & renderRatingPrompt
    // yang sudah menangani isTopup) -- jadi gate ini dilonggarkan ke SEMUA
    // type yang sudah lunas, bukan cuma "order".
    const ratingSlotId = isPaid ? `rp_slot_${data.id.replace(/[^a-zA-Z0-9]/g, "")}` : "";
    const ratingSlotHtml = isPaid
        ? `<div id="${ratingSlotId}" style="margin-top:1.5rem;"></div>`
        : "";

    document.getElementById("trackResult").innerHTML = `
        <div class="track-status-badge ${cls}">${escapeHtml(label)}</div>
        <div class="row"><span>Order ID</span><span>${escapeHtml(data.id)}</span></div>
        <div class="row"><span>Tanggal</span><span>${tanggal}</span></div>
        ${itemsHtml}
        <div class="row total"><span>Total</span><span>${rupiah(data.total || 0)}</span></div>
        ${waCta}
        ${ratingSlotHtml}
    `;
    document.getElementById("trackResult").classList.remove("hidden");

    // Jika order sudah paid, minta renderRatingPrompt mengisi slot rating.
    // Backend selalu menentukan eligibility — ini adalah satu-satunya source of truth.
    // Dengan cara ini rating tersedia di Cek Transaksi kapan saja selama:
    //   order/topup = lunas AND belum dirating
    // Ini mengatasi semua skenario redirect/webhook-delay/refresh.
    if (isPaid) {
        const slot = document.getElementById(ratingSlotId);
        if (slot) renderRatingPrompt(data, slot); // async, tidak perlu ditunggu
    }

    if (window.trackPollingTimer) clearTimeout(window.trackPollingTimer);
    if ((data.status === "pending" || data.status === "0") && document.getElementById("trackOverlay").classList.contains("active")) {
        window.trackPollingTimer = setTimeout(async () => {
            if (document.getElementById("trackOverlay").classList.contains("active")) {
                const isTopupPolled = data.id.toUpperCase().startsWith("TP");
                const endpoint = isTopupPolled
                    ? `${API_BASE}/topup/track/${encodeURIComponent(data.id)}`
                    : `${API_BASE}/orders/track/${encodeURIComponent(data.id)}`;
                try {
                    const res = await fetch(endpoint);
                    if (res.ok) {
                        const newData = await res.json();
                        if (newData.status === "paid" || newData.status === "sukses") {
                            toast("Pembayaran Berhasil!", "success");
                        }
                        // Re-render track modal — renderTrackResult sekarang sudah
                        // menyertakan slot rating jika status paid, jadi tidak perlu
                        // closeOverlay dan showPaidOrderSuccess dari sini.
                        renderTrackResult(newData, options);
                    }
                } catch(e) {}
            }
        }, 5000);
    }
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
    const result = document.getElementById("trackResult");
    result.classList.toggle("hidden", tab !== "byid" || !result.innerHTML.trim());
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
    const token = localStorage.getItem(PUBLIC_TOKEN_STORAGE_KEY);

    try {
        const [ordersRes, topupRes] = await Promise.all([
            fetch(`${API_BASE}/orders/my`, { headers: { "Authorization": `Bearer ${token}` } }),
            fetch(`${API_BASE}/topup/my`, { headers: { "Authorization": `Bearer ${token}` } })
        ]);
        const orders = ordersRes.ok ? await ordersRes.json() : [];
        const topups = topupRes.ok ? await topupRes.json() : [];

        const merged = [
            ...(Array.isArray(orders) ? orders : []).map(o => ({
                id: o.id, type: "order", status: o.status, total: o.total,
                created_at: o.created_at, has_rating: o.has_rating
            })),
            ...(Array.isArray(topups) ? topups : []).map(t => ({
                id: t.id, type: "topup", status: t.status, total: t.harga,
                label: t.nama_produk, created_at: t.created_at,
                // FEATURE (Agustus 2026): topup sekarang juga dirating --
                // topupController.getMyOrders sudah menyertakan has_rating,
                // sebelumnya di-hardcode null di sini (rating topup belum ada).
                has_rating: t.has_rating
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
            const isPaid = t.status === "paid" || t.status === "sukses";

            // FEATURE (mirip Shopee): pesanan (produk maupun topup) yang
            // sudah dibayar dan belum dinilai dapat badge "Beri Rating" yang
            // jelas kelihatan, supaya user tahu tanpa harus klik satu-satu
            // order untuk cek.
            let ratingBadge = "";
            if (isPaid && t.has_rating === false) {
                ratingBadge = `<span class="track-mine-rating-badge needed"><i class="fa-regular fa-star" aria-hidden="true"></i> Beri Rating</span>`;
            } else if (isPaid && t.has_rating === true) {
                ratingBadge = `<span class="track-mine-rating-badge done"><i class="fa-solid fa-star" aria-hidden="true"></i> Sudah Dinilai</span>`;
            }

            return `
                <button type="button" class="track-mine-item" data-order-id="${escapeHtml(t.id)}">
                    <div>
                        <div class="track-mine-id">${escapeHtml(t.id)}</div>
                        <div class="track-mine-sub">${escapeHtml(t.label || (t.type === "topup" ? "Topup" : "Pesanan Produk"))} · ${tanggal}</div>
                        ${ratingBadge}
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

/* ---------- Mobile menu handled via initMobileMenu() below ---------- */

function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
}

function safeUrl(value, fallback = "") {
    const raw = String(value ?? "").trim();
    if (!raw) return fallback;
    try {
        const url = new URL(raw, window.location.origin);
        return ["http:", "https:"].includes(url.protocol) ? url.href : fallback;
    } catch (err) {
        return fallback;
    }
}
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

function applyTickerSettings(s) {
    const track = document.getElementById("tickerTrack");
    
    if (!s || !s.ticker_text) {
        if (track) track.style.display = 'none';
        return;
    }
    
    const items = String(s.ticker_text).split("|").map(t => t.trim()).filter(Boolean);
    if (!items.length) {
        if (track) track.style.display = 'none';
        return;
    }
    
    // Repeat items if too few to ensure it fills the screen seamlessly
    let displayItems = [...items];
    while (displayItems.length < 8) {
        displayItems = displayItems.concat(items);
    }
    
    const buildHTML = (groupItems) => groupItems.map(item => `<span class="ticker-msg">${item}</span> <span class="text-brand-indigo">•</span>`).join("");
    
    const g1 = document.getElementById("tickerGroup1");
    const g2 = document.getElementById("tickerGroup2");
    if (g1) g1.innerHTML = buildHTML(displayItems);
    if (g2) g2.innerHTML = buildHTML(displayItems);
    
    if (track) {
        track.style.display = 'flex';
        const seconds = Number(s.ticker_speed_seconds) || 30;
        
        // Calculate constant speed: "seconds" is treated as the duration for 100 characters.
        // This ensures the visual scrolling speed remains exactly the same whether there is 1 short message or 10 long ones.
        const totalChars = displayItems.join("").length;
        const calculatedDuration = Math.max((totalChars / 100) * seconds, 5);
        
        track.style.animationDuration = `${calculatedDuration}s`;
    }
}

async function loadStoreSettings() {
    try {
        const res = await fetch(`${API_BASE}/settings/store`);
        if (!res.ok) return;
        const s = await res.json();
        cachedStoreSettings = s;
        initEventMascot(s.event_mascot || null);

        if (s.store_name) {
            document.title = `${s.store_name} — Digital Gaming Marketplace`;
            const brandEl = document.getElementById("storeNameText");
            // pertahankan style "Nex<span>Shop</span>" kalau nama masih default,
            // kalau admin ganti nama toko, tampilkan apa adanya
            if (s.store_name.toLowerCase() !== "nexshop" && brandEl) {
                brandEl.textContent = s.store_name;
            }
            const footerBrandEl = document.getElementById("footerBrand");
            if (footerBrandEl) footerBrandEl.textContent = s.store_name;
        }
        if (s.tagline) {
            const taglineEl = document.getElementById("storeTagline");
            if (taglineEl) taglineEl.textContent = s.tagline;
        }
        if (s.logo_url) {
            const logoEl = document.getElementById("storeLogoImg");
            if (logoEl) logoEl.src = s.logo_url;
        }
        if (s.contact_whatsapp) {
            const cleanWa = s.contact_whatsapp.replace(/\D/g, "");
            const waUrl = `https://wa.me/${cleanWa}`;
            const displayLabel = s.contact_phone || s.contact_whatsapp;

            const waLink = document.getElementById("footerWaLink");
            if (waLink) waLink.href = waUrl;
            const waLabel = document.getElementById("footerWaLabel");
            if (waLabel) waLabel.textContent = displayLabel;

            const contactWa = document.getElementById("contactWaLink");
            if (contactWa) {
                contactWa.href = waUrl;
                contactWa.textContent = displayLabel;
            }
        }
        if (s.contact_email) updateContactEmailLinks(s.contact_email);
        if (s.contact_instagram) {
            const handle = String(s.contact_instagram).replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/$/, "").replace(/^@/, "");
            const igUrl = `https://www.instagram.com/${handle}`;
            const igLink = document.getElementById("contactIgLink");
            if (igLink) {
                igLink.href = igUrl;
                igLink.textContent = `@${handle}`;
            }
        }
        if (s.address) {
            const footerAddress = document.getElementById("footerAddress");
            if (footerAddress) {
                footerAddress.replaceChildren();
                const addressIcon = document.createElement("i");
                addressIcon.className = "fa-solid fa-location-dot";
                addressIcon.setAttribute("aria-hidden", "true");
                footerAddress.append(addressIcon, document.createTextNode(` ${s.address}`));
            }
            const contactAddress = document.getElementById("contactAddress");
            if (contactAddress) contactAddress.textContent = s.address;
        }
        // toggle trust bar sesuai Settings admin (default tampil kalau belum pernah diatur)
        const trustBar = document.getElementById("trustBar");
        if (trustBar) trustBar.classList.toggle("hidden", s.trust_bar_enabled === false);
        applyTickerSettings(s);
        if (Array.isArray(s.faq) && s.faq.length > 0) {
            renderFaqList(s.faq);
        }
        if (s.terms_content) {
            const termsEl = document.getElementById("termsContent");
            if (termsEl) termsEl.innerHTML = formatPolicyText(s.terms_content);
        }
        if (s.refund_content) {
            const refundEl = document.getElementById("refundContent");
            if (refundEl) refundEl.innerHTML = formatPolicyText(s.refund_content);
        }
    } catch (err) {
        // diem aja, biarin brand default kalau API gagal
    }
}

// Event Mascot adalah komponen generik berbasis konfigurasi publik. Ia tidak
// menyentuh logo; asset dan web selalu berada pada overlay terpisah.
function initEventMascot(config) {
    const anchor = document.getElementById("eventMascotAnchor");
    if (!anchor) return;
    const params = new URLSearchParams(window.location.search);
    const previewAsset = params.get("mascotAsset");
    if (params.get("mascotPreview") === "1" && previewAsset) {
        config = { enabled: true, mascot_url: previewAsset, speed: 1, delay: 0, scale: 1 };
    }
    if (!config || config.enabled !== true || !config.mascot_url) return;
    const now = Date.now();
    if (config.start_date && now < new Date(config.start_date).getTime()) return;
    if (config.end_date && now > new Date(config.end_date).getTime()) return;

    anchor.replaceChildren();
    const mascot = document.createElement("div");
    mascot.className = "event-mascot";
    mascot.style.setProperty("--mascot-scale", String(Math.min(2, Math.max(.5, Number(config.scale) || 1))));
    mascot.style.setProperty("--mascot-speed", String(Math.min(2, Math.max(.5, Number(config.speed) || 1))));
    const configuredDelay = Number(config.delay);
    const delay = Number.isFinite(configuredDelay) ? Math.min(5000, Math.max(0, configuredDelay)) : 500;
    mascot.style.setProperty("--mascot-delay", `${delay}ms`);
    mascot.style.setProperty("--mascot-enter-duration", `${2 / (Number(config.speed) || 1)}s`);
    const web = document.createElement("span");
    web.className = "event-mascot__web";
    if (config.web_url) {
        web.classList.add("has-asset");
        web.style.backgroundImage = `url("${String(config.web_url).replace(/["\\]/g, "")}")`;
    }
    const image = document.createElement("img");
    image.className = "event-mascot__image";
    image.src = config.mascot_url;
    image.alt = "";
    image.decoding = "async";
    image.fetchPriority = "high";
    mascot.append(web, image);
    anchor.append(mascot);

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const playKey = `eventMascotPlayed:${config.mascot_url}`;
    let alreadyPlayed = false;
    try { alreadyPlayed = sessionStorage.getItem(playKey) === "true"; } catch (err) {}
    const enterDuration = 2000 / (Number(config.speed) || 1);
    let started = false;
    const startMascot = () => {
        if (started || document.visibilityState === "hidden") return;
        started = true;
        // Two painted frames prevent Chromium from coalescing the initial state
        // and the animation class into one style update.
        requestAnimationFrame(() => requestAnimationFrame(() => {
            if (!reducedMotion && !alreadyPlayed && params.get("mascotPreview") !== "1") {
                let entranceConfirmed = false;
                const confirmEntrance = () => {
                    if (entranceConfirmed) return;
                    entranceConfirmed = true;
                    try { sessionStorage.setItem(playKey, "true"); } catch (err) {}
                };
                image.addEventListener("animationstart", confirmEntrance, { once: true });
                mascot.classList.add("is-entering");
                setTimeout(() => {
                    mascot.classList.remove("is-entering");
                    mascot.classList.add("is-hanging");
                }, delay + enterDuration);
            } else {
                mascot.classList.add("is-hanging");
            }
        }));
    };
    const waitForVisible = () => {
        if (document.visibilityState !== "hidden") startMascot();
        else document.addEventListener("visibilitychange", waitForVisible, { once: true });
    };
    const startAfterLoader = () => {
        if (initialLoading) document.addEventListener("nexshop:initial-ready", waitForVisible, { once: true });
        else waitForVisible();
    };
    if (image.complete && image.naturalWidth > 0) startAfterLoader();
    else {
        image.addEventListener("load", startAfterLoader, { once: true });
        // A broken remote asset must never leave an invisible/collapsed event.
        image.addEventListener("error", startAfterLoader, { once: true });
    }
    if (!reducedMotion) {
        const blink = () => {
            if (!mascot.isConnected) return;
            mascot.classList.add("is-blinking");
            setTimeout(() => mascot.classList.remove("is-blinking"), 800);
            setTimeout(blink, 20000 + Math.random() * 10000);
        };
        setTimeout(blink, 20000 + Math.random() * 10000);
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
// TOPUP_PRODUCTS DIHAPUS: dulu menampung SELURUH produk game hasil satu
// request /topup/products. Katalog sekarang dimuat bertahap per kartu
// (lihat loadTopupProducts), dan nominal per game diambil saat game itu
// dibuka -- tidak ada lagi satu array raksasa yang perlu disimpan.
let TOPUP_GAMES = [];

// Shortcut "sering dicari" di atas grid topup. keywords dicocokkan (contains,
// case-insensitive) ke nama kategori game dari data admin — tinggal tambah
// entry baru di sini kalau mau nambah game lain ke tier populer.
const TOPUP_POPULAR_SHORTCUTS = [
    { label: "MLBB", keywords: ["mobile legends", "mlbb"] },
    { label: "PUBGM", keywords: ["pubg"] },
    { label: "Free Fire", keywords: ["free fire", "ffmax"] },
    { label: "CODM", keywords: ["call of duty", "codm"] }
];

// FIX (Agustus 2026): dua variabel ini dipakai di banyak tempat (showDirectPaymentModal,
// openIpaymuPopup) tapi sebelumnya TIDAK PERNAH dideklarasikan di manapun --
// baris pertama yang MEMBACA nilainya (`if (ipaymuPollingTimeout) ...`,
// dieksekusi SEBELUM baris yang nge-assign) langsung throw ReferenceError
// "ipaymuPollingTimeout is not defined". Ini yang bikin:
// 1. Modal QRIS/VA (flow "direct") muncul, tapi loop polling status
//    pembayaran (poll()) GAK PERNAH SEMPAT JALAN -- makanya "Menunggu
//    pembayaran otomatis..." nyangkut selamanya walau pembayaran udah
//    sukses di backend.
// 2. Flow "redirect" (openIpaymuPopup): popup/tab iPaymu tetap kebuka
//    (window.open jalan duluan), tapi abis itu langsung crash sebelum
//    polling mulai, dan errornya kebawa ke catch() di submitTopupOrder()
//    sehingga muncul "Gagal terhubung ke server... ipaymuPollingTimeout is
//    not defined" padahal sebenarnya bukan masalah koneksi sama sekali.
let ipaymuPollingTimeout = null;
let ipaymuPollingController = null;
// Referensi window.open() dari openIpaymuPopup(), disimpan di sini (bukan cuma
// di closure lokal) supaya bisa ditutup dari stopIpaymuPolling() ketika modal
// ditutup lewat jalur lain (klik backdrop / tombol Escape), bukan cuma lewat
// tombol X-nya sendiri.
let ipaymuActivePopupWindow = null;

// ROOT CAUSE FIX: sebelumnya logic "stop polling status pembayaran" cuma
// dipasang di handler tombol X (dpCloseBtn / paymentWaitingCloseBtn). Modal
// directPaymentOverlay & paymentWaitingOverlay sama-sama pakai class
// ".overlay", yang juga bisa ditutup lewat klik area backdrop atau tombol
// Escape (lihat listener global ov.addEventListener("click", ...) dan
// keydown Escape) -- keduanya memanggil closeOverlay(id) LANGSUNG tanpa lewat
// handleClose(), sehingga polling (ipaymuPollingTimeout/Controller) tetap
// hidup di background walau modalnya sudah kelihatan tertutup. Fungsi ini
// dipanggil dari closeOverlay() supaya SEMUA jalur penutupan (tombol X,
// backdrop click, Escape) benar-benar menghentikan polling yang sedang
// berjalan untuk transaksi tersebut.
function stopIpaymuPolling() {
    if (ipaymuPollingTimeout) { clearTimeout(ipaymuPollingTimeout); ipaymuPollingTimeout = null; }
    if (ipaymuPollingController) { ipaymuPollingController.abort(); ipaymuPollingController = null; }
    if (ipaymuActivePopupWindow && !ipaymuActivePopupWindow.closed) {
        ipaymuActivePopupWindow.close();
    }
    ipaymuActivePopupWindow = null;

    const checkoutBtn = document.getElementById("checkoutForm")?.querySelector('button[type="submit"]');
    if (checkoutBtn) { checkoutBtn.disabled = false; checkoutBtn.textContent = "Bayar Sekarang"; }
    const twNextBtn = document.getElementById("twNextBtn");
    if (twNextBtn) { twNextBtn.disabled = false; twNextBtn.textContent = "Bayar Sekarang"; }
}

let twState = {
    kategori: null,
    step: 1,
    products: [],
    needsServerId: false,
    userId: "",
    serverId: "",
    email: "",
    phone: "",
    nickname: null,
    nicknameSupported: false,
    product: null,
    payment: null,
    vaBank: "bca",
    promo: null // { code, discount } -- diisi kalau kode promo berhasil diterapkan di step Ringkasan
};

// ===========================================================
// HARGA RESELLER DI SISI TOKO
//
// Feed produk (/topup/products & /topup/public-catalog) sekarang
// optional-auth: kalau token user ikut dikirim DAN user itu reseller yang
// sudah disetujui, server balas harga reseller + `harga_normal` buat
// dicoret. Diskonnya dihitung di server, jadi frontend cuma nampilin.
// ===========================================================
function publicAuthHeaders() {
    const token = localStorage.getItem(PUBLIC_TOKEN_STORAGE_KEY) || localStorage.getItem("token");
    return token ? { Authorization: `Bearer ${token}` } : {};
}

// Harga coret + label hemat, cuma muncul kalau server nandain produknya
// kena harga reseller.
function hargaResellerHtml(p, kelasCoret = "tw-price-normal") {
    if (!p || !p.harga_reseller || !p.harga_normal || p.harga_normal <= p.harga_jual) return "";
    return `<span class="${kelasCoret}">${rupiah(p.harga_normal)}</span>`;
}

// ==============================================================
// PEMUATAN KATALOG GAME BERTAHAP (LAZY LOAD)
//
// Dulu: satu request /topup/products menarik SELURUH produk game dengan
// SEMUA kolomnya (select("*")), lalu browser mengelompokkannya per game
// hanya untuk menampilkan kartu berisi nama, logo, jumlah produk, dan
// harga termurah. Ribuan baris diunduh, di-parse, dan ditahan di memori
// tab padahal isinya baru dipakai kalau user membuka satu game.
//
// Sekarang: server mengirim RINGKASAN kartu per halaman
// (/topup/catalog/games). Daftar nominal satu game baru diambil ketika
// game itu dibuka.
//
// Pencarian tetap menjangkau seluruh katalog karena filternya dijalankan
// SERVER atas indeks lengkap -- termasuk nama tiap nominal di dalam game
// yang kartunya belum pernah dimuat. Menyaring di browser atas data yang
// kebetulan sudah terunduh akan membuat game yang belum termuat mustahil
// ditemukan, yaitu menukar masalah berat halaman dengan pencarian rusak.
// ==============================================================
const TOPUP_PAGE_SIZE = 20;
let topupPage = 0;
let topupHasMore = true;
let topupLoading = false;
let topupTotal = 0;
// Token permintaan: hasil pencarian lama yang datang terlambat tidak boleh
// menimpa hasil pencarian yang lebih baru.
let topupRequestToken = 0;
// Nominal per game, diisi saat kartunya dibuka.
const TOPUP_PRODUK_CACHE = new Map();

function mapTopupSummaryItems(items) {
    return (items || []).map((g) => ({
        id: g.id,
        kategori: g.name,
        logo: g.logo,
        product_count: g.product_count,
        min_price: g.min_price,
        products: []
    }));
}

async function loadTopupProducts(reset = true) {
    // Query pencarian baru boleh menggantikan request lama yang masih jalan.
    // Ini penting saat tombol "Tampilkan Semua" sedang mengambil banyak
    // halaman: hasil lama tidak boleh menimpa hasil kata kunci terbaru.
    if (topupLoading && !reset) return;

    if (reset) {
        topupPage = 0;
        topupHasMore = true;
        TOPUP_GAMES = [];
        renderTopupGameSkeleton();
    }
    if (!topupHasMore) return;

    topupLoading = true;
    const tokenPermintaan = ++topupRequestToken;
    setTopupLoadMoreState("loading");

    try {
        const params = new URLSearchParams({
            page: String(topupPage + 1),
            limit: String(TOPUP_PAGE_SIZE)
        });
        if (topupSearchQuery.trim()) params.set("q", topupSearchQuery.trim());

        const res = await fetch(`${API_BASE}/topup/catalog/games?${params}`, {
            headers: publicAuthHeaders()
        });
        if (!res.ok) throw new Error("Gagal memuat katalog game");
        const data = await res.json();

        // Respons kedaluwarsa (user sudah mengetik kata kunci lain).
        if (tokenPermintaan !== topupRequestToken) return;

        topupPage = data.page || topupPage + 1;
        topupHasMore = !!data.has_more;
        topupTotal = Number(data.total) || 0;

        // Bentuk objek disamakan dengan struktur lama ({kategori, logo,
        // products}) supaya seluruh kode di bawah -- termasuk openGameDetail
        // -- tidak perlu ikut diubah. Bedanya `products` sekarang mulai
        // kosong dan diisi saat game dibuka.
        const kartuBaru = mapTopupSummaryItems(data.items);

        TOPUP_GAMES = reset ? kartuBaru : TOPUP_GAMES.concat(kartuBaru);
        renderTopupGameGrid();
    } catch (err) {
        if (tokenPermintaan !== topupRequestToken) return;
        console.error("loadTopupProducts:", err);
        if (reset) {
            TOPUP_GAMES = [];
            renderTopupGameGrid();
        } else {
            setTopupLoadMoreState("error");
        }
    } finally {
        if (tokenPermintaan === topupRequestToken) {
            topupLoading = false;
            setTopupLoadMoreState(topupHasMore ? "idle" : "done");
        }
    }
}

// Tombol eksplisit mengambil SEMUA halaman ringkasan yang cocok, lalu baru
// merender sekali. Batch tetap maksimal 60 (batas aman endpoint) dan daftar
// nominal per game tetap lazy: yang diunduh di sini hanya kartu ringkas.
async function loadAllTopupProducts() {
    if (topupLoading || !topupHasMore) return;

    topupLoading = true;
    const tokenPermintaan = ++topupRequestToken;
    const querySnapshot = topupSearchQuery.trim();
    let gagal = false;
    setTopupLoadMoreState("loading");

    try {
        let halaman = 1;
        let masihAda = true;
        let total = 0;
        const semuaItem = [];

        while (masihAda) {
            if (halaman > 100) throw new Error("Paginasi katalog topup melewati batas aman");

            const params = new URLSearchParams({
                page: String(halaman),
                limit: "60"
            });
            if (querySnapshot) params.set("q", querySnapshot);

            const res = await fetch(`${API_BASE}/topup/catalog/games?${params}`, {
                headers: publicAuthHeaders()
            });
            if (!res.ok) throw new Error("Gagal memuat seluruh katalog game");
            const data = await res.json();

            if (tokenPermintaan !== topupRequestToken || querySnapshot !== topupSearchQuery.trim()) return;

            semuaItem.push(...(data.items || []));
            total = Number(data.total) || semuaItem.length;
            masihAda = !!data.has_more;
            halaman = (Number(data.page) || halaman) + 1;
        }

        TOPUP_GAMES = mapTopupSummaryItems(semuaItem);
        topupPage = Math.max(1, halaman - 1);
        topupHasMore = false;
        topupTotal = total;
        renderTopupGameGrid();
    } catch (err) {
        if (tokenPermintaan !== topupRequestToken) return;
        gagal = true;
        console.error("loadAllTopupProducts:", err);
        setTopupLoadMoreState("error");
    } finally {
        if (tokenPermintaan === topupRequestToken) {
            topupLoading = false;
            if (!gagal) setTopupLoadMoreState(topupHasMore ? "idle" : "done");
        }
    }
}

/**
 * Ambil daftar nominal satu game. Dipanggil tepat saat kartunya dibuka,
 * bukan di muka. Hasilnya di-cache supaya membuka ulang game yang sama
 * tidak memanggil jaringan lagi.
 */
async function ambilProdukGame(game) {
    if (!game) return [];
    if (game.products && game.products.length) return game.products;

    const kunci = String(game.id || game.kategori).toLowerCase();
    if (TOPUP_PRODUK_CACHE.has(kunci)) {
        game.products = TOPUP_PRODUK_CACHE.get(kunci);
        return game.products;
    }

    const res = await fetch(
        `${API_BASE}/topup/catalog/group/game/${encodeURIComponent(kunci)}/products`,
        { headers: publicAuthHeaders() }
    );
    if (!res.ok) throw new Error("Gagal memuat nominal game");
    const data = await res.json();
    const produk = data.products || [];

    TOPUP_PRODUK_CACHE.set(kunci, produk);
    game.products = produk;
    if (!game.logo && data.logo) game.logo = data.logo;
    return produk;
}

// Cari posisi game di daftar "paling banyak dicari" (TOPUP_POPULAR_SHORTCUTS).
// Game yang cocok (contains, case-insensitive) sama salah satu keyword shortcut
// dianggap populer dan diberi ranking sesuai urutan di TOPUP_POPULAR_SHORTCUTS
// (0 = paling populer). Game yang gak cocok sama sekali dapet ranking paling
// besar (di luar daftar shortcut) supaya selalu jatuh di belakang.
function getPopularShortcutRank(kategori) {
    const k = String(kategori || "").toLowerCase();
    const idx = TOPUP_POPULAR_SHORTCUTS.findIndex(s => s.keywords.some(kw => k.includes(kw.toLowerCase())));
    return idx === -1 ? TOPUP_POPULAR_SHORTCUTS.length : idx;
}

// Ambil NAMA GAME untuk 1 kartu di grid. Data hasil sync provider menaruh
// nama game asli (Mobile Legends, PUBG Mobile, Free Fire, dst) di
// `source_operator_name`, sedangkan kolom `kategori` untuk data sync semuanya
// berisi "Gaming" -- makanya kalau dikelompokkan per `kategori` semua game
// nempel jadi 1 kartu. Prioritas: nama game dari operator, lalu kategori,
// terakhir "Lainnya".
function getTopupGameName(p) {
    const op = p.source_operator_name && String(p.source_operator_name).trim();
    if (op) return op;
    const kat = p.kategori && String(p.kategori).trim();
    if (kat) return kat;
    return "Lainnya";
}

// Kelompokkan produk topup per NAMA GAME (= 1 game/kartu di grid). Logo game
// diambil dari operator_logo yang diatur admin lewat Admin Dashboard.
// Urutan grid: game yang "paling banyak dicari" (ada di TOPUP_POPULAR_SHORTCUTS,
// misal MLBB/PUBGM/Free Fire/CODM) selalu muncul PALING ATAS sesuai urutan
// shortcut-nya, baru sisanya diurutkan alfabetis di bawahnya -- bukan cuma
// alfabetis polos kayak sebelumnya.
// buildTopupGames() DIHAPUS.
//
// Fungsi ini dulu mengelompokkan seluruh produk jadi kartu per game di
// browser -- pekerjaan yang hanya mungkin kalau seluruh katalog sudah
// terunduh lebih dulu. Pengelompokan itu sekarang dilakukan server sekali
// lalu di-cache (services/catalogIndexService.js), jadi hasilnya sama untuk
// semua pengunjung tanpa satu pun dari mereka perlu mengunduh katalog utuh.

function renderTopupGameSkeleton() {
    const grid = document.getElementById("topupGameGrid");
    if (!grid) return;
    grid.innerHTML = Array.from({ length: 6 }).map(() => `
        <div class="rounded-2xl p-4 border border-gray-200 dark:border-white/5 bg-white dark:bg-[#0a0a0c] flex flex-col justify-between" aria-hidden="true">
            <div>
                <div class="w-full aspect-square rounded-xl sm:rounded-2xl mb-4 bg-gray-200 dark:bg-white/5 animate-pulse"></div>
                <div class="w-3/4 h-4 bg-gray-200 dark:bg-white/10 animate-pulse rounded mb-2"></div>
                <div class="w-1/2 h-3 bg-gray-200 dark:bg-white/5 animate-pulse rounded"></div>
            </div>
            <div class="flex items-center justify-between mt-4">
                <div class="w-1/3 h-4 bg-gray-200 dark:bg-white/10 animate-pulse rounded"></div>
                <div class="w-8 h-8 rounded-full bg-gray-100 dark:bg-white/5 animate-pulse"></div>
            </div>
        </div>
    `).join("");
}

function updateTopupCatalogHeading(query = "") {
    const title = document.getElementById("topupCatalogTitle");
    const description = document.getElementById("topupCatalogDescription");
    const sedangMencari = !!String(query).trim();

    if (title) {
        title.innerHTML = sedangMencari
            ? 'Hasil <span class="text-transparent bg-clip-text bg-gradient-to-r from-brand-indigo to-brand-cyan">Pencarian</span>'
            : 'Top-Up <span class="text-transparent bg-clip-text bg-gradient-to-r from-brand-indigo to-brand-cyan">Terpopuler</span>';
    }
    if (description) {
        description.textContent = sedangMencari
            ? `Hasil untuk “${String(query).trim()}” diurutkan berdasarkan kecocokan.`
            : "Menampilkan game yang paling banyak dicari lebih dulu";
    }
}

// Begitu pengguna mengetik, singkirkan kartu populer lama sebelum debounce
// selesai. Selain memberi umpan balik yang benar, ini mencegah kartu lama
// masih bisa diklik dan membuka detail yang tidak sesuai dengan query baru.
function renderTopupSearchPending() {
    const query = topupSearchQuery.trim();
    topupRequestToken++;
    TOPUP_GAMES = [];
    topupTotal = 0;
    updateTopupCatalogHeading(query);
    renderTopupGameSkeleton();

    const zona = document.getElementById("topupLoadMoreZone");
    if (zona) zona.innerHTML = "";

    const clearBtn = document.getElementById("topupSearchClearBtn");
    if (clearBtn) clearBtn.classList.toggle("hidden", !query);

    const searchMeta = document.getElementById("topupSearchMeta");
    if (searchMeta) searchMeta.classList.toggle("hidden", !query);

    const countBadge = document.getElementById("topupSearchCountBadge");
    if (countBadge && query) countBadge.textContent = "Mencari…";
}

function renderTopupGameGrid() {
    const grid = document.getElementById("topupGameGrid");
    if (!grid) return;

    const query = topupSearchQuery.trim().toLowerCase();
    updateTopupCatalogHeading(topupSearchQuery);
    // TIDAK ADA penyaringan di sisi klien lagi: TOPUP_GAMES hanya berisi
    // kartu yang sudah dimuat, jadi menyaringnya di sini akan melewatkan
    // game yang cocok tapi belum terkirim. Penyaringan dikerjakan server
    // lewat parameter `q` (lihat loadTopupProducts).
    const data = TOPUP_GAMES;

    const countBadge = document.getElementById("topupSearchCountBadge");
    // Angka ini TOTAL hasil dari server, bukan jumlah kartu yang terlihat --
    // menampilkan jumlah yang terlihat akan menyesatkan ("18 Game" padahal
    // hasilnya 140).
    if (countBadge) countBadge.textContent = `${topupTotal} Game`;

    const clearBtn = document.getElementById("topupSearchClearBtn");
    if (clearBtn) clearBtn.classList.toggle("hidden", !query);

    const searchMeta = document.getElementById("topupSearchMeta");
    if (searchMeta) searchMeta.classList.toggle("hidden", !query);

    if (!data.length) {
        grid.innerHTML = `
            <div class="catalog-empty-state col-span-full">
                <div class="empty-icon"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i></div>
                <h4>Game Tidak Ditemukan</h4>
                <p>${query ? `Tidak ada hasil untuk "<strong>${escapeHtml(topupSearchQuery)}</strong>"` : "Belum ada game topup tersedia saat ini."}</p>
                ${query ? `<button type="button" class="btn-primary btn-sm reset-search-btn" id="topupResetSearchBtn"><i class="fa-solid fa-rotate-left"></i> Reset Pencarian</button>` : ""}
            </div>
        `;
        const resetBtn = document.getElementById("topupResetSearchBtn");
        if (resetBtn) {
            resetBtn.addEventListener("click", () => {
                topupSearchQuery = "";
                const input = document.getElementById("topupSearchInput");
                if (input) input.value = "";
                loadTopupProducts(true);
            });
        }
        renderTopupLoadMore();
        return;
    }

    grid.innerHTML = data.map(g => {
        // Jumlah produk & harga termurah datang dari ringkasan server --
        // dulu dihitung dari array produk lengkap yang harus diunduh dulu.
        const minPrice = g.min_price !== undefined && g.min_price !== null ? g.min_price : null;
        const jumlahProduk = g.product_count || 0;
        const logoUrl = g.logo ? escapeHtml(safeUrl(g.logo)) : "";
        return `
        <div class="topup-game-card group relative home-glass-card rounded-xl sm:rounded-2xl p-[clamp(6px,2vw,16px)] flex flex-col justify-between transition-all duration-300" data-kategori="${escapeHtml(g.kategori)}" tabindex="0" role="button">
            <div>
                <div class="relative w-full aspect-square rounded-xl sm:rounded-2xl overflow-hidden mb-2 sm:mb-4 bg-transparent">
                    ${g.logo ? `
                    <img src="${logoUrl}" alt="${escapeHtml(g.kategori)}" loading="lazy" class="absolute inset-0 w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-700">
                    ` : `
                    <div class="absolute inset-0 bg-gradient-to-br from-brand-indigo/20 to-brand-cyan/20"></div>
                    <div class="absolute inset-0 flex items-center justify-center">
                        <i class="fa-solid fa-gamepad text-3xl sm:text-5xl text-white/50" aria-hidden="true"></i>
                    </div>
                    `}
                    <span class="absolute top-2 left-2 home-glass-badge !text-[9px] !px-2 !py-0.5 !shadow-sm">INSTAN</span>
                </div>
                <h4 class="text-[clamp(0.65rem,2.2vw,0.85rem)] leading-tight font-bold text-gray-900 dark:text-white line-clamp-2 mb-1 sm:mb-2 group-hover:text-brand-indigo dark:group-hover:text-brand-cyan transition-colors" title="${escapeHtml(g.kategori)}">${escapeHtml(g.kategori)}</h4>
                <div class="flex items-center gap-1 text-[clamp(0.55rem,1.7vw,0.75rem)] text-gray-500 dark:text-gray-400 mb-2 sm:mb-4 font-medium">
                    <i class="fa-solid fa-layer-group text-[clamp(0.6rem,1.9vw,0.9rem)]" aria-hidden="true"></i> <span>${jumlahProduk} Produk</span>
                </div>
            </div>
            <div class="flex items-center justify-between mt-auto">
                ${minPrice !== null ? `<div class="font-bold text-transparent bg-clip-text bg-gradient-to-r from-brand-indigo to-brand-cyan text-[clamp(0.65rem,2vw,0.875rem)]">Mulai ${rupiah(minPrice)}</div>` : "<div></div>"}
                <div class="w-[clamp(20px,5vw,32px)] h-[clamp(20px,5vw,32px)] rounded-full bg-gray-100 dark:bg-white/5 flex items-center justify-center text-gray-600 dark:text-gray-300 hover:bg-brand-indigo hover:text-white transition-colors relative z-10 shrink-0">
                    <i class="fa-solid fa-arrow-right text-[clamp(0.7rem,2.3vw,0.9rem)]" aria-hidden="true"></i>
                </div>
            </div>
        </div>
    `;
    }).join("");

    grid.querySelectorAll(".topup-game-card").forEach(card => {
        card.addEventListener("click", () => openGameDetail(card.dataset.kategori));
        card.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openGameDetail(card.dataset.kategori); }
        });
    });

    renderTopupLoadMore();
}

// ==============================================================
// KONTROL "TAMPILKAN SEMUA" — KATALOG GAME
//
// Tidak ada infinite scroll di sini: hanya 20 kartu awal yang dirender sampai
// pengguna memang menekan tombol. Dengan begitu pengguna yang cuma mencari
// satu game tidak membayar biaya render seluruh katalog.
// ==============================================================
function renderTopupLoadMore() {
    const zona = document.getElementById("topupLoadMoreZone");
    if (!zona) return;

    if (!TOPUP_GAMES.length) {
        zona.innerHTML = "";
        return;
    }
    if (!topupHasMore) {
        zona.innerHTML = `<p class="topup-loadmore-done">Semua ${topupTotal} kategori topup sudah ditampilkan.</p>`;
        return;
    }

    const sisa = Math.max(topupTotal - TOPUP_GAMES.length, 0);
    zona.innerHTML = `
        <button type="button" class="topup-loadmore-btn" id="topupLoadMoreBtn">
            <i class="fa-solid fa-arrow-down" aria-hidden="true"></i>
            <span class="topup-loadmore-label">Tampilkan Semua Produk</span>
            <span class="topup-loadmore-sisa">${sisa} lainnya</span>
        </button>
    `;

    const btn = document.getElementById("topupLoadMoreBtn");
    if (btn) btn.addEventListener("click", loadAllTopupProducts);
}

function setTopupLoadMoreState(state) {
    const btn = document.getElementById("topupLoadMoreBtn");
    if (!btn) return;
    const label = btn.querySelector(".topup-loadmore-label");
    if (state === "loading") {
        btn.disabled = true;
        btn.classList.add("is-loading");
        if (label) label.textContent = "Memuat…";
    } else if (state === "error") {
        btn.disabled = false;
        btn.classList.remove("is-loading");
        if (label) label.textContent = "Gagal memuat — coba lagi";
    } else {
        btn.disabled = false;
        btn.classList.remove("is-loading");
        if (label) label.textContent = "Tampilkan Semua Produk";
    }
}

/* ---- Halaman Detail Game (bukan modal) ---- */

async function openGameDetail(kategori, overrideGame = null, returnView = 'grid', preselectProductId = null) {
    const game = overrideGame || TOPUP_GAMES.find(g => g.kategori === kategori);
    if (!game) return;

    // Nominal game TIDAK lagi ikut terkirim bersama katalog awal -- diambil
    // di sini, hanya untuk game yang benar-benar dibuka. Hasilnya di-cache
    // (lihat ambilProdukGame) supaya membuka ulang game yang sama tidak
    // memanggil jaringan lagi.
    if (!game.products || !game.products.length) {
        try {
            showAppLoader();
            await ambilProdukGame(game);
        } catch (err) {
            console.error("openGameDetail:", err);
            toast("Gagal memuat daftar nominal. Periksa koneksi kamu.", "error");
            return;
        } finally {
            hideAppLoader();
        }
    }

    if (!game.products || !game.products.length) {
        toast("Belum ada nominal aktif untuk game ini.", "info");
        return;
    }

    twState = {
        kategori: game.kategori,
        step: 1,
        products: game.products,
        needsServerId: game.products.some(p => p.butuh_server_id),
        userId: "",
        serverId: "",
        email: currentUser ? currentUser.email : "",
        phone: "",
        nickname: null,
        nicknameSupported: false,
        nicknameCheckDisabledReason: null,
        product: null,
        payment: null,
        promo: null,
        returnView: returnView
    };

    // Kalau dibuka dari kartu produk spesifik (mis. dari grid One
    // Stop/Marketplace yang nge-klik satu denom langsung, bukan cuma
    // pilih operator), langsung preselect produknya di sini -- sebelumnya
    // parameter ini gak pernah dipakai jadi user tetap harus milih ulang
    // manual walau udah klik produk yang spesifik.
    if (preselectProductId) {
        twState.product = twState.products.find(p => p.kode_produk === preselectProductId) || null;
    }

    document.getElementById("twLogo").src = safeUrl(game.logo, "images/nexshop-logo.webp");
    document.getElementById("twLogo").alt = game.kategori;
    document.getElementById("twGameName").textContent = game.kategori;
    document.getElementById("twGameDesc").textContent = `Topup ${game.kategori} resmi & instan, diproses otomatis 24 jam.`;
    const gameLogoUrl = safeUrl(game.logo);
    document.getElementById("twBanner").style.backgroundImage = gameLogoUrl ? `url(${JSON.stringify(gameLogoUrl)})` : "none";

    document.getElementById("twUserId").value = "";
    document.getElementById("twServerId").value = "";
    document.getElementById("twEmail").value = twState.email;

    let cleanPhone = "";
    if (currentUser && currentUser.phone) {
        cleanPhone = currentUser.phone.replace(/[^0-9]/g, "");
        if (cleanPhone.startsWith("62")) {
            // Keep 62
        } else if (!cleanPhone.startsWith("0") && cleanPhone.length > 5) {
            cleanPhone = "0" + cleanPhone;
        }
    }

    if (currentUser && cleanPhone && /^(0|62)[0-9]{8,14}$/.test(cleanPhone)) {
        document.getElementById("twPhone").value = cleanPhone;
        document.getElementById("twPhone").closest(".tw-field-group").classList.add("hidden");
    } else if (currentUser) {
        document.getElementById("twPhone").value = currentUser.phone || "";
        document.getElementById("twPhone").closest(".tw-field-group").classList.remove("hidden");
    } else {
        document.getElementById("twPhone").value = "";
        document.getElementById("twPhone").closest(".tw-field-group").classList.remove("hidden");
    }
    document.getElementById("twServerWrap").classList.toggle("hidden", !twState.needsServerId);
    document.getElementById("twAccountResult").className = "tw-account-result hidden";
    document.getElementById("twAccountResult").innerHTML = "";
    document.getElementById("twStep1Error").textContent = "";

    const checkBtn = document.getElementById("twCheckBtn");
    if (checkBtn) {
        checkBtn.disabled = false;
        checkBtn.innerHTML = '<i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i> Cek Nickname Akun';
    }

    renderTopupProductGrid();
    renderTopupPaymentGrid();
    goToTwStep(1);

    document.getElementById("topup").classList.add("hidden");
    document.getElementById("topupDetail").classList.remove("hidden");
    window.scrollTo({ top: document.getElementById("topupDetail").offsetTop - 90, behavior: "smooth" });
}

function closeGameDetail() {
    // Kalau checkout ini dibuka dari halaman Marketplace terpisah, balikin
    // ke sana lagi waktu ditutup -- bukan nyangkut di section Topup Diamond
    // di homepage (yang gak ada hubungannya sama alur belanja user).
    if (twState && twState.returnView === "marketplace") {
        window.location.href = "/marketplace";
        return;
    }
    if (twState && twState.returnView === "onestop") {
        document.getElementById("topupDetail").classList.add("hidden");
        document.getElementById("topup").classList.remove("hidden");
        const oneStopView = document.getElementById("view-onestop");
        if (oneStopView && !oneStopView.classList.contains("hidden")) {
            // Already visible
        } else if (oneStopView) {
            if (typeof openOneStopView === "function") {
                openOneStopView();
            }
        }
        window.scrollTo({ top: document.getElementById("topup").offsetTop - 90, behavior: "smooth" });
        return;
    }
    document.getElementById("topupDetail").classList.add("hidden");
    document.getElementById("topup").classList.remove("hidden");
    window.scrollTo({ top: document.getElementById("topup").offsetTop - 90, behavior: "smooth" });
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
    // Scroll ke atas wizard supaya user langsung lihat step baru
    const detail = document.getElementById("topupDetail");
    if (detail) {
        window.scrollTo({ top: detail.offsetTop - 90, behavior: "smooth" });
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
        const phone = document.getElementById("twPhone").value.trim();
        const errorEl = document.getElementById("twStep1Error");
        errorEl.textContent = "";

        if (!userId) { errorEl.textContent = "User ID wajib diisi"; return; }
        if (twState.needsServerId && !serverId) { errorEl.textContent = "Server ID wajib diisi untuk game ini"; return; }
        if (!email || !email.includes("@")) { errorEl.textContent = "Email wajib diisi dengan format yang benar"; return; }
        if (!/^(0|62)[0-9]{8,14}$/.test(phone)) { errorEl.textContent = "Nomor HP wajib diisi dengan format yang benar (contoh: 08... atau 628...)"; return; }
        if (!twState.product) { errorEl.textContent = "Pilih nominal top up dulu ya"; return; }

        twState.userId = userId;
        twState.serverId = serverId;
        twState.email = email;
        twState.phone = phone;
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
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Mengecek...';

    try {
        const res = await fetch(`${API_BASE}/topup/check-nickname`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kategori: twState.kategori, tujuan: userId, serverId: serverId || undefined })
        });
        
        let data = { available: false, reason: "provider_unavailable" };
        if (res.status === 429) {
            data.message = "Terlalu banyak percobaan cek akun. Silakan tunggu sebentar.";
        } else {
            try { data = await res.json(); } catch(e){}
        }

        resultEl.classList.remove("hidden");

        if (data.available) {
            twState.nicknameSupported = true;
            if (data.is_valid) {
                twState.nickname = data.username || "";
                resultEl.className = "tw-account-result valid";
                resultEl.innerHTML = `<span class="tw-check-icon"><i class="fa-solid fa-circle-check" aria-hidden="true"></i></span> Akun ditemukan: <strong>${escapeHtml(data.username || "-")}</strong>`;
            } else {
                twState.nickname = null;
                resultEl.className = "tw-account-result invalid";
                resultEl.innerHTML = `<i class="fa-solid fa-circle-xmark" aria-hidden="true"></i> User ID${twState.needsServerId ? "/Server ID" : ""} tidak ditemukan. Periksa kembali sebelum melanjutkan.`;
            }
        } else {
            twState.nicknameSupported = false;
            twState.nickname = null;
            resultEl.className = "tw-account-result warning";
            if (data.reason === "game_unsupported") {
                resultEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Verifikasi nickname otomatis belum tersedia untuk game ini. Pastikan User ID${twState.needsServerId ? " dan Server ID" : ""} sudah benar sebelum melanjutkan.`;
                twState.nicknameCheckDisabledReason = "game_unsupported";
            } else if (data.reason === "service_not_configured") {
                resultEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Verifikasi nickname sedang belum diaktifkan. Pastikan data akun sudah benar sebelum melanjutkan.`;
                twState.nicknameCheckDisabledReason = "service_not_configured";
            } else {
                resultEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Layanan verifikasi nickname sedang mengalami gangguan. Kamu tetap dapat melanjutkan setelah memastikan data akun benar.`;
            }
        }
    } catch (err) {
        resultEl.classList.remove("hidden");
        resultEl.className = "tw-account-result warning";
        resultEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Layanan verifikasi nickname sedang mengalami gangguan. Kamu tetap dapat melanjutkan setelah memastikan data akun benar.`;
    } finally {
        if (twState.nicknameCheckDisabledReason !== "game_unsupported" && twState.nicknameCheckDisabledReason !== "service_not_configured") {
            btn.disabled = false;
        }
        btn.innerHTML = '<i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i> Cek Nickname Akun';
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
        <div class="tw-product-card ${twState.product && twState.product.kode_produk === p.kode_produk ? "selected" : ""}" data-kode="${escapeHtml(p.kode_produk)}">
            ${p.item_icon ? `<img class="tw-product-icon" src="${escapeHtml(safeUrl(p.item_icon))}" alt="${escapeHtml(p.nama)}" loading="lazy">` : `<span class="diamond-icon"><i class="fa-solid fa-gem" aria-hidden="true"></i></span>`}
            <h5>${escapeHtml(p.nama)}</h5>
            <div class="tw-product-price">${rupiah(p.harga_jual)}${hargaResellerHtml(p)}</div>
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
        const heading = activeGroupCount > 1 ? `<h5 class="tw-product-group-heading">${escapeHtml(g.label)}</h5>` : "";
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
        ${method.id === "wallet" && twState.payment === "wallet" ? `
            <div class="mt-1 mb-3 p-3 rounded-xl border border-brand-indigo/30 bg-brand-indigo/10 text-xs">
                <div class="flex items-center justify-between font-bold mb-1">
                    <span class="text-gray-600 dark:text-gray-300">Saldo NexShop Wallet:</span>
                    <span class="text-brand-indigo dark:text-brand-cyan text-sm font-black">${window.currentUserWallet ? rupiah(window.currentUserWallet.balance) : (localStorage.getItem(PUBLIC_TOKEN_STORAGE_KEY) ? "Memuat..." : "Login untuk cek saldo")}</span>
                </div>
                ${window.currentUserWallet && twState.product ? (
                    window.currentUserWallet.balance >= twState.product.harga_jual ? `
                        <div class="text-emerald-500 font-semibold mt-1 flex items-center gap-1">
                            <i class="fa-solid fa-circle-check text-xs" aria-hidden="true"></i>
                            <span>Saldo mencukupi. Sisa setelah transaksi: <strong>${rupiah(window.currentUserWallet.balance - twState.product.harga_jual)}</strong></span>
                        </div>
                    ` : `
                        <div class="text-amber-500 font-bold mt-1.5 flex items-center justify-between">
                            <span>Saldo kurang ${rupiah(twState.product.harga_jual - window.currentUserWallet.balance)}</span>
                            <button type="button" class="py-1 px-3 bg-brand-indigo hover:bg-indigo-600 text-white rounded-lg font-bold text-xs shadow-sm transition-all" onclick="openWalletModal(event)">+ Top Up</button>
                        </div>
                    `
                ) : ''}
            </div>
        ` : ''}
        ${method.id === "va" && twState.payment === "va" ? `
            <div class="mt-1 mb-4 p-4 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50/50 dark:bg-white/5">
                <label class="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-3">Pilih Bank</label>
                <div class="grid grid-cols-2 min-[400px]:grid-cols-3 gap-2">
                    ${['bca', 'bni', 'mandiri', 'bri', 'cimb'].map(bank => `
                        <label class="relative flex items-center justify-center p-3 border-2 rounded-lg cursor-pointer transition-all duration-200 ${twState.vaBank === bank ? 'border-brand-indigo bg-brand-indigo/10 dark:bg-brand-indigo/20 text-brand-indigo dark:text-brand-cyan' : 'border-gray-200 dark:border-white/10 hover:border-gray-300 dark:hover:border-white/20 text-gray-700 dark:text-gray-400'}">
                            <input type="radio" name="twVaBankRadio" value="${bank}" ${twState.vaBank === bank ? 'checked' : ''} class="hidden">
                            <span class="text-sm font-bold uppercase tracking-wider">${bank === 'cimb' ? 'CIMB' : bank}</span>
                        </label>
                    `).join('')}
                </div>
            </div>
        ` : ''}
    `).join("");

    grid.querySelectorAll("[data-payment-method]").forEach((card) => {
        card.addEventListener("click", () => {
            twState.payment = card.dataset.paymentMethod;
            renderTopupPaymentGrid();
        });
    });

    grid.querySelectorAll("input[name='twVaBankRadio']").forEach((radio) => {
        radio.addEventListener("change", (e) => {
            twState.vaBank = e.target.value;
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

    const isWallet = twState.payment === "wallet";
    const userBal = window.currentUserWallet ? window.currentUserWallet.balance : 0;
    const hasSufficientBalance = isWallet && window.currentUserWallet && userBal >= total;
    const shortage = total - userBal;

    let walletExtraSummary = "";
    if (isWallet) {
        if (!localStorage.getItem(PUBLIC_TOKEN_STORAGE_KEY)) {
            walletExtraSummary = `
                <div class="tw-summary-row" style="color:#f59e0b;font-weight:700;">
                    <span>Status Wallet</span>
                    <strong>Silakan login untuk membayar via Saldo</strong>
                </div>
            `;
        } else if (window.currentUserWallet) {
            if (hasSufficientBalance) {
                walletExtraSummary = `
                    <div class="tw-summary-row" style="color:#38bdf8;">
                        <span>Saldo NexShop Wallet</span>
                        <strong>${rupiah(userBal)}</strong>
                    </div>
                    <div class="tw-summary-row" style="color:#34d399;font-weight:800;">
                        <span>Saldo Setelah Transaksi</span>
                        <strong>${rupiah(userBal - total)}</strong>
                    </div>
                `;
            } else {
                walletExtraSummary = `
                    <div class="tw-summary-row" style="color:#ef4444;font-weight:800;">
                        <span>Saldo Kurang</span>
                        <strong>${rupiah(shortage)}</strong>
                    </div>
                    <div style="text-align:right;margin-top:6px;">
                        <button type="button" class="btn-wallet-action primary" data-wallet-trigger style="padding:0.4rem 0.85rem;font-size:0.78rem;border-radius:10px;display:inline-flex;align-items:center;gap:6px;">
                            <i class="fa-solid fa-plus"></i> + Top Up Saldo Sekarang
                        </button>
                    </div>
                `;
            }
        }
    }

    el.innerHTML = `
        <div class="tw-summary-row"><span>Game</span><strong>${escapeHtml(twState.kategori)}</strong></div>
        ${twState.nicknameSupported && twState.nickname ? `<div class="tw-summary-row"><span>Nickname</span><strong>${escapeHtml(twState.nickname)}</strong></div>` : ""}
        <div class="tw-summary-row"><span>User ID</span><strong>${escapeHtml(twState.userId)}${twState.serverId ? " (" + escapeHtml(twState.serverId) + ")" : ""}</strong></div>
        <div class="tw-summary-row"><span>Produk</span><strong>${escapeHtml(p ? p.nama : "-")}</strong></div>
        <div class="tw-summary-row"><span>Harga</span><strong>${rupiah(subtotal)}</strong></div>
        ${twState.promo ? `<div class="tw-summary-row"><span>Diskon (${escapeHtml(twState.promo.code)})</span><strong>-${rupiah(discount)}</strong></div>` : ""}
        <div class="tw-summary-row"><span>Metode Pembayaran</span><strong>${escapeHtml(paymentLabel)}</strong></div>
        ${walletExtraSummary}
        <div class="tw-summary-row"><span>Total Bayar</span><strong>${rupiah(total)}</strong></div>
    `;
    document.getElementById("twConfirmCheck").checked = false;
    document.getElementById("twStep3Error").textContent = "";

    const nextBtn = document.getElementById("twNextBtn");
    if (nextBtn) {
        nextBtn.textContent = isWallet ? "Bayar dengan NexShop Wallet" : "Bayar Sekarang";
    }
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
        const token = localStorage.getItem(PUBLIC_TOKEN_STORAGE_KEY);
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
                recipient_phone: twState.phone,
                promo_code: twState.promo ? twState.promo.code : undefined,
                payment_method: twState.payment,
                payment_channel: twState.vaBank
            })
        });

        // FIX (Agustus 2026): sebelumnya kalau res.json() gagal parse (misal
        // server balikin halaman error HTML, bukan JSON, karena request
        // sempat gantung lama), errornya lolos ke catch generik di bawah dan
        // user cuma liat "Gagal terhubung ke server" tanpa info apa-apa,
        // padahal pesanannya bisa jadi TETEP kebuat di backend. Sekarang
        // dibedain: response gak OK & bukan JSON valid -> pesan lebih jelas
        // + disaranin cek "Cek Transaksi" pakai Order ID kalau ada.
        let data;
        try {
            data = await res.json();
        } catch (parseErr) {
            console.error("Topup checkout: response bukan JSON valid", parseErr);
            errorEl.textContent = "Server merespons tidak seperti biasa. Kalau saldo/diamond kamu ternyata sudah terpotong, cek status pesanan lewat tab \"Cek Transaksi\" sebelum membayar ulang.";
            btn.disabled = false;
            btn.textContent = "Bayar Sekarang";
            return;
        }

        if (!res.ok) {
            errorEl.textContent = data.message || "Gagal membuat pesanan topup";
            if (data.code === "DUPLICATE_PENDING_CHECKOUT") {
                toast(data.message, "error");
            }
            btn.disabled = false;
            btn.textContent = "Bayar Sekarang";
            return;
        }

        if (twState.payment === "wallet" || data.payment_method === "wallet") {
            closeModal("topupWizardModal");
            if (typeof fetchUserWallet === "function") fetchUserWallet();
            if (typeof showToast === "function") {
                showToast("Pembayaran Berhasil", "Pesanan berhasil dibayar menggunakan Saldo NexShop Wallet!");
            }
            openTrackModal(data.order_id || data.orderId);
            return;
        }

        if (data.flow === "direct" && data.paymentData) {
            showDirectPaymentModal(data.paymentData, data.orderId, true);
        } else {
            openIpaymuPopup(data.paymentUrl, data.orderId, true);
        }
    } catch (err) {
        console.error("Topup checkout gagal:", err);
        errorEl.textContent = "Gagal terhubung ke server. Coba cek koneksi internet kamu lalu ulangi. Kalau ini muncul terus, hubungi admin dengan info ini: " + (err.message || "network error");
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

/* ---------- Direct Payment Modal ---------- */
function showDirectPaymentModal(paymentData, orderId, isTopup) {
    const qrisContainer = document.getElementById("dpQrisContainer");
    const vaContainer = document.getElementById("dpVaContainer");
    const qrCodeDiv = document.getElementById("dpQrCode");
    const vaNumberDiv = document.getElementById("dpVaNumber");
    
    // Set UI elements based on payment channel
    if (paymentData.qrContent) {
        qrisContainer.classList.remove("hidden");
        vaContainer.classList.add("hidden");
        
        qrCodeDiv.innerHTML = "";
        if (typeof QRCode !== "undefined") {
            new QRCode(qrCodeDiv, {
                text: paymentData.qrContent,
                width: 200,
                height: 200,
                colorDark: "#000000",
                colorLight: "#ffffff",
                correctLevel: QRCode.CorrectLevel.H
            });
        } else {
            qrCodeDiv.innerHTML = "<p>QR Code gagal dimuat.</p>";
        }

        // Tombol download QR -- qrcodejs render jadi <canvas> (browser modern)
        // atau <img> (fallback). Tunggu sebentar biar elemennya kebentuk dulu
        // sebelum kita ambil datanya, karena constructor QRCode render-nya async.
        const downloadBtn = document.getElementById("dpDownloadQrBtn");
        if (downloadBtn) {
            downloadBtn.onclick = () => {
                const canvas = qrCodeDiv.querySelector("canvas");
                const img = qrCodeDiv.querySelector("img");
                const dataUrl = canvas ? canvas.toDataURL("image/png") : (img ? img.src : null);
                if (!dataUrl) {
                    toast("QR belum siap, coba lagi sebentar.", "error");
                    return;
                }
                const link = document.createElement("a");
                link.href = dataUrl;
                link.download = `QRIS-Nexshop-${orderId}.png`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            };
        }
    } else if (paymentData.paymentNo) {
        vaContainer.classList.remove("hidden");
        qrisContainer.classList.add("hidden");
        vaNumberDiv.textContent = paymentData.paymentNo;
    }

    document.getElementById("dpAmount").textContent = rupiah(paymentData.amount || 0);
    document.getElementById("dpExpired").textContent = paymentData.expired || "-";

    openOverlay("directPaymentOverlay");

    // Copy VA handler
    const copyBtn = document.getElementById("dpCopyVaBtn");
    if (copyBtn) {
        const copyHandler = () => {
            navigator.clipboard.writeText(paymentData.paymentNo).then(() => {
                const originalText = copyBtn.innerHTML;
                copyBtn.innerHTML = `<i class="fa-solid fa-check"></i> Disalin!`;
                setTimeout(() => { copyBtn.innerHTML = originalText; }, 2000);
            });
        };
        // Remove previous listener to avoid duplicates
        const newCopyBtn = copyBtn.cloneNode(true);
        copyBtn.parentNode.replaceChild(newCopyBtn, copyBtn);
        newCopyBtn.addEventListener("click", copyHandler);
    }

    // Polling logic
    const closeBtn = document.getElementById("dpCloseBtn");
    
    const handleClose = () => {
        closeOverlay("directPaymentOverlay");

        // ROOT CAUSE FIX (bug: popup rating/order muncul lagi setelah ditutup X):
        // handleClose() sebelumnya TIDAK pernah menghentikan polling
        // (ipaymuPollingTimeout / ipaymuPollingController) seperti yang sudah
        // dilakukan di openIpaymuPopup(). Akibatnya walaupun modal QRIS/VA sudah
        // ditutup lewat tombol X, poll() di bawah tetap jalan tiap 3 detik di
        // background. Begitu status order berubah jadi "paid", poll() akan tetap
        // memanggil showPaidOrderSuccess() -> openOverlay("checkoutOverlay") dan
        // memaksa popup sukses/rating muncul lagi walau user sudah menutupnya.
        // stopIpaymuPolling() (dipanggil juga dari closeOverlay() untuk jalur
        // backdrop-click/Escape) menutup celah itu di semua jalur penutupan.
        stopIpaymuPolling();
    };
    
    const newCloseBtn = closeBtn.cloneNode(true);
    closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);
    newCloseBtn.addEventListener("click", handleClose);

    const endpoint = isTopup
        ? `${API_BASE}/topup/track/${encodeURIComponent(orderId)}`
        : `${API_BASE}/orders/track/${encodeURIComponent(orderId)}`;

    if (ipaymuPollingTimeout) clearTimeout(ipaymuPollingTimeout);
    if (ipaymuPollingController) ipaymuPollingController.abort();
    // Flow "direct" (QRIS/VA) tidak membuka popup window iPaymu, jadi
    // pastikan tidak ada referensi popup basi (mis. dari flow "redirect"
    // sebelumnya) yang masih menggantung.
    if (ipaymuActivePopupWindow && !ipaymuActivePopupWindow.closed) ipaymuActivePopupWindow.close();
    ipaymuActivePopupWindow = null;
    ipaymuPollingController = new AbortController();

    const poll = async () => {
        try {
            const res = await fetch(endpoint, {
                cache: 'no-store'
            });
            if (res.ok) {
                const data = await res.json();
                if (data.status === "paid" || data.status === "sukses") {
                    // ROOT CAUSE FIX (loop tiada henti): sebelumnya tidak ada
                    // `return` di sini, jadi walaupun status "paid" sudah
                    // terdeteksi dan popup sukses/rating sudah ditampilkan,
                    // eksekusi tetap lanjut ke `setTimeout(poll, 3000)` di
                    // bawah. 3 detik kemudian poll() jalan lagi, status masih
                    // "paid", dan showPaidOrderSuccess() / openOverlay
                    // dipanggil LAGI -- begitu terus setiap 3 detik selamanya,
                    // walau modal sudah ditutup manual oleh user. Transaksi ini
                    // sudah selesai (paid), jadi hentikan polling & langsung
                    // keluar tanpa menjadwalkan poll berikutnya.
                    // Order sudah lunas -- transaksi ini selesai. Hentikan polling
                    // SEBELUM melakukan apa pun lagi supaya tidak ada jendela waktu
                    // di mana ipaymuPollingTimeout masih terjadwal.
                    stopIpaymuPolling();
                    closeOverlay("directPaymentOverlay");
                    if (isTopup) {
                        document.getElementById("twStep3Error").textContent = "";
                        closeGameDetail();
                        toast("Pembayaran Topup Berhasil!", "success");
                        openTrackModalWithResult(data, { isTopup: true });
                    } else {
                        showPaidOrderSuccess(data, isTopup);
                    }
                    return;
                }
            }
        } catch(e) {
            if (e.name === 'AbortError') return;
            // Ignore polling errors
        }
        ipaymuPollingTimeout = setTimeout(poll, 3000);
    };
    poll();
}

/* ---------- iPaymu Popup Checkout ---------- */
function openIpaymuPopup(paymentUrl, orderId, isTopup) {
    const w = 600;
    const h = 700;
    const left = (window.screen.width / 2) - (w / 2);
    const top = (window.screen.height / 2) - (h / 2);
    const popup = window.open(paymentUrl, "iPaymuCheckout", `width=${w},height=${h},top=${top},left=${left},resizable=yes,scrollbars=yes`);
    
    // Simpan referensi popup window secara global supaya stopIpaymuPolling()
    // (dipanggil dari closeOverlay() saat user menutup lewat backdrop/Escape)
    // juga bisa menutup jendela iPaymu ini, bukan cuma lewat tombol X.
    ipaymuActivePopupWindow = popup;

    document.getElementById("paymentWaitingOverlay").style.display = "flex";
    
    // FIX (Bug 4): clone closeBtn dulu sebelum tambah listener baru, sama
    // seperti showDirectPaymentModal -- tanpa ini, tiap kali popup iPaymu
    // dibuka lagi, listener numpuk di tombol yang sama (elemen DOM-nya gak
    // pernah diganti) dan handleClose bisa kepanggil berkali-kali.
    const oldCloseBtn = document.getElementById("paymentWaitingCloseBtn");
    const closeBtn = oldCloseBtn.cloneNode(true);
    oldCloseBtn.parentNode.replaceChild(closeBtn, oldCloseBtn);

    const handleClose = () => {
        document.getElementById("paymentWaitingOverlay").style.display = "none";
        // ROOT CAUSE FIX (bug: popup muncul lagi setelah ditutup X): pakai
        // stopIpaymuPolling() terpusat (lihat komentar di deklarasinya) supaya
        // popup window ditutup, timer dibersihkan, dan controller di-abort,
        // konsisten dengan jalur backdrop-click/Escape lewat closeOverlay().
        stopIpaymuPolling();
        closeBtn.removeEventListener("click", handleClose);
    };
    closeBtn.addEventListener("click", handleClose);

    const endpoint = isTopup
        ? `${API_BASE}/topup/track/${encodeURIComponent(orderId)}`
        : `${API_BASE}/orders/track/${encodeURIComponent(orderId)}`;

    if (ipaymuPollingTimeout) clearTimeout(ipaymuPollingTimeout);
    if (ipaymuPollingController) ipaymuPollingController.abort();
    ipaymuPollingController = new AbortController();

    const poll = async () => {
        if (popup && popup.closed) {
            handleClose();
            return;
        }
        try {
            const res = await fetch(endpoint, {
                cache: 'no-store'
            });
            if (res.ok) {
                const data = await res.json();
                if (data.status === "paid" || data.status === "sukses") {
                    // ROOT CAUSE FIX (loop tiada henti / popup muncul lagi
                    // setelah ditutup): sama seperti bug di showDirectPaymentModal,
                    // sebelumnya tidak ada `return` di sini. handleClose() berhenti
                    // polling untuk sesaat, tapi eksekusi tetap jatuh ke
                    // `setTimeout(poll, 3000)` di akhir fungsi, jadi poll() jalan
                    // lagi 3 detik kemudian, status masih "paid", dan
                    // showPaidOrderSuccess() dipanggil ULANG -- popup sukses/rating
                    // jadi muncul berkali-kali walau sudah ditutup. Transaksi sudah
                    // selesai, jadi stop di sini.
                    handleClose();
                    
                    if (isTopup) {
                        document.getElementById("twStep3Error").textContent = "";
                        closeGameDetail();
                        toast("Pembayaran Topup Berhasil!", "success");
                        openTrackModalWithResult(data, { isTopup: true });
                    } else {
                        showPaidOrderSuccess(data, isTopup);
                    }
                    return;
                }
            }
        } catch(e) {
            if (e.name === 'AbortError') return;
            // Ignore polling errors
        }
        ipaymuPollingTimeout = setTimeout(poll, 3000);
    };
    poll();
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

        const controller = new AbortController();
        const signal = controller.signal;
        
        // Setup listener to abort if user navigates away from the page
        const abortHandler = () => controller.abort();
        window.addEventListener("hashchange", abortHandler, { once: true });

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            if (signal.aborted) return;
            const res = await fetch(endpoint, { signal });
            data = await res.json();
            if (!res.ok) {
                toast(`Order ${orderId}: status belum bisa dicek. Simpan Order ID ini untuk cek manual ke admin.`);
                controller.abort();
                return;
            }
            if (data.status !== "pending" || attempt === maxAttempts - 1) break;
            await new Promise((resolve) => setTimeout(resolve, 1200));
        }

        window.removeEventListener("hashchange", abortHandler);

        // jaga-jaga: loadStoreSettings() (buat contact_whatsapp) jalan bareng
        // fungsi ini pas page load, jadi bisa aja belum selesai duluan —
        // pastiin dulu biar tombol WA gak ketinggalan render
        if (!cachedStoreSettings) {
            try {
                const settingsRes = await fetch(`${API_BASE}/settings/store`);
                if (settingsRes.ok) cachedStoreSettings = await settingsRes.json();
            } catch (e) { /* gak fatal, CTA WA cuma gak muncul kalau ini gagal */ }
        }

        // Jika order sudah paid saat redirect balik: tampilkan success overlay
        // (checkout overlay) yang di dalamnya juga memanggil renderRatingPrompt.
        //
        // Jika setelah semua retry status masih pending (webhook iPaymu belum masuk):
        // buka track modal via openTrackModalWithResult. renderTrackResult() sekarang
        // sudah menyertakan slot rating untuk order paid, dan polling 5 detik di sana
        // akan mendeteksi perubahan status → re-render dengan slot rating yang terisi.
        // Ini membuat rating tetap muncul meskipun webhook lebih lambat dari 7 detik.
        const isPaidResult = data.status === "paid" || data.status === "sukses";
        if (!isTopup && isPaidResult) {
            showPaidOrderSuccess(data, false);
        } else {
            // Untuk pending/failed: buka track modal
            // renderTrackResult akan attach slot rating secara otomatis
            // jika webhook berhasil mengubah status ke paid nanti
            openTrackModalWithResult(data, { fromPaymentReturn: true });
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
    const ordersEls = document.querySelectorAll(".trustTotalOrders");
    const gamesEls = document.querySelectorAll(".trustTotalGames");
    if (!ordersEls.length || !gamesEls.length) return;

    try {
        const res = await fetch(`${API_BASE}/stats/public`);
        if (!res.ok) throw new Error("Gagal memuat statistik");
        const data = await res.json();

        ordersEls.forEach(el => animateTrustCounter(el, Number(data.total_transaksi_sukses || 0)));
        gamesEls.forEach(el => animateTrustCounter(el, Number(data.total_game || 0)));
    } catch (err) {
        // trust bar bukan fitur krusial — kalau gagal, biarin tampil "-" aja, gak ganggu belanja
        ordersEls.forEach(el => el.textContent = "-");
        gamesEls.forEach(el => el.textContent = "-");
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

    const topupSearchInput = document.getElementById("topupSearchInput");
    const topupSearchClearBtn = document.getElementById("topupSearchClearBtn");

    // Pencarian game dikerjakan SERVER (/topup/catalog/games?q=).
    // Kartu kini dimuat bertahap, jadi menyaring di browser hanya akan
    // menelusuri kartu yang kebetulan sudah terunduh -- game yang cocok tapi
    // belum termuat tidak akan pernah muncul. Server menyaring atas indeks
    // lengkap, termasuk nama tiap nominal di dalam game.
    let topupSearchDebounce = null;

    if (topupSearchInput) {
        topupSearchInput.addEventListener("input", (e) => {
            topupSearchQuery = e.target.value;
            renderTopupSearchPending();
            // Debounce: tanpa ini tiap ketukan huruf memicu satu request.
            clearTimeout(topupSearchDebounce);
            topupSearchDebounce = setTimeout(() => loadTopupProducts(true), 280);
        });

        // Enter tidak perlu menunggu debounce.
        topupSearchInput.addEventListener("keydown", (e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            clearTimeout(topupSearchDebounce);
            topupSearchQuery = topupSearchInput.value;
            renderTopupSearchPending();
            loadTopupProducts(true);
        });
    }

    if (topupSearchClearBtn) {
        topupSearchClearBtn.addEventListener("click", () => {
            clearTimeout(topupSearchDebounce);
            topupSearchQuery = "";
            if (topupSearchInput) topupSearchInput.value = "";
            renderTopupSearchPending();
            loadTopupProducts(true);
        });
    }
}

function initThemeToggle() {
    const currentTheme = localStorage.getItem(THEME_STORAGE_KEY) === "light" ? "light" : (document.documentElement.getAttribute("data-theme") || "dark");
    applyTheme(currentTheme, false);

    document.addEventListener("click", (e) => {
        const btn = closestFromEvent(e.target, "#themeToggle, .theme-toggle");
        if (btn) {
            e.preventDefault();
            e.stopPropagation();
            const activeTheme = document.documentElement.getAttribute("data-theme") || document.documentElement.dataset.theme || "dark";
            const nextTheme = activeTheme === "light" ? "dark" : "light";
            applyTheme(nextTheme, true);
        }
    });

    window.addEventListener("storage", (e) => {
        if (e.key === THEME_STORAGE_KEY) {
            applyTheme(e.newValue === "light" ? "light" : "dark", false);
        }
    });
}

function initMobileMenu() {
    document.addEventListener("click", (e) => {
        const menuToggle = closestFromEvent(e.target, "#menuToggle, .menu-toggle");
        const navMenu = document.getElementById("navMenu");

        if (menuToggle && navMenu) {
            e.preventDefault();
            e.stopPropagation();
            const isOpen = navMenu.classList.toggle("active");
            menuToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
            return;
        }

        if (navMenu && navMenu.classList.contains("active")) {
            if (!navMenu.contains(e.target)) {
                navMenu.classList.remove("active");
                const btn = document.getElementById("menuToggle");
                if (btn) btn.setAttribute("aria-expanded", "false");
            } else if (closestFromEvent(e.target, "a, button:not(#themeToggle)")) {
                navMenu.classList.remove("active");
                const btn = document.getElementById("menuToggle");
                if (btn) btn.setAttribute("aria-expanded", "false");
            }
        }
    });
}

/* ---------- NexBot AI Floating Chatbot ---------- */
// ===========================================================
// NexBot dipindah ke /nexbot.js supaya bisa dipakai bareng sama
// halaman lain (Marketplace), bukan cuma halaman utama. Fungsi
// initNexBotChat(), updateNexBotGreeting(), dan sendNexBotQuick()
// tetap tersedia sebagai global dari file itu.
// ===========================================================

async function loadLeaderboard() {
    try {
        const res = await fetch(`${API_BASE}/stats/leaderboard`);
        if (!res.ok) throw new Error("Gagal load leaderboard");
        const data = await res.json();
        renderLeaderboard(data);
    } catch (err) {
        console.warn("Leaderboard error:", err);
        const container = document.getElementById("leaderboardContent");
        if (container) container.innerHTML = `<div class="text-center text-red-400 py-10 glass-panel">Gagal memuat leaderboard</div>`;
    }
}

function renderLeaderboard(data) {
    const container = document.getElementById('leaderboardContent');
    if (!container) return;

    if (!data || data.length === 0) {
        container.innerHTML = `<div class="text-center text-gray-500 py-10 glass-panel rounded-2xl">Belum ada Top Spender</div>`;
        return;
    }

    // Podium: Top 3
    const top3 = data.slice(0, 3);
    const rest = data.slice(3, 10);
    
    let podiumHtml = `<div class="flex flex-row items-end justify-center gap-2 md:gap-6 lg:gap-10 mb-12 min-h-[300px]"> `;
    
    // Helper untuk avatar
    const getAvatar = (user) => {
        if (user.avatar_url) return `<img src="${user.avatar_url}" class="w-full h-full object-cover" style="width: 100%; height: 100%; max-width: 100%; max-height: 100%; object-fit: cover; display: block; flex-shrink: 0;">`;
        return `<div class="w-full h-full bg-gray-200 dark:bg-gray-800 flex items-center justify-center text-2xl font-bold text-gray-400 dark:text-gray-500" style="width: 100%; height: 100%; max-width: 100%; max-height: 100%; flex-shrink: 0;"><i class="fa-solid fa-user"></i></div>`;
    };
    
    // Helper untuk rank badge
    const getRankBadge = (rank) => {
        if (rank === 1) return '<div class="absolute -bottom-4 left-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-gradient-to-br from-amber-300 to-amber-500 border-2 border-white dark:border-gray-900 flex items-center justify-center text-gray-900 font-bold text-sm shadow-[0_0_15px_rgba(251,191,36,0.5)] z-20">1</div>';
        if (rank === 2) return '<div class="absolute -bottom-3 left-1/2 -translate-x-1/2 w-7 h-7 rounded-full bg-gradient-to-br from-slate-200 to-slate-400 dark:from-slate-300 dark:to-slate-500 border-2 border-white dark:border-gray-900 flex items-center justify-center text-gray-900 font-bold text-xs shadow-lg z-20">2</div>';
        if (rank === 3) return '<div class="absolute -bottom-3 left-1/2 -translate-x-1/2 w-7 h-7 rounded-full bg-gradient-to-br from-orange-300 to-orange-500 dark:from-orange-400 dark:to-orange-700 border-2 border-white dark:border-gray-900 flex items-center justify-center text-gray-900 font-bold text-xs shadow-lg z-20">3</div>';
        return '';
    };

    // Render Rank 2 (Left)
    if (top3[1]) {
        podiumHtml += `
        <div class="flex flex-col items-center w-1/3 px-1 md:px-0 transform hover:-translate-y-2 transition-transform duration-300">
            <div class="hof-avatar hof-avatar--2 rounded-full p-1 bg-gradient-to-b from-slate-300 to-slate-200 dark:from-slate-400 dark:to-gray-800 mb-2 md:mb-4 shadow-[0_0_20px_rgba(148,163,184,0.3)]">
                <div style="aspect-ratio: 1/1; width: 100%; height: 100%; max-width: 100%; max-height: 100%;" class="w-full h-full rounded-full overflow-hidden border-2 border-white dark:border-gray-900 relative z-10 bg-white dark:bg-gray-900 flex-shrink-0">
                    ${getAvatar(top3[1])}
                </div>
                ${getRankBadge(2)}
            </div>
            <div class="glass-panel w-full p-2 md:p-6 text-center border-t-4 border-slate-300 relative overflow-hidden group">
                <div class="absolute inset-0 bg-slate-400/5 translate-y-full group-hover:translate-y-0 transition-transform duration-300"></div>
                <div class="font-bold text-gray-900 dark:text-white text-xs md:text-xl mb-1 truncate relative z-10">${escapeHtml(top3[1].name)}</div>
                ${top3[1].badge ? `<div class="inline-block px-1 md:px-2 py-0.5 rounded text-[8px] md:text-[10px] font-bold bg-brand-indigo/10 dark:bg-brand-indigo/20 text-brand-indigo mb-1 md:mb-2 border border-brand-indigo/20 dark:border-brand-indigo/30 uppercase tracking-wider relative z-10">${escapeHtml(top3[1].badge)}</div>` : ''}
                <div class="text-gray-600 dark:text-gray-300 font-medium text-[10px] md:text-sm mt-1 relative z-10">${rupiah(top3[1].total_spent)}</div>
            </div>
        </div>`;
    }

    // Render Rank 1 (Center)
    if (top3[0]) {
        podiumHtml += `
        <div class="flex flex-col items-center w-1/3 px-1 md:px-0 transform hover:-translate-y-2 transition-transform duration-300 z-10" style="transform: translateY(-1rem);">
            <div class="hof-avatar hof-avatar--1 rounded-full p-1.5 bg-gradient-to-b from-amber-400 via-amber-300 to-amber-100 dark:to-gray-800 mb-3 md:mb-5 shadow-[0_0_30px_rgba(251,191,36,0.4)]">
                <div style="aspect-ratio: 1/1; width: 100%; height: 100%; max-width: 100%; max-height: 100%;" class="w-full h-full rounded-full overflow-hidden border-4 border-white dark:border-gray-900 relative z-10 bg-white dark:bg-gray-900 flex-shrink-0">
                    ${getAvatar(top3[0])}
                </div>
                ${getRankBadge(1)}
                <div class="absolute left-1/2 -translate-x-1/2 text-xl md:text-3xl animate-bounce" style="top: -1.25rem; color: #fbbf24;">
                    <i class="fa-solid fa-crown drop-shadow-[0_0_10px_rgba(251,191,36,0.8)]"></i>
                </div>
            </div>
            <div class="glass-panel w-full p-3 md:p-8 text-center border-t-4 border-amber-400 relative overflow-hidden group shadow-[0_0_30px_rgba(139,92,246,0.1)]">
                <div class="absolute inset-0 bg-gradient-to-t from-amber-400/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                <div class="font-bold text-sm md:text-2xl mb-1 truncate relative z-10" style="color: #fbbf24;">${escapeHtml(top3[0].name)}</div>
                ${top3[0].badge ? `<div class="inline-block px-1 md:px-2.5 py-0.5 md:py-1 rounded text-[8px] md:text-xs font-bold mb-1 md:mb-2 border uppercase tracking-wider relative z-10" style="background-color: rgba(251,191,36,0.15); color: #fbbf24; border-color: rgba(251,191,36,0.4);">${escapeHtml(top3[0].badge)}</div>` : ''}
                <div class="font-bold text-xs md:text-lg mt-1 relative z-10" style="color: #f59e0b;">${rupiah(top3[0].total_spent)}</div>
            </div>
        </div>`;
    }

    // Render Rank 3 (Right)
    if (top3[2]) {
        podiumHtml += `
        <div class="flex flex-col items-center w-1/3 px-1 md:px-0 transform hover:-translate-y-2 transition-transform duration-300">
            <div class="hof-avatar hof-avatar--3 rounded-full p-1 bg-gradient-to-b from-orange-400 to-orange-200 dark:from-orange-600 dark:to-gray-800 mb-2 md:mb-4 shadow-[0_0_20px_rgba(234,88,12,0.3)]">
                <div style="aspect-ratio: 1/1; width: 100%; height: 100%; max-width: 100%; max-height: 100%;" class="w-full h-full rounded-full overflow-hidden border-2 border-white dark:border-gray-900 relative z-10 bg-white dark:bg-gray-900 flex-shrink-0">
                    ${getAvatar(top3[2])}
                </div>
                ${getRankBadge(3)}
            </div>
            <div class="glass-panel w-full p-2 md:p-6 text-center border-t-4 border-orange-500 dark:border-orange-600 relative overflow-hidden group">
                <div class="absolute inset-0 bg-orange-600/5 translate-y-full group-hover:translate-y-0 transition-transform duration-300"></div>
                <div class="font-bold text-xs md:text-xl mb-1 truncate relative z-10" style="color: #f97316;">${escapeHtml(top3[2].name)}</div>
                ${top3[2].badge ? `<div class="inline-block px-1 md:px-2 py-0.5 rounded text-[8px] md:text-[10px] font-bold mb-1 md:mb-2 border uppercase tracking-wider relative z-10" style="background-color: rgba(249,115,22,0.1); color: #f97316; border-color: rgba(249,115,22,0.3);">${escapeHtml(top3[2].badge)}</div>` : ''}
                <div class="font-medium text-[10px] md:text-sm mt-1 relative z-10" style="color: #ea580c;">${rupiah(top3[2].total_spent)}</div>
            </div>
        </div>`;
    }
    podiumHtml += `</div>`;

    // Render List 4-10
    let listHtml = '';
    if (rest.length > 0) {
        listHtml = `
        <div class="glass-panel p-4 md:p-6 overflow-hidden max-w-3xl mx-auto">
            <h3 class="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <i class="fa-solid fa-ranking-star text-brand-indigo"></i> Top 10 Spenders
            </h3>
            <div class="space-y-3">
        `;
        rest.forEach((user, idx) => {
            const rank = idx + 4;
            listHtml += `
            <div class="flex items-center gap-4 p-3 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors border border-transparent hover:border-black/5 dark:hover:border-white/5 group">
                <div class="w-8 text-center font-bold text-gray-500 group-hover:text-gray-900 dark:group-hover:text-white transition-colors">#${rank}</div>
                <div class="w-10 h-10 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 aspect-square shrink-0">
                    ${getAvatar(user)}
                </div>
                <div class="flex-1 min-w-0">
                    <div class="font-bold text-gray-900 dark:text-white truncate text-sm">${escapeHtml(user.name)}</div>
                    ${user.badge ? `<div class="text-[10px] text-brand-cyan uppercase tracking-wide mt-0.5">${escapeHtml(user.badge)}</div>` : ''}
                </div>
                <div class="text-right shrink-0">
                    <div class="text-gray-600 dark:text-gray-300 font-medium text-sm">${rupiah(user.total_spent)}</div>
                </div>
            </div>
            `;
        });
        listHtml += `</div></div>`;
    }

    container.innerHTML = podiumHtml + listHtml;
}

function initNavScroll() {
    const nav = document.getElementById('mainNav');
    if (!nav) return;
    
    let ticking = false;
    
    window.addEventListener('scroll', () => {
        if (!ticking) {
            window.requestAnimationFrame(() => {
                if (window.scrollY > 20) {
                    nav.classList.add('nav-scrolled');
                } else {
                    nav.classList.remove('nav-scrolled');
                }
                ticking = false;
            });
            ticking = true;
        }
    }, { passive: true });
}

async function bootstrapApp() {
    initMobileMenu();
    initNavScroll();
    initProductGridInteractions();
    initThemeToggle();
    initSearchListeners();
    updateCartCount();
    checkResetPasswordLink();
    refreshAccountUI();
    initNexBotChat();
    loadPromo();

    const initialRequests = Promise.allSettled([
        loadStoreSettings(),
        loadProducts(),
        loadTopupProducts(),
        loadTrustStats(),
        loadNexshopNews(),
        loadTestimonials(),
        loadLeaderboard(),
        checkPaymentReturn(),
        initMusicPlayer()
    ]);
    // A stalled third-party/network request must not leave the page covered by
    // an indefinitely animated loader. Requests continue in the background.
    const completed = await Promise.race([
        initialRequests.then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 12000))
    ]);
    finishInitialLoading(!completed);
    
    if (currentUser && (!currentUser.phone || !/^(0|62)[0-9]{8,14}$/.test(currentUser.phone))) {
        openOverlay("phoneOverlay");
    }
}



function startApp() {
    bootstrapApp().catch(() => finishInitialLoading());
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startApp, { once: true });
} else {
    startApp();
}

// Global error handler for dynamically rendered images to comply with strict CSP
document.addEventListener('error', (e) => {
    if (e.target.tagName && e.target.tagName.toUpperCase() === 'IMG') {
        if (e.target.classList.contains('fallback-remove')) {
            e.target.remove();
        } else if (e.target.classList.contains('fallback-clear')) {
            e.target.src = '';
        }
    }
}, true); // Use capture phase because error events do not bubble

// Setup CSP-compliant event listeners for HTML elements
document.addEventListener('DOMContentLoaded', () => {
    const mobileMenuOverlay = document.getElementById('mobileMenuOverlay');
    const trackOrderBtn = document.getElementById('trackOrderBtn');

    const menuKatalogBtn = document.getElementById('menuKatalogBtn');
    if (menuKatalogBtn) {
        menuKatalogBtn.addEventListener('click', () => {
            if (mobileMenuOverlay) mobileMenuOverlay.classList.remove('active');
        });
    }

    const menuTopupBtn = document.getElementById('menuTopupBtn');
    if (menuTopupBtn) {
        menuTopupBtn.addEventListener('click', () => {
            if (mobileMenuOverlay) mobileMenuOverlay.classList.remove('active');
        });
    }

    const menuTrackBtn = document.getElementById('menuTrackBtn');
    if (menuTrackBtn) {
        menuTrackBtn.addEventListener('click', () => {
            if (mobileMenuOverlay) mobileMenuOverlay.classList.remove('active');
            if (trackOrderBtn) trackOrderBtn.click();
        });
    }

    const heroTrackBtn = document.getElementById('heroTrackBtn');
    if (heroTrackBtn) {
        heroTrackBtn.addEventListener('click', () => {
            if (trackOrderBtn) trackOrderBtn.click();
        });
    }

    document.querySelectorAll('.nexbot-quick-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            if (typeof window.sendNexBotQuick === 'function') {
                window.sendNexBotQuick(this.dataset.topic);
            }
        });
    });
});

async function initMusicPlayer() {
    try {
        const response = await fetch(`${API_BASE}/music/public`);
        if (!response.ok) return;
        const data = await response.json();

        const defaultMascot = document.getElementById("defaultMascot");
        const musicPlayerUI = document.getElementById("musicPlayerUI");
        
        if (data.enabled && data.music) {
            // Setup player UI
            const musicCoverImg = document.getElementById("musicCoverImg");
            const heroAudioPlayer = document.getElementById("heroAudioPlayer");
            const musicPlayBtn = document.getElementById("musicPlayBtn");
            const musicPlayIcon = document.getElementById("musicPlayIcon");
            const musicDisc = document.getElementById("musicDisc");
            
            if (musicCoverImg) musicCoverImg.src = data.music.cover_url || "https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?q=80&w=500&auto=format&fit=crop";
            if (heroAudioPlayer) heroAudioPlayer.src = data.music.audio_url;

            // Show play button
            if (musicPlayBtn) {
                musicPlayBtn.classList.remove("hidden");
                musicPlayBtn.classList.add("flex");
            }

            let isPlaying = false;
            
            if (heroAudioPlayer) {
                heroAudioPlayer.addEventListener("ended", () => {
                    isPlaying = false;
                    if (musicPlayIcon) {
                        musicPlayIcon.classList.remove("fa-pause");
                        musicPlayIcon.classList.add("fa-play", "ml-1");
                    }
                    if (musicDisc) musicDisc.classList.remove("animate-spin-slow");
                });
            }

            if (musicPlayBtn && heroAudioPlayer) {
                musicPlayBtn.addEventListener("click", () => {
                    if (isPlaying) {
                        heroAudioPlayer.pause();
                        isPlaying = false;
                        if (musicPlayIcon) {
                            musicPlayIcon.classList.remove("fa-pause");
                            musicPlayIcon.classList.add("fa-play", "ml-1");
                        }
                        if (musicDisc) musicDisc.classList.remove("animate-spin-slow");
                    } else {
                        heroAudioPlayer.play().catch(err => {
                            console.error("Audio play failed:", err);
                        });
                        isPlaying = true;
                        if (musicPlayIcon) {
                            musicPlayIcon.classList.remove("fa-play", "ml-1");
                            musicPlayIcon.classList.add("fa-pause");
                        }
                        if (musicDisc) musicDisc.classList.add("animate-spin-slow");
                    }
                });
            }
        }
    } catch (error) {
        console.error("Failed to load music player:", error);
    }
}


// ==========================================
// ONE STOP SOLUTION
// ==========================================

let oneStopCatalog = [];
let oneStopActiveCategory = "Semua";
let oneStopSearchQuery = "";

async function loadOneStopCatalog() {
    const grid = document.getElementById("oneStopOperatorGrid");
    if (!grid) return;
    
    grid.innerHTML = Array(12).fill(`
        <div class="glass-panel p-4 rounded-2xl flex flex-col items-center justify-center animate-pulse gap-3 border border-white/5">
            <div class="w-16 h-16 sm:w-20 sm:h-20 bg-gray-200 dark:bg-white/10 rounded-full"></div>
            <div class="w-3/4 h-4 bg-gray-200 dark:bg-white/10 rounded"></div>
            <div class="w-1/2 h-3 bg-gray-200 dark:bg-white/10 rounded mt-1"></div>
        </div>
    `).join("");

    try {
        const response = await fetch(`${API_BASE}/topup/public-catalog`, { headers: publicAuthHeaders() });
        if (!response.ok) throw new Error("Gagal mengambil katalog.");
        const data = await response.json();
        
        if (Array.isArray(data)) {
            oneStopCatalog = data;
        } else {
            console.error("Invalid catalog format:", data);
            oneStopCatalog = [];
        }

        renderOneStopCategories();
        renderOneStopOperators();

    } catch (err) {
        console.error("Error loading one-stop catalog:", err);
        grid.innerHTML = `
            <div class="col-span-full text-center py-12">
                <div class="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mx-auto mb-4 text-red-500">
                    <i class="fa-solid fa-circle-exclamation text-3xl" aria-hidden="true"></i>
                </div>
                <h3 class="text-xl font-bold text-gray-900 dark:text-white mb-2">Gagal Memuat Katalog</h3>
                <p class="text-gray-500 dark:text-gray-400">Silakan periksa koneksi internet atau refresh halaman.</p>
            </div>
        `;
    }
}

function renderOneStopCategories() {
    const nav = document.getElementById("oneStopCategoryNav");
    if (!nav) return;

    const categories = ["Semua", ...oneStopCatalog.map(c => c.category)];

    nav.innerHTML = categories.map(cat => {
        const isActive = cat === oneStopActiveCategory;
        const baseClass = "px-5 py-2.5 rounded-full font-bold text-sm transition-all whitespace-nowrap cursor-pointer";
        const activeClass = "bg-brand-indigo text-white shadow-lg shadow-brand-indigo/30";
        const inactiveClass = "bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10";
        
        return `<div class="${baseClass} ${isActive ? activeClass : inactiveClass}" data-category="${cat}">${cat}</div>`;
    }).join("");

    nav.querySelectorAll("div[data-category]").forEach(el => {
        el.addEventListener("click", () => {
            oneStopActiveCategory = el.dataset.category;
            renderOneStopCategories();
            renderOneStopOperators();
        });
    });
}

function renderOneStopOperators() {
    const grid = document.getElementById("oneStopOperatorGrid");
    if (!grid) return;

    let html = "";
    let matchCount = 0;
    const queryTokens = oneStopSearchQuery.toLowerCase().trim().split(/\s+/).filter(t => t);

    function matchesQuery(text) {
        if (!queryTokens.length) return true;
        if (!text) return false;
        const lowerText = text.toLowerCase();
        return queryTokens.every(token => lowerText.includes(token));
    }

    oneStopCatalog.forEach(categoryObj => {
        if (oneStopActiveCategory !== "Semua" && categoryObj.category !== oneStopActiveCategory) return;

        let categoryHtml = "";

        categoryObj.operators.forEach(op => {
            const matchCategory = matchesQuery(categoryObj.category);
            const matchOperator = matchesQuery(op.operator);
            
            const fallbackIcon = `<i class="fa-solid fa-gamepad text-4xl text-gray-400" aria-hidden="true"></i>`;
            const imgHtml = op.operator_logo 
                ? `<img src="${safeUrl(op.operator_logo)}" alt="${op.operator}" onerror="this.outerHTML='${fallbackIcon}'" class="w-full h-full object-contain drop-shadow-lg" loading="lazy">`
                : fallbackIcon;

            const opData = JSON.stringify({
                operator: op.operator,
                operator_logo: op.operator_logo,
                products: op.products
            }).replace(/'/g, "&#39;");

            if (matchCategory || matchOperator) {
                matchCount++;
                let minPrice = null;
                op.products.forEach(p => {
                    if (p.harga_jual !== undefined && p.harga_jual !== null) {
                        if (minPrice === null || p.harga_jual < minPrice) minPrice = p.harga_jual;
                    }
                });
                const priceHtml = minPrice !== null 
                    ? `<div class="font-bold text-transparent bg-clip-text bg-gradient-to-r from-brand-indigo to-brand-cyan text-[clamp(0.65rem,2vw,0.85rem)]">Mulai ${rupiah(minPrice)}</div>`
                    : `<div></div>`;

                categoryHtml += `
                    <div class="one-stop-card group glass-panel rounded-2xl p-4 flex flex-col items-center text-center cursor-pointer hover:-translate-y-1 transition-all hover:shadow-xl hover:border-brand-indigo/30 relative overflow-hidden" data-operator='${opData}'>
                        <div class="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-white dark:bg-[#0a0a0c] p-2 flex items-center justify-center mb-3 shadow-md border border-gray-100 dark:border-white/5 relative z-10 group-hover:scale-110 transition-transform">
                            ${imgHtml}
                        </div>
                        <h4 class="font-bold text-gray-900 dark:text-white text-[clamp(0.75rem,2.5vw,0.95rem)] leading-tight mb-1 relative z-10 line-clamp-2">${op.operator}</h4>
                        <div class="text-[clamp(0.65rem,2vw,0.75rem)] text-gray-500 font-semibold mb-2 relative z-10">${op.products.length} Produk</div>
                        <div class="mt-auto w-full pt-3 border-t border-gray-200 dark:border-white/10 flex justify-between items-center relative z-10">
                            ${priceHtml}
                            <div class="w-6 h-6 rounded-full bg-gray-100 dark:bg-white/5 flex items-center justify-center text-gray-600 dark:text-gray-300 group-hover:bg-brand-indigo group-hover:text-white transition-colors shrink-0">
                                <i class="fa-solid fa-arrow-right text-sm" aria-hidden="true"></i>
                            </div>
                        </div>
                    </div>
                `;
            } else if (queryTokens.length > 0) {
                const matchedProducts = op.products.filter(p => matchesQuery(p.nama));
                if (matchedProducts.length > 0) {
                    matchedProducts.forEach(p => {
                        matchCount++;
                        categoryHtml += `
                            <div class="one-stop-card group glass-panel rounded-2xl p-4 flex flex-col cursor-pointer hover:-translate-y-1 transition-all hover:shadow-xl hover:border-brand-indigo/30 relative overflow-hidden text-left" data-operator='${opData}' data-product='${escapeHtml(p.kode_produk)}'>
                                <div class="flex items-center gap-3 mb-3 relative z-10">
                                    <div class="w-10 h-10 rounded-xl bg-white dark:bg-[#0a0a0c] p-1.5 shadow-sm border border-gray-100 dark:border-white/5 shrink-0">
                                        ${imgHtml}
                                    </div>
                                    <div>
                                        <div class="text-[10px] text-brand-indigo dark:text-brand-cyan font-bold uppercase tracking-wider mb-0.5">${op.operator}</div>
                                        <h4 class="font-bold text-gray-900 dark:text-white text-sm leading-tight line-clamp-2">${p.nama}</h4>
                                    </div>
                                </div>
                                <div class="mt-auto w-full pt-3 border-t border-gray-200 dark:border-white/10 flex justify-between items-center relative z-10">
                                    <div class="font-bold text-gray-900 dark:text-white">${rupiah(p.harga_jual)}${hargaResellerHtml(p, "tw-price-normal")}</div>
                                    <div class="w-6 h-6 rounded-full bg-gray-100 dark:bg-white/5 flex items-center justify-center text-gray-600 dark:text-gray-300 group-hover:bg-brand-indigo group-hover:text-white transition-colors shrink-0">
                                        <i class="fa-solid fa-arrow-right text-sm" aria-hidden="true"></i>
                                    </div>
                                </div>
                            </div>
                        `;
                    });
                }
            }
        });

        if (categoryHtml) {
            if (oneStopActiveCategory === "Semua" && queryTokens.length === 0) {
                html += `
                    <div class="col-span-full mt-6 mb-2">
                        <h3 class="text-xl font-black text-gray-900 dark:text-white uppercase tracking-widest">${categoryObj.category}</h3>
                        <div class="w-12 h-1 bg-brand-cyan mt-1"></div>
                    </div>
                `;
            }
            html += categoryHtml;
        }
    });

    if (matchCount === 0) {
        html = `
            <div class="col-span-full flex flex-col items-center justify-center py-16 text-center">
                <div class="w-20 h-20 bg-gray-100 dark:bg-white/5 rounded-full flex items-center justify-center mb-4">
                    <i class="fa-solid fa-magnifying-glass-minus text-4xl text-gray-400" aria-hidden="true"></i>
                </div>
                <h3 class="text-xl font-bold text-gray-900 dark:text-white mb-2">Yah, layanan yang kamu cari belum ditemukan.</h3>
                <p class="text-gray-500 dark:text-gray-400 max-w-md">Coba cari dengan kata kunci lain atau pilih kategori yang tersedia.</p>
            </div>
        `;
    }

    grid.innerHTML = html;

    grid.querySelectorAll('.one-stop-card').forEach(card => {
        card.addEventListener('click', () => {
            try {
                const operatorData = JSON.parse(card.dataset.operator);
                const productId = card.dataset.product || null;
                
                const fakeGame = {
                    kategori: operatorData.operator,
                    logo: operatorData.operator_logo,
                    products: operatorData.products
                };

                openGameDetail(operatorData.operator, fakeGame, 'onestop', productId);
            } catch (err) {
                console.error("Error parsing operator data:", err);
            }
        });
    });
}

document.addEventListener("DOMContentLoaded", () => {
    const searchInput = document.getElementById("oneStopSearchInput");
    if (searchInput) {
        let debounceTimer;
        searchInput.addEventListener("input", (e) => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                oneStopSearchQuery = e.target.value;
                renderOneStopOperators();
            }, 300);
        });
    }
});


// ===========================================================
// BRIDGE dari Marketplace (halaman terpisah /marketplace.html) -- halaman
// itu cuma nampilin katalog & sengaja GAK punya form checkout sendiri
// (checkout tetap di satu tempat aja di sini biar logic pembayaran gak
// dobel/gampang out-of-sync). Waktu user klik "Beli" di Marketplace, dia
// diarahin balik ke sini bawa query ?market=<nama operator>&buy=<kode
// produk opsional>, lalu di sini dibuka flow checkout yang SAMA persis
// kayak yang dipakai grid Topup biasa.
// ===========================================================
// ===========================================================
// BRIDGE dari NexBot -- balasan chatbot bisa ngarahin ke aksi yang cuma
// ada di halaman ini (mis. modal Cek Transaksi), lewat link
// data-nexbot-action di nexbot.js. Kalau usernya WAKTU ITU lagi di
// halaman ini, link itu langsung manggil fungsinya (gak lewat sini sama
// sekali). Fungsi ini cuma jalan buat kasus usernya lagi di halaman LAIN
// (mis. marketplace.html yang gak muat script.js ini) -- link fallback-nya
// bawa dia balik kesini dengan ?nexbot_action=<nama>, lalu aksi yang sama
// dijalankan otomatis begitu halaman ini kebuka.
// ===========================================================
const NEXBOT_ACTION_HANDLERS = {
    track: () => openTrackModal()
};
function openNexBotActionFromQuery() {
    const params = new URLSearchParams(window.location.search);
    const action = params.get("nexbot_action");
    if (!action || typeof NEXBOT_ACTION_HANDLERS[action] !== "function") return;

    // Bersihin query string biar refresh/back gak numpuk aksinya lagi.
    window.history.replaceState({}, "", window.location.pathname);
    NEXBOT_ACTION_HANDLERS[action]();
}
document.addEventListener("DOMContentLoaded", openNexBotActionFromQuery);

async function openMarketplaceCheckoutFromQuery() {
    const params = new URLSearchParams(window.location.search);
    const marketOperator = params.get("market");
    if (!marketOperator) return;

    const buyProductId = params.get("buy");

    // Bersihin query string dari address bar biar gak kebuka ulang kalau
    // user nge-refresh atau pencet tombol back setelah ini.
    window.history.replaceState({}, "", window.location.pathname);

    try {
        if (!oneStopCatalog.length) {
            const response = await fetch(`${API_BASE}/topup/public-catalog`, { headers: publicAuthHeaders() });
            if (!response.ok) throw new Error("Gagal mengambil katalog.");
            const data = await response.json();
            oneStopCatalog = Array.isArray(data) ? data : [];
        }

        let foundOp = null;
        for (const categoryObj of oneStopCatalog) {
            foundOp = categoryObj.operators.find(o => o.operator === marketOperator);
            if (foundOp) break;
        }
        if (!foundOp) return;

        const fakeGame = {
            kategori: foundOp.operator,
            logo: foundOp.operator_logo,
            products: foundOp.products
        };
        openGameDetail(foundOp.operator, fakeGame, "marketplace", buyProductId);
    } catch (err) {
        console.error("Gagal membuka produk dari Marketplace:", err);
    }
}
document.addEventListener("DOMContentLoaded", openMarketplaceCheckoutFromQuery);

function openOneStopView(e) {
    if (e) e.preventDefault();
    
    // Hide other views
    document.getElementById("topupGameGrid").classList.add("hidden");
    document.getElementById("topupSearchFilter").classList.add("hidden");
    document.getElementById("topupDetail").classList.add("hidden");
    document.getElementById("topup").classList.remove("hidden");
    
    // Show One Stop
    const oneStopView = document.getElementById("view-onestop");
    if (oneStopView) {
        oneStopView.classList.remove("hidden");
        // Trigger reveal animation
        setTimeout(() => oneStopView.classList.add("revealed"), 50);
    }
    
    window.scrollTo({ top: 0, behavior: "smooth" });
}

function closeOneStopView() {
    const oneStopView = document.getElementById("view-onestop");
    if (oneStopView) oneStopView.classList.add("hidden");
    
    document.getElementById("topup").classList.remove("hidden");
    document.getElementById("topupGameGrid").classList.remove("hidden");
    document.getElementById("topupSearchFilter").classList.remove("hidden");
    document.getElementById("topupDetail").classList.add("hidden");
}

// CATATAN: #headerOneStopBtn & #menuOneStopBtn sekarang <a href="/marketplace">
// link navigasi BENERAN ke halaman terpisah marketplace.html -- bukan lagi
// toggle section tersembunyi di halaman ini (openOneStopView/closeOneStopView
// & section #view-onestop di bawah ini jadi gak kepakai lagi, sengaja
// dibiarin dulu -- gak ganggu, bisa dibersihin belakangan).

/* ==========================================================================
   NEXSHOP WALLET & DIRECT QRIS CONTROLLER (FRONTEND)
   ========================================================================== */

window.currentUserWallet = null;
let activeUserWalletTopupPoll = null;

async function fetchUserWallet() {
    const token = localStorage.getItem(PUBLIC_TOKEN_STORAGE_KEY);
    const balanceElements = document.querySelectorAll(".headerWalletBalanceVal");
    const modalBalanceEl = document.getElementById("walletUserBalance");
    const oldMktNavBalance = document.getElementById("mktNavWalletBalance");

    if (!token) {
        // "Saldo" (bukan "Masuk Saldo") -- kalimat panjang bikin pill wallet
        // di header mobile jadi lebar banget & bikin header keliatan sesak
        // (nabrak tombol Login/avatar di sebelahnya). "Saldo" tetap jelas
        // maksudnya karena konteksnya udah di dalem tombol berikon wallet.
        window.currentUserWallet = null;
        balanceElements.forEach(el => { el.textContent = "Saldo"; });
        if (oldMktNavBalance) oldMktNavBalance.textContent = "Saldo";
        if (modalBalanceEl) modalBalanceEl.textContent = "Rp 0";
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/wallet/me`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        if (!res.ok) {
            if (res.status === 401) {
                window.currentUserWallet = null;
                balanceElements.forEach(el => { el.textContent = "Saldo"; });
                if (oldMktNavBalance) oldMktNavBalance.textContent = "Saldo";
            }
            return;
        }

        const data = await res.json();
        if (data && data.wallet) {
            window.currentUserWallet = data.wallet;
            const formatted = rupiah(data.wallet.balance);
            balanceElements.forEach(el => { el.textContent = formatted; });
            if (oldMktNavBalance) oldMktNavBalance.textContent = formatted;
            if (modalBalanceEl) modalBalanceEl.textContent = formatted;

            // Re-render checkout balance jika checkout topup sedang terbuka
            if (typeof renderTwSummary === "function" && document.getElementById("twSummary")) {
                renderTwSummary();
            }
            if (typeof renderTopupPaymentGrid === "function" && document.getElementById("twPaymentGrid")) {
                renderTopupPaymentGrid();
            }
        }
    } catch (err) {
        console.warn("Gagal memuat saldo wallet:", err.message);
    }
}

async function loadWalletMutations() {
    const token = localStorage.getItem(PUBLIC_TOKEN_STORAGE_KEY);
    const listEl = document.getElementById("walletMutationsList");
    if (!listEl) return;

    if (!token) {
        listEl.innerHTML = `<div style="text-align:center;padding:1.5rem;font-size:0.8rem;color:var(--mkt-text-dim,#94a3b8);">Silakan login untuk melihat mutasi saldo.</div>`;
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/wallet/mutations?limit=15`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        const data = await res.json();
        const mutations = data.transactions || [];

        if (!mutations.length) {
            listEl.innerHTML = `
                <div class="nx-mutations-empty">
                    <div class="nx-empty-icon-box">
                        <i class="fa-solid fa-clock-rotate-left"></i>
                    </div>
                    <span class="nx-empty-title">Belum Ada Riwayat Transaksi</span>
                    <span class="nx-empty-desc">Transaksi dan top up saldo kamu akan tercatat di sini.</span>
                </div>
            `;
            return;
        }

        const TYPE_LABELS = {
            TOPUP: "Top Up Saldo",
            PURCHASE: "Pembelian Produk",
            REFUND: "Pengembalian Dana (Refund)",
            ADMIN_ADJUSTMENT: "Penyesuaian Admin",
            RESELLER_DEPOSIT: "Deposit Modal Reseller",
            RESELLER_PURCHASE: "Pembelian Reseller API",
            RESELLER_REFUND: "Refund Pesanan Reseller"
        };

        listEl.innerHTML = mutations.map(m => {
            const isIn = m.direction === "IN";
            const label = TYPE_LABELS[m.type] || m.type;
            const dateStr = m.created_at ? new Date(m.created_at).toLocaleDateString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "-";
            const iconClass = isIn ? "fa-arrow-trend-up" : "fa-arrow-trend-down";
            return `
                <div class="wallet-mutation-item">
                    <div style="display:flex;align-items:center;gap:10px;">
                        <div class="wallet-mutation-icon ${isIn ? 'in' : 'out'}">
                            <i class="fa-solid ${iconClass}"></i>
                        </div>
                        <div>
                            <div class="wallet-mutation-desc">${escapeHtml(label)}</div>
                            <div class="wallet-mutation-meta">${dateStr} · Ref: ${escapeHtml(m.reference_id || "-")}</div>
                        </div>
                    </div>
                    <div class="wallet-mutation-amount ${isIn ? 'in' : 'out'}">
                        ${isIn ? '+' : '-'} ${rupiah(m.amount)}
                    </div>
                </div>
            `;
        }).join("");
    } catch (err) {
        listEl.innerHTML = `<div style="text-align:center;padding:1.5rem;font-size:0.8rem;color:#f87171;">Gagal memuat mutasi.</div>`;
    }
}

function openWalletModal(e) {
    if (e && typeof e.preventDefault === "function") e.preventDefault();
    const token = localStorage.getItem(PUBLIC_TOKEN_STORAGE_KEY) || localStorage.getItem("nexshop-public-token") || localStorage.getItem("token");
    if (!token) {
        if (typeof toast === "function") {
            toast("Silakan login terlebih dahulu untuk mengakses NexShop Wallet.", "info");
        }
        const accBtn = document.getElementById("accountBtn");
        if (accBtn) accBtn.click();
        return;
    }

    const overlay = document.getElementById("walletModalOverlay");
    if (!overlay) return;

    // Reset views
    const viewOverview = document.getElementById("walletViewOverview");
    const viewTopup = document.getElementById("walletViewTopup");
    const viewQris = document.getElementById("walletViewQris");
    const viewSuccess = document.getElementById("walletViewSuccess");

    if (viewOverview) viewOverview.style.display = "block";
    if (viewTopup) viewTopup.style.display = "none";
    if (viewQris) viewQris.style.display = "none";
    if (viewSuccess) viewSuccess.style.display = "none";

    overlay.style.display = "";
    if (typeof openOverlay === "function") {
        openOverlay("walletModalOverlay");
    } else {
        overlay.classList.add("active");
        overlay.classList.add("is-visible");
        document.body.style.overflow = "hidden";
    }

    fetchUserWallet();
    loadWalletMutations();
}

function closeWalletModal(e) {
    if (e && typeof e.preventDefault === "function") e.preventDefault();
    if (typeof closeOverlay === "function") {
        closeOverlay("walletModalOverlay");
    } else {
        const overlay = document.getElementById("walletModalOverlay");
        if (overlay) {
            overlay.classList.remove("active");
            overlay.classList.remove("is-visible");
            document.body.style.overflow = "";
        }
    }

    if (activeUserWalletTopupPoll) {
        clearInterval(activeUserWalletTopupPoll);
        activeUserWalletTopupPoll = null;
    }
}

function initWalletUI() {
    // Global Event Delegation for ANY wallet trigger
    // Fase CAPTURE + normalisasi text node (lihat closestFromEvent).
    // Capture dipakai supaya handler ini gak bisa dimatikan oleh
    // stopPropagation() dari listener lain di jalur bubble, dan supaya
    // trigger yang di-render belakangan (mis. kartu wallet di drawer
    // mobile) tetap kebaca tanpa perlu re-bind.
    document.addEventListener("click", (event) => {
        const trigger = closestFromEvent(event.target, "[data-wallet-trigger]");
        if (!trigger) return;
        event.preventDefault();
        // Kartu wallet ada juga di dalam drawer menu mobile. Drawer-nya
        // harus ditutup duluan: kalau nggak, drawer ketinggalan kebuka di
        // belakang bottom sheet wallet, dan pas wallet ditutup body
        // overflow-nya ikut kereset padahal drawer masih aktif.
        if (trigger.closest("#mobileMenuOverlay")) {
            closeOverlay("mobileMenuOverlay");
        }
        openWalletModal();
    }, true);

    // Kartu wallet di drawer mobile itu <div role="button" tabindex="0">,
    // jadi Enter/Space harus dijembatani manual.
    document.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar") return;
        const trigger = closestFromEvent(event.target, '[data-wallet-trigger][role="button"]');
        if (!trigger) return;
        event.preventDefault();
        if (trigger.closest("#mobileMenuOverlay")) closeOverlay("mobileMenuOverlay");
        openWalletModal();
    });

    // Close Button
    const closeBtn = document.getElementById("closeWalletModalBtn");
    if (closeBtn) closeBtn.addEventListener("click", closeWalletModal);

    const overlay = document.getElementById("walletModalOverlay");
    if (overlay) {
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) closeWalletModal();
        });
    }

    // Refresh Button
    const refreshBtn = document.getElementById("btnRefreshWallet");
    if (refreshBtn) {
        refreshBtn.addEventListener("click", () => {
            fetchUserWallet();
            loadWalletMutations();
        });
    }

    // View Navigation
    const openTopupBtn = document.getElementById("btnOpenTopupView");
    if (openTopupBtn) {
        openTopupBtn.addEventListener("click", () => {
            document.getElementById("walletViewOverview").style.display = "none";
            document.getElementById("walletViewTopup").style.display = "block";
            document.getElementById("walletViewQris").style.display = "none";
            document.getElementById("walletViewSuccess").style.display = "none";
            const expView = document.getElementById("walletViewExpired");
            if (expView) expView.style.display = "none";
            
            // Default select Rp 100.000 on open
            selectPresetAmount(100000);
        });
    }

    const backBtn = document.getElementById("btnBackToWalletOverview");
    if (backBtn) {
        backBtn.addEventListener("click", () => {
            document.getElementById("walletViewTopup").style.display = "none";
            document.getElementById("walletViewOverview").style.display = "block";
        });
    }

    // --- Currency Formatter & Presets Helpers ---
    const customInput = document.getElementById("inputCustomTopupAmount");
    const clearBtn = document.getElementById("btnClearCustomAmount");
    const helperText = document.getElementById("amountHelperText");
    const errorText = document.getElementById("amountErrorText");
    const submitBtn = document.getElementById("btnSubmitTopup");
    const wrapper = customInput ? customInput.closest(".nx-custom-amount-wrapper") : null;

    function formatNumberThousand(val) {
        if (!val && val !== 0) return "";
        return val.toString().replace(/\D/g, "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    }

    function getNumericAmount() {
        if (!customInput) return 0;
        const clean = customInput.value.replace(/\D/g, "");
        return parseInt(clean, 10) || 0;
    }

    function validateAmount() {
        const amount = getNumericAmount();
        if (clearBtn) {
            clearBtn.style.display = amount > 0 ? "inline-block" : "none";
        }

        if (amount === 0) {
            if (wrapper) wrapper.classList.remove("invalid");
            if (errorText) errorText.style.display = "none";
            if (helperText) helperText.style.display = "inline";
            if (submitBtn) {
                submitBtn.disabled = true;
                const textSpan = document.getElementById("btnSubmitTopupText");
                if (textSpan) textSpan.textContent = "Pilih / Masukkan Nominal";
            }
            return false;
        }

        if (amount < 10000) {
            if (wrapper) wrapper.classList.add("invalid");
            if (errorText) {
                errorText.textContent = "Minimal top up Rp 10.000";
                errorText.style.display = "inline";
            }
            if (helperText) helperText.style.display = "none";
            if (submitBtn) {
                submitBtn.disabled = true;
                const textSpan = document.getElementById("btnSubmitTopupText");
                if (textSpan) textSpan.textContent = "Minimal Rp 10.000";
            }
            return false;
        }

        if (amount > 10000000) {
            if (wrapper) wrapper.classList.add("invalid");
            if (errorText) {
                errorText.textContent = "Maksimal top up Rp 10.000.000";
                errorText.style.display = "inline";
            }
            if (helperText) helperText.style.display = "none";
            if (submitBtn) {
                submitBtn.disabled = true;
                const textSpan = document.getElementById("btnSubmitTopupText");
                if (textSpan) textSpan.textContent = "Maksimal Rp 10.000.000";
            }
            return false;
        }

        // Valid
        if (wrapper) wrapper.classList.remove("invalid");
        if (errorText) errorText.style.display = "none";
        if (helperText) {
            helperText.style.display = "inline";
            helperText.textContent = "Min. Rp 10.000 • Maks. Rp 10.000.000";
        }
        if (submitBtn) {
            submitBtn.disabled = false;
            const textSpan = document.getElementById("btnSubmitTopupText");
            if (textSpan) textSpan.textContent = "Lanjutkan Pembayaran";
        }
        return true;
    }

    function selectPresetAmount(amount) {
        if (!customInput) return;
        customInput.value = formatNumberThousand(amount);
        document.querySelectorAll(".nx-preset-card").forEach(btn => {
            const btnAmt = parseInt(btn.dataset.amount, 10);
            btn.classList.toggle("selected", btnAmt === amount);
        });
        validateAmount();
    }

    // Preset cards click
    document.querySelectorAll(".nx-preset-card").forEach(btn => {
        btn.addEventListener("click", () => {
            const amount = parseInt(btn.dataset.amount, 10);
            selectPresetAmount(amount);
        });
    });

    // Custom input real-time typing
    if (customInput) {
        customInput.addEventListener("input", () => {
            const rawDigits = customInput.value.replace(/\D/g, "");
            customInput.value = formatNumberThousand(rawDigits);

            const amt = parseInt(rawDigits, 10) || 0;
            document.querySelectorAll(".nx-preset-card").forEach(btn => {
                const btnAmt = parseInt(btn.dataset.amount, 10);
                btn.classList.toggle("selected", btnAmt === amt);
            });

            validateAmount();
        });
    }

    if (clearBtn) {
        clearBtn.addEventListener("click", () => {
            if (customInput) customInput.value = "";
            document.querySelectorAll(".nx-preset-card").forEach(btn => btn.classList.remove("selected"));
            validateAmount();
            if (customInput) customInput.focus();
        });
    }

    // Payment Method Cards
    const cardQris = document.getElementById("cardMethodQris");
    const cardVa = document.getElementById("cardMethodVa");
    if (cardQris && cardVa) {
        cardQris.addEventListener("click", () => {
            cardQris.classList.add("active");
            cardVa.classList.remove("active");
            const inp = cardQris.querySelector("input");
            if (inp) inp.checked = true;
        });
        cardVa.addEventListener("click", () => {
            cardVa.classList.add("active");
            cardQris.classList.remove("active");
            const inp = cardVa.querySelector("input");
            if (inp) inp.checked = true;
        });
    }

    // Submit Top Up
    if (submitBtn) {
        submitBtn.addEventListener("click", async () => {
            const token = localStorage.getItem(PUBLIC_TOKEN_STORAGE_KEY) || localStorage.getItem("nexshop-public-token") || localStorage.getItem("token");
            if (!token) {
                if (typeof toast === "function") toast("Silakan login terlebih dahulu.", "info");
                return;
            }

            if (!validateAmount()) return;
            const amount = getNumericAmount();

            const methodInput = document.querySelector("input[name='walletTopupPaymentMethod']:checked");
            const paymentMethod = methodInput ? methodInput.value : "qris";

            submitBtn.disabled = true;
            submitBtn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> <span>Menyiapkan Tagihan...</span>`;

            try {
                const res = await fetch(`${API_BASE}/wallet/topup`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${token}`
                    },
                    body: JSON.stringify({ amount, payment_method: paymentMethod })
                });

                const data = await res.json();
                if (!res.ok) throw new Error(data.message || "Gagal membuat invoice top up");

                if (paymentMethod === "qris" || (data.is_direct && data.qr_content)) {
                    // DIRECT QRIS — Render langsung di dalam modal tanpa redirect!
                    const qrUrl = data.qr_image || `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(data.qr_content)}`;
                    const qrImg = document.getElementById("qrisImageElement");
                    if (qrImg) qrImg.src = qrUrl;

                    const dispAmount = document.getElementById("qrisDisplayAmount");
                    if (dispAmount) dispAmount.textContent = rupiah(amount);

                    document.getElementById("walletViewTopup").style.display = "none";
                    document.getElementById("walletViewQris").style.display = "block";

                    // Polling status transaksi tiap 3.5 detik
                    if (activeUserWalletTopupPoll) clearInterval(activeUserWalletTopupPoll);
                    let pollCount = 0;
                    activeUserWalletTopupPoll = setInterval(async () => {
                        pollCount++;
                        if (pollCount > 60) {
                            clearInterval(activeUserWalletTopupPoll);
                            activeUserWalletTopupPoll = null;
                            const expView = document.getElementById("walletViewExpired");
                            if (expView) {
                                document.getElementById("walletViewQris").style.display = "none";
                                expView.style.display = "block";
                            }
                            return;
                        }
                        try {
                            const checkRes = await fetch(`${API_BASE}/wallet/topup/${data.topup_id}`, {
                                headers: { "Authorization": `Bearer ${token}` }
                            });
                            const checkData = await checkRes.json();
                            if (checkData.status === "PAID") {
                                clearInterval(activeUserWalletTopupPoll);
                                activeUserWalletTopupPoll = null;

                                // Tampilkan layar sukses
                                document.getElementById("walletViewQris").style.display = "none";
                                document.getElementById("walletViewSuccess").style.display = "block";
                                const copyEl = document.getElementById("successTopupCopy");
                                if (copyEl) copyEl.textContent = `Saldo sebesar ${rupiah(amount)} telah berhasil ditambahkan ke dompet kamu.`;

                                fetchUserWallet().then(() => {
                                    const successNewBal = document.getElementById("successNewBalance");
                                    if (successNewBal && window.currentUserWallet) {
                                        successNewBal.textContent = rupiah(window.currentUserWallet.balance);
                                    }
                                });
                                loadWalletMutations();
                            } else if (checkData.status === "FAILED" || checkData.status === "EXPIRED" || checkData.status === "CANCELLED") {
                                clearInterval(activeUserWalletTopupPoll);
                                activeUserWalletTopupPoll = null;
                                const expView = document.getElementById("walletViewExpired");
                                const expTitle = document.getElementById("expiredViewTitle");
                                const expCopy = document.getElementById("expiredViewCopy");
                                if (expTitle) expTitle.textContent = checkData.status === "EXPIRED" ? "Pembayaran Kedaluwarsa" : "Pembayaran Gagal / Dibatalkan";
                                if (expCopy) expCopy.textContent = "Waktu pembayaran QRIS telah habis atau invoice telah dibatalkan.";
                                document.getElementById("walletViewQris").style.display = "none";
                                if (expView) expView.style.display = "block";
                            }
                        } catch (_) {}
                    }, 3500);
                } else if (data.payment_url) {
                    window.location.href = data.payment_url;
                }
            } catch (err) {
                if (typeof toast === "function") toast("Gagal memproses top up: " + err.message, "error");
                else alert("Gagal memproses top up: " + err.message);
            } finally {
                submitBtn.disabled = false;
                submitBtn.innerHTML = `<span id="btnSubmitTopupText">Lanjutkan Pembayaran</span> <i class="fa-solid fa-arrow-right nx-cta-arrow"></i>`;
            }
        });
    }

    // Cancel QRIS
    const cancelQrisBtn = document.getElementById("btnCancelQris");
    if (cancelQrisBtn) {
        cancelQrisBtn.addEventListener("click", () => {
            if (activeUserWalletTopupPoll) {
                clearInterval(activeUserWalletTopupPoll);
                activeUserWalletTopupPoll = null;
            }
            document.getElementById("walletViewQris").style.display = "none";
            document.getElementById("walletViewOverview").style.display = "block";
        });
    }

    // Retry from expired
    const retryBtn = document.getElementById("btnRetryTopup");
    if (retryBtn) {
        retryBtn.addEventListener("click", () => {
            const expView = document.getElementById("walletViewExpired");
            if (expView) expView.style.display = "none";
            document.getElementById("walletViewTopup").style.display = "block";
            selectPresetAmount(100000);
        });
    }

    // Close Success
    const closeSuccessBtn = document.getElementById("btnCloseSuccessWallet");
    if (closeSuccessBtn) {
        closeSuccessBtn.addEventListener("click", () => {
            document.getElementById("walletViewSuccess").style.display = "none";
            document.getElementById("walletViewOverview").style.display = "block";
            fetchUserWallet();
            loadWalletMutations();
        });
    }

    // Initial Load & default preset
    fetchUserWallet();
}

document.addEventListener("DOMContentLoaded", initWalletUI);


