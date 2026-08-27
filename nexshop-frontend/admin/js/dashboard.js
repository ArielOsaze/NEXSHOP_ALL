// ================================
// NexShop Dashboard
// ================================

const ADMIN_TOKEN_STORAGE_KEY = "nexshop-admin-token";
const token = localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY);
let adminPinResolver = null;
let adminLogoutResolver = null;
const API_BASE = (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
    ? (window.location.port === "3000" ? "/api" : "http://localhost:3000/api")
    : (window.location.protocol.startsWith("http") ? "/api" : "https://nexshop.cloud/api");

if (!token) {
    window.location.href = "/admin/login.html";
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
let waApiManagerLoaded = false;
let ratingsLoaded = false;
let musicPlayerLoaded = false;
let currentUser = null;

async function loadCurrentUser() {
    try {
        const res = await apiFetch("/settings/me");
        if (res.ok) {
            currentUser = await res.json();
            document.getElementById("topbarUserName").textContent = currentUser.fullname || currentUser.name || "Admin";

            const roleBadge = document.getElementById("topbarUserRole");
            if (currentUser.role === "staff") {
                roleBadge.textContent = "Staff";
                roleBadge.classList.replace("bg-primary", "bg-secondary");

                // Staff tetap bisa melihat Settings Toko untuk mengajukan perubahan,
                // tetapi area credential/integrasi sensitif tetap disembunyikan.
                document.querySelectorAll('.nav-link[data-view="waApi"], .nav-link[data-view="aimgmt"], .nav-link[data-view="musicplayer"]').forEach(el => {
                    el.closest('.nav-item').style.display = 'none';
                });
                document.getElementById("staffSettingsApprovalNotice")?.classList.remove("d-none");
                const logoInput = document.getElementById("storeLogoInput");
                if (logoInput) logoInput.disabled = true;
                document.querySelectorAll('#settingsTabApiKeys, #settingsTabAuthconfig, #settingsTabSecurity, #settingsTabMascot').forEach(el => el.classList.add("d-none"));
                document.querySelectorAll('[data-settings-tab="apikeys"], [data-settings-tab="authconfig"], [data-settings-tab="security"], [data-settings-tab="mascot"]').forEach(el => el.closest(".nav-item")?.classList.add("d-none"));
                document.querySelectorAll('#storeForm button[onclick="saveStoreSettings()"], #contentForm button[onclick="saveContentSettings()"], button[onclick="saveMascotSettings()"]').forEach(button => {
                    button.innerHTML = '<i class="bi bi-send me-1"></i> Ajukan Approval Admin';
                });
            } else {
                roleBadge.textContent = "Admin";
            }
            loadApprovals();
        }
    } catch (err) {
        console.error("Gagal memuat profil admin:", err);
    }
}
let topupProductsLoaded = false;
let statsLoaded = false;
let topupOrdersLoaded = false;
let promoCodesLoaded = false;
let newsEntries = [];
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

// Modal "Edit Produk Topup" versi lama sudah diganti drawer di
// js/catalogSync.js (openProductDrawer), jadi elemen + state-nya dibuang.
let topupProducts = [];
let topupOrders = [];
let productSearchQuery = "";
let productCategoryFilterValue = "";
let productFlashFilterValue = "";

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
    // background: true -> request polling latar (notifikasi, status sync).
    //   Ditandai ke server lewat header supaya TIDAK dihitung sebagai
    //   aktivitas admin -- kalau dihitung, sesi idle gak akan pernah habis.
    // bypassGate: true -> khusus permintaan milik gerbang akses itu sendiri
    //   (verifikasi role & Security PIN), biar gak nunggu dirinya sendiri.
    const { background = false, bypassGate = false, ...fetchOptions } = options;

    if (!adminGateOpen && !bypassGate) await adminGateReady;

    const headers = {
        ...(fetchOptions.headers || {}),
        Authorization: "Bearer " + token
    };
    if (background) headers["X-Admin-Background"] = "1";

    const res = await fetch(`${API_BASE}${path}`, { ...fetchOptions, headers });

    if ((res.status === 401 || res.status === 403) && res.headers.get("X-Admin-Pin-Error") !== "1") {
        const info = await res.clone().json().catch(() => ({}));
        if (info.code === "ADMIN_IDLE_TIMEOUT") return forceAdminLogout("idle");
        if (info.code === "ADMIN_ACCESS_REVOKED") return forceAdminLogout("forbidden");

        if (res.status === 401) {
            localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
            showToast("Sesi kamu berakhir, silakan login kembali.", true);
            setTimeout(() => window.location.href = "/admin/login.html", 1200);
            throw new Error("unauthorized");
        }
    }

    return res;
}

function adminPinModalInstance() {
    return bootstrap.Modal.getOrCreateInstance(document.getElementById("adminPinModal"), { backdrop: "static", keyboard: false });
}

async function getAdminPinStatus() {
    const res = await apiFetch("/settings/security-pin", { bypassGate: true });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || "Gagal memeriksa Security PIN Admin");
    return data;
}

function requestAdminPin(setup, purpose = "melanjutkan tindakan sensitif ini") {
    document.getElementById("adminPinModalTitle").textContent = setup ? "Buat Security PIN Admin" : "Security PIN Admin";
    document.getElementById("adminPinHelp").textContent = setup
        ? "Buat PIN 6 digit terpisah dari password login. PIN ini wajib untuk membuka atau mengubah konfigurasi sensitif."
        : `Masukkan Security PIN 6 digit untuk ${purpose}.${purpose && purpose.includes("dashboard") ? "" : " PIN hanya berlaku untuk tindakan ini."
        }`;
    document.getElementById("adminPinConfirmation").classList.toggle("d-none", !setup);
    document.getElementById("adminPinSubmit").textContent = setup ? "Simpan Security PIN" : "Verifikasi PIN";
    document.getElementById("adminPinInput").value = "";
    document.getElementById("adminPinConfirmation").value = "";
    document.getElementById("adminPinError").textContent = "";
    document.getElementById("adminPinModal").dataset.mode = setup ? "setup" : "verify";
    // BUG FIX: dulu show() dipanggil langsung. Kalau modal yang sebelumnya
    // BARU SAJA di-hide (mis. alur "buat PIN" lalu langsung "verifikasi
    // PIN"), event hidden.bs.modal dari modal lama baru sampai SETELAH
    // resolver baru dipasang -- handler-nya lalu me-REJECT permintaan yang
    // baru, jadi gerbang dashboard nyangkut di "verifikasi dibatalkan"
    // padahal user gak membatalkan apa pun. Sekarang tunggu sampai modal
    // benar-benar tertutup dulu, baru dibuka lagi.
    const modalEl = document.getElementById("adminPinModal");
    const promise = new Promise((resolve, reject) => { adminPinResolver = { resolve, reject }; });

    if (modalEl.classList.contains("show")) {
        modalEl.addEventListener("hidden.bs.modal", () => {
            adminPinModalInstance().show();
            setTimeout(() => document.getElementById("adminPinInput").focus(), 150);
        }, { once: true });
    } else {
        adminPinModalInstance().show();
        setTimeout(() => document.getElementById("adminPinInput").focus(), 150);
    }

    return promise;
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
            method: "POST", bypassGate: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify(setup ? { pin, confirmation } : { pin })
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

// ===========================================================
// GERBANG AKSES + SESI IDLE DASHBOARD ADMIN
//
// Punya token di localStorage TIDAK otomatis berarti boleh masuk. Sebelum
// gerbang ini kebuka:
//   1. role user diambil ULANG dari server (/settings/me) dan harus
//      admin/staff -- bukan cuma ngandelin isi token;
//   2. Security PIN 6 digit wajib diverifikasi ke server (kalau belum
//      pernah dibuat, admin dipaksa bikin dulu).
//
// Selama gerbang belum kebuka, apiFetch() nahan SEMUA permintaan data, jadi
// isi dashboard gak pernah ke-load apalagi kelihatan di layar.
//
// Sesi juga berakhir otomatis setelah 15 menit tanpa aktivitas. Timer di sini
// cuma sisi tampilan; batas yang sebenarnya ditegakkan server (lihat
// middleware/adminSession.js), jadi gak bisa dilewatin dengan mematikan JS.
// ===========================================================
const ADMIN_IDLE_LIMIT_MS = 15 * 60 * 1000;
const ADMIN_IDLE_WARNING_MS = 60 * 1000; // peringatan 1 menit sebelum habis
const ADMIN_LAST_ACTIVITY_KEY = "nexshop_admin_last_activity";

// Dulu gak ada apa pun yang diingat setelah Security PIN diverifikasi --
// bootAdminGate() jalan dari nol tiap kali script dimuat, jadi REFRESH
// HALAMAN BIASA pun dianggap sesi baru dan PIN ditanya lagi. Flag ini
// sengaja pakai sessionStorage (bukan localStorage): bertahan lewat
// refresh, tapi otomatis hilang begitu tab/browser ditutup -- dan
// forceAdminLogout() ikut menghapusnya begitu sesi berakhir (logout
// manual maupun idle timeout), jadi login baru selalu minta PIN lagi.
// Verifikasi PIN per-aksi sensitif lain (withAdminPin) TIDAK kepengaruh
// oleh flag ini -- itu tetap minta PIN setiap kali sesuai desain awal.
const ADMIN_PIN_TRUST_KEY = "nexshop_admin_pin_trusted";

function markAdminPinTrusted() {
    try { sessionStorage.setItem(ADMIN_PIN_TRUST_KEY, "1"); } catch (e) { /* sessionStorage diblokir -- gerbang tetap jalan, cuma gak ke-skip pas refresh */ }
}

function isAdminPinTrusted() {
    try { return sessionStorage.getItem(ADMIN_PIN_TRUST_KEY) === "1"; } catch (e) { return false; }
}

let adminGateOpen = false;
let openAdminGate;
const adminGateReady = new Promise((resolve) => {
    openAdminGate = resolve;
});

function setAdminGateStatus(html, isError = false) {
    const el = document.getElementById("adminGateStatus");
    if (!el) return;
    el.innerHTML = html;
    el.classList.toggle("is-error", isError);
    const actions = document.getElementById("adminGateActions");
    if (actions) actions.classList.toggle("d-none", !isError);
}

function forceAdminLogout(reason = "expired") {
    localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
    localStorage.removeItem(ADMIN_LAST_ACTIVITY_KEY);
    try { sessionStorage.removeItem(ADMIN_PIN_TRUST_KEY); } catch (e) { /* noop */ }
    if (reason !== "manual") localStorage.setItem("nexshop_admin_logout_reason", reason);
    window.location.replace("/admin/login.html");
    // Dilempar biar pemanggilnya berhenti; semua caller udah nge-handle
    // pesan "unauthorized" sebagai kondisi diam (gak nampilin toast error).
    throw new Error("unauthorized");
}

async function bootAdminGate() {
    setAdminGateStatus(`<span class="spinner-border spinner-border-sm me-2"></span>Memverifikasi akses…`);

    let me = null;
    try {
        const res = await apiFetch("/settings/me", { bypassGate: true });
        if (res.status === 401 || res.status === 403) return forceAdminLogout("expired");
        if (!res.ok) throw new Error("Gagal memverifikasi akun");
        me = await res.json();
    } catch (err) {
        if (err.message === "unauthorized") return;
        setAdminGateStatus("Gagal menghubungi server. Periksa koneksi lalu coba lagi.", true);
        return;
    }

    if (!me || !["admin", "staff"].includes(me.role)) {
        return forceAdminLogout("forbidden");
    }
    currentUser = me;

    // ── Security PIN ────────────────────────────────────────────────────
    // Gerbang PIN JANGAN sampai bikin admin ke-lock permanen. Kalau
    // subsistem PIN-nya sendiri lagi bermasalah (mis. kolom
    // security_pin_hash belum ada karena migration Security PIN belum
    // dijalankan), dashboard tetap boleh dibuka setelah role terverifikasi
    // -- endpoint sensitif TETAP minta PIN satu per satu di server, jadi
    // gak ada penurunan keamanan yang berarti.
    let statusPin = null;
    try {
        statusPin = await getAdminPinStatus();
    } catch (err) {
        if (err.message === "unauthorized") return;
        tampilkanLewatiPin(`Security PIN tidak bisa diperiksa: ${err.message}`);
        return;
    }

    try {
        if (!statusPin.configured) {
            setAdminGateStatus("Security PIN belum dibuat. Buat PIN 6 digit dulu untuk membuka dashboard.");
            // Berhasil membuat PIN = identitas sudah terbukti di sesi ini,
            // jadi gak perlu langsung disuruh mengetik PIN yang sama lagi.
            await requestAdminPin(true, "mengaktifkan Security PIN dashboard");
            markAdminPinTrusted();
        } else if (isAdminPinTrusted()) {
            // PIN dashboard sudah diverifikasi sebelumnya di tab ini (mis.
            // user cuma nge-refresh) -- gak perlu nanya lagi tiap reload.
            setAdminGateStatus("Membuka dashboard…");
        } else {
            setAdminGateStatus("Masukkan Security PIN untuk membuka dashboard.");
            await requestAdminPin(false, "membuka dashboard admin");
            markAdminPinTrusted();
        }
    } catch (err) {
        if (err.message === "unauthorized") return;
        setAdminGateStatus(`${escapeHtml(err.message || "Verifikasi Security PIN dibatalkan")}. Dashboard tetap terkunci.`, true);
        return;
    }

    unlockAdminDashboard();
}

function retryAdminGate() {
    document.getElementById("adminGateSkip")?.classList.add("d-none");
    bootAdminGate();
}

// Ditampilkan HANYA kalau pemeriksaan Security PIN sendiri gagal (bukan
// karena PIN salah). Role admin/staff-nya sudah terverifikasi ke server
// sebelum tombol ini muncul, dan semua endpoint sensitif tetap minta PIN
// per aksi -- jadi ini pintu darurat, bukan bypass keamanan.
function tampilkanLewatiPin(pesan) {
    setAdminGateStatus(escapeHtml(pesan), true);
    const skip = document.getElementById("adminGateSkip");
    if (skip) skip.classList.remove("d-none");
}

function lewatiGerbangPin() {
    showToast("Masuk tanpa Security PIN. Aksi sensitif tetap minta PIN.", true);
    unlockAdminDashboard();
}

function unlockAdminDashboard() {
    adminGateOpen = true;
    const overlay = document.getElementById("adminGateOverlay");
    if (overlay) overlay.classList.add("is-open");
    markAdminActivity();
    openAdminGate();
}

// ── Sesi idle ────────────────────────────────────────────────────────────
let adminIdleTimer = null;
let adminIdleWarnTimer = null;
let adminIdleCountdownTimer = null;

function hideAdminIdleWarning() {
    const el = document.getElementById("adminIdleWarning");
    if (el) el.classList.add("d-none");
    if (adminIdleCountdownTimer) {
        clearInterval(adminIdleCountdownTimer);
        adminIdleCountdownTimer = null;
    }
}

function showAdminIdleWarning() {
    const el = document.getElementById("adminIdleWarning");
    if (!el) return;
    el.classList.remove("d-none");

    let sisa = Math.round(ADMIN_IDLE_WARNING_MS / 1000);
    const label = document.getElementById("adminIdleCountdown");
    if (label) label.textContent = String(sisa);
    if (adminIdleCountdownTimer) clearInterval(adminIdleCountdownTimer);
    adminIdleCountdownTimer = setInterval(() => {
        sisa -= 1;
        if (label) label.textContent = String(Math.max(sisa, 0));
        if (sisa <= 0) clearInterval(adminIdleCountdownTimer);
    }, 1000);
}

function markAdminActivity() {
    if (!adminGateOpen) return;
    try {
        localStorage.setItem(ADMIN_LAST_ACTIVITY_KEY, String(Date.now()));
    } catch (e) { /* localStorage penuh/diblokir — timer tetap jalan */ }

    hideAdminIdleWarning();
    if (adminIdleTimer) clearTimeout(adminIdleTimer);
    if (adminIdleWarnTimer) clearTimeout(adminIdleWarnTimer);

    adminIdleWarnTimer = setTimeout(showAdminIdleWarning, ADMIN_IDLE_LIMIT_MS - ADMIN_IDLE_WARNING_MS);
    adminIdleTimer = setTimeout(() => forceAdminLogout("idle"), ADMIN_IDLE_LIMIT_MS);
}

function keepAdminSessionAlive() {
    markAdminActivity();
    // Sekalian "sentuh" server biar hitungan idle di sana ikut ke-reset.
    apiFetch("/settings/me").catch(() => { });
}

// Tab yang disembunyiin bikin setTimeout diperlambat browser, jadi pas tab
// balik aktif kita cek ulang pakai timestamp — bukan cuma ngandelin timer.
function checkAdminIdleOnFocus() {
    if (!adminGateOpen) return;
    const last = Number(localStorage.getItem(ADMIN_LAST_ACTIVITY_KEY) || 0);
    if (last && Date.now() - last > ADMIN_IDLE_LIMIT_MS) forceAdminLogout("idle");
    else markAdminActivity();
}

["mousedown", "keydown", "scroll", "touchstart", "click"].forEach((evt) => {
    document.addEventListener(evt, markAdminActivity, { passive: true });
});
document.addEventListener("visibilitychange", () => {
    if (!document.hidden) checkAdminIdleOnFocus();
});
window.addEventListener("focus", checkAdminIdleOnFocus);

bootAdminGate();

document.getElementById("adminPinModal").addEventListener("hidden.bs.modal", () => {
    document.getElementById("adminPinInput").value = "";
    document.getElementById("adminPinConfirmation").value = "";
    // Modal ditutup TANPA submit = user membatalkan. Kalau penutupan ini
    // justru bagian dari alur "buka lagi" (lihat requestAdminPin), modal
    // bakal langsung tampil lagi di tick berikutnya, jadi pembatalannya
    // ditunda sesaat dan dibatalkan sendiri kalau modalnya muncul lagi.
    const resolver = adminPinResolver;
    if (resolver) {
        setTimeout(() => {
            const modalEl = document.getElementById("adminPinModal");
            if (adminPinResolver === resolver && !modalEl.classList.contains("show")) {
                adminPinResolver = null;
                resolver.reject(new Error("Verifikasi Security PIN dibatalkan"));
            }
        }, 250);
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
// Collapsible sidebar categories
// ================================
function setNavGroupState(group, open) {
    if (!group) return;
    group.classList.toggle("is-open", open);
    const toggle = group.querySelector(".sidebar-section-toggle");
    if (toggle) toggle.setAttribute("aria-expanded", String(open));
}

function setupSidebarGroups() {
    document.querySelectorAll("#sidebarNav .sidebar-section-toggle").forEach((toggle) => {
        toggle.addEventListener("click", () => {
            const group = toggle.closest(".sidebar-nav-group");
            const shouldOpen = !group.classList.contains("is-open");
            document.querySelectorAll("#sidebarNav .sidebar-nav-group.is-open").forEach((other) => {
                if (other !== group) setNavGroupState(other, false);
            });
            setNavGroupState(group, shouldOpen);
        });
    });
}

function openNavGroupForView(view) {
    const link = [...document.querySelectorAll("#sidebarNav .nav-link")].find((item) => item.dataset.view === view);
    const group = link?.closest(".sidebar-nav-group");
    if (group) setNavGroupState(group, true);
}

setupSidebarGroups();

document.querySelectorAll("#sidebarNav .nav-link").forEach(link => {
    link.addEventListener("click", (e) => {
        e.preventDefault();
        document.querySelectorAll("#sidebarNav .nav-link").forEach(l => l.classList.remove("active"));
        link.classList.add("active");
        closeMobileSidebar();

        const view = link.dataset.view;
        openNavGroupForView(view);
        document.querySelectorAll(".view-section").forEach(sec => sec.classList.add("d-none"));
        document.getElementById(`view-${view}`).classList.remove("d-none");

        if (view === "orders" && !ordersLoaded) loadOrders();
        if (view === "users") openUsersSecurely();
        if (view === "promo" && !promoLoaded) loadPromo();
        if (view === "promocodes" && !promoCodesLoaded) loadPromoCodes();
        if (view === "topup") { window.initTopupCatalog?.(); loadTvBalance(); }
        if (view === "ratings" && !ratingsLoaded) { loadAdminRatings(1); loadAdminRatingSummary(); loadCustomTestimonials(); ratingsLoaded = true; }
        if (view === "settings" && !settingsLoaded) loadSettings();
        if (view === "waApi" && !waApiManagerLoaded) loadWaApiManager();
        if (view === "stats" && !statsLoaded) loadStats();
        if (view === "musicplayer" && !musicPlayerLoaded) { loadMusicList(); musicPlayerLoaded = true; }
        if (view === "topSpenders") loadAdminTopSpenders();
        if (view === "reseller" && !resellerLoaded) loadResellerAll();
        if (view === "approvals") loadApprovals();
    });
});

function switchView(view) {
    if (currentUser && currentUser.role === "staff" && (view === "waApi" || view === "aimgmt" || view === "musicplayer")) {
        showToast("Akses ditolak. Fitur ini hanya untuk Admin.", true);
        return;
    }

    document.querySelectorAll("#sidebarNav .nav-link").forEach(link => {
        link.classList.toggle("active", link.dataset.view === view);
    });
    openNavGroupForView(view);
    document.querySelectorAll(".view-section").forEach(sec => sec.classList.add("d-none"));
    const target = document.getElementById(`view-${view}`);
    if (target) target.classList.remove("d-none");

    currentView = view; // Ensure currentView is synced (if it wasn't already)
    if (view !== "topup" && typeof topupAutoRefreshTimer !== "undefined") clearTimeout(topupAutoRefreshTimer);

    if (view === "orders" && !ordersLoaded) loadOrders();
    if (view === "users") openUsersSecurely();
    if (view === "promo" && !promoLoaded) loadPromo();
    if (view === "promocodes" && !promoCodesLoaded) loadPromoCodes();
    if (view === "topup") { window.initTopupCatalog?.(); loadTvBalance(); }
    if (view === "ratings" && !ratingsLoaded) { loadAdminRatings(1); loadAdminRatingSummary(); loadCustomTestimonials(); ratingsLoaded = true; }
    if (view === "settings" && !settingsLoaded) loadSettings();
    if (view === "waApi" && !waApiManagerLoaded) loadWaApiManager();
    if (view === "stats" && !statsLoaded) loadStats();
    if (view === "musicplayer" && !musicPlayerLoaded) { loadMusicList(); musicPlayerLoaded = true; }
    if (view === "aimgmt") { loadKnowledgeBase(); loadMultiAiStatus(); loadMultiAiLogs(); startAiHealthCheckTimer(); }
    if (view === "topSpenders") loadAdminTopSpenders();
    if (view === "reseller" && !resellerLoaded) loadResellerAll();
    if (view === "approvals") loadApprovals();
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
                <div class="form-check form-switch m-0 p-0 d-flex justify-content-center">
                    <input class="form-check-input ms-0" type="checkbox" onchange="toggleProductStatus(${product.id}, this.checked)" ${product.is_active !== false ? 'checked' : ''}>
                </div>
            </td>
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
// Toggle Status
// ================================

async function toggleProductStatus(id, isActive) {
    try {
        const res = await apiFetch(`/products/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ is_active: isActive })
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) throw new Error(data.message || "Gagal mengubah status produk");

        showToast("Status produk berhasil diubah");
        const p = products.find(p => p.id === id);
        if (p) p.is_active = isActive;
    } catch (err) {
        if (err.message === "unauthorized") return;
        console.error(err);
        showToast(err.message, true);
        renderProducts(); // revert toggle if failed
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
    document.getElementById("isActive").checked = product.is_active !== false;
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
            is_active: document.getElementById("isActive").checked,
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
    anchor.download = `nexshop-orders-${new Date().toISOString().slice(0, 10)}.csv`;
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
        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.message || "Gagal memuat daftar akun.");
        }

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
                    ${users.map(u => {
            const isStaff = currentUser && currentUser.role === "staff";
            return `
                        <tr>
                            <td>${escapeHtml(u.id)}</td>
                            <td>${escapeHtml(u.name || "-")}</td>
                            <td>${escapeHtml(u.email || "-")}</td>
                            <td>
                                <select class="form-select form-select-sm" style="width:110px;" onchange="changeUserRole(${Number(u.id)}, this.value)" ${isStaff ? "disabled" : ""}>
                                    <option value="user" ${u.role === "user" ? "selected" : ""}>user</option>
                                    <option value="staff" ${u.role === "staff" ? "selected" : ""}>staff</option>
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
                                        onclick="toggleUserBlacklist(${Number(u.id)}, ${!u.is_blacklisted})" ${isStaff ? "disabled" : ""}>
                                    <i class="bi ${u.is_blacklisted ? "bi-unlock" : "bi-slash-circle"}"></i>
                                    ${u.is_blacklisted ? "Buka Blokir" : "Blokir"}
                                </button>
                                <button class="btn btn-sm btn-outline-info" onclick="openUserDetail(${Number(u.id)})">
                                    <i class="bi bi-clock-history"></i> Riwayat
                                </button>
                                <button class="btn btn-sm btn-outline-danger" onclick="deleteUser(${Number(u.id)}, '${escapeHtml(u.email || "").replace(/'/g, "\\'")}')" ${isStaff ? "disabled" : ""}>
                                    <i class="bi bi-trash"></i> Hapus
                                </button>
                            </td>
                        </tr>
                    `;
        }).join("")}
                </tbody>
            </table>
            </div>
        `;
    } catch (err) {
        if (err.message === "unauthorized") return;
        container.innerHTML = `
            <div class="text-center text-muted py-5">
                <i class="bi bi-people display-4 d-block mb-3"></i>
                ${escapeHtml(err.message)}
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
        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.message || "Gagal memuat daftar OTP aktif.");
        }

        const list = await res.json();

        if (!list.length) {
            container.innerHTML = `<p class="text-muted text-center py-4 mb-0">Tidak ada akun dengan OTP aktif saat ini.</p>`;
            return;
        }

        container.innerHTML = `
            <div class="table-responsive">
            <table class="table table-hover align-middle mb-0">
                <thead><tr><th>Nama</th><th>Email</th><th>Berlaku Sampai</th><th>Status</th><th>Aksi</th></tr></thead>
                <tbody>
                    ${list.map(u => `
                        <tr>
                            <td>${escapeHtml(u.name || "-")}</td>
                            <td>${escapeHtml(u.email || "-")}</td>
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
        container.innerHTML = `<p class="text-muted text-center py-4 mb-0">${escapeHtml(err.message)}</p>`;
    }
}

async function adminResendOtp(id) {
    try {
        await withAdminPin(async (security_pin) => {
            const res = await apiFetch(`/users/${id}/resend-otp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ security_pin }) });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.message || "Gagal mengirim ulang OTP");

            if (data.deliverySent === false) {
                showToast(data.message || "OTP dibuat tapi gagal terkirim.", true);
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

const SENSITIVE_SETTINGS_TABS = new Set(["apikeys", "authconfig", "security", "store", "mascot"]);

function scrubSensitiveSettings() {
    hideRevealedSecrets();
    document.getElementById("apiKeysForm")?.reset();
    hideRevealedRuntimeSecrets();
    const runtimeFields = document.getElementById("runtimeConfigFields");
    if (runtimeFields) runtimeFields.replaceChildren();
    const blockedIps = document.getElementById("blockedIpsList");
    if (blockedIps) blockedIps.innerHTML = `<div class="text-muted text-center py-3 small">Security PIN diperlukan untuk memuat data.</div>`;
    const unlockInput = document.getElementById("unlockLoginIp");
    if (unlockInput) unlockInput.value = "";
}

// Panel Settings dipetakan lewat tabel, bukan baris getElementById satu per
// satu. Sebelumnya tiap panel baru harus nambah satu baris, dan kalau
// panelnya belum ada di HTML (mis. file HTML lama ke-cache browser),
// getElementById balas null lalu SELURUH fungsi ini lempar TypeError --
// akibatnya tab Settings mati total, bukan cuma satu panel yang gagal.
// Sekarang panel yang gak ketemu dilewat diam-diam.
const SETTINGS_TAB_PANES = {
    profile: "settingsTabProfile",
    store: "settingsTabStore",
    content: "settingsTabContent",
    apikeys: "settingsTabApiKeys",
    authconfig: "settingsTabAuthconfig",
    security: "settingsTabSecurity",
    mascot: "settingsTabMascot",
    webhooks: "settingsTabWebhooks"
};

function activateSettingsTab(tab, button) {
    document.querySelectorAll("#settingsTabs .nav-link").forEach(b => b.classList.toggle("active", b === button));
    Object.entries(SETTINGS_TAB_PANES).forEach(([name, elementId]) => {
        document.getElementById(elementId)?.classList.toggle("d-none", tab !== name);
    });
    // Panel Webhook Relay baru narik data pas dibuka, supaya tab lain gak
    // ikut kena beban request-nya.
    if (tab === "webhooks" && typeof window.whLoadPanel === "function") {
        window.whLoadPanel();
    }
    // Signing secret yang tadi ditampilkan jangan ditinggal nangkring di DOM
    // waktu admin pindah tab -- sama semangatnya dengan scrubSensitiveSettings().
    if (tab !== "webhooks" && typeof window.whScrubSecret === "function") {
        window.whScrubSecret();
    }
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
        const purpose = tab === "apikeys" ? "membuka API Keys" : tab === "authconfig" ? "membuka Login & Captcha" : tab === "security" ? "membuka Keamanan" : "membuka pengaturan sensitif";
        try {
            await withAdminPin(async (security_pin) => {
                if (SENSITIVE_SETTINGS_TABS.has(previousTab) && previousTab !== tab) scrubSensitiveSettings();
                activateSettingsTab(tab, btn);
                if (tab === "apikeys") await loadApiKeys(security_pin);
                if (tab === "authconfig") await loadRuntimeConfig(security_pin);
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
            withAdminPin(loadBlockedIps, "memuat daftar IP diblokir").catch(() => { });
        }, "membuka blokir IP");
    } catch (err) {
        if (err.message === "unauthorized") return;
        console.error(err);
        errorEl.textContent = "Terjadi kesalahan, coba lagi.";
    }
}

async function loadApprovals() {
    const body = document.getElementById("approvalTableBody");
    if (!body) return;
    body.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4"><span class="spinner-border spinner-border-sm me-2"></span>Memuat...</td></tr>';
    try {
        const res = await apiFetch("/admin/approvals");
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Gagal memuat approval");
        const requests = data.requests || [];
        const pending = requests.filter((item) => item.status === "pending").length;
        document.getElementById("approvalPendingCount").textContent = `${pending} pending`;
        const navCount = document.getElementById("approvalNavCount");
        if (navCount) { navCount.textContent = pending; navCount.classList.toggle("d-none", pending === 0 || currentUser?.role !== "admin"); }
        if (!requests.length) {
            body.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">Belum ada pengajuan.</td></tr>';
            return;
        }
        body.innerHTML = requests.map((item) => {
            const requester = item.requester || {};
            const fields = Object.keys(item.proposed_changes || {}).join(", ");
            const statusClass = item.status === "approved" ? "success" : item.status === "rejected" ? "danger" : "warning";
            const actions = currentUser?.role === "admin" && item.status === "pending"
                ? `<button class="btn btn-sm btn-success me-1" onclick="reviewApproval('${escapeHtml(item.id)}','approve')">Approve</button><button class="btn btn-sm btn-outline-danger" onclick="reviewApproval('${escapeHtml(item.id)}','reject')">Tolak</button>`
                : `<span class="text-muted small">${item.status === "pending" ? "Menunggu Admin" : "Selesai"}</span>`;
            return `<tr>
                <td><strong>${escapeHtml(requester.fullname || "Staff")}</strong><br><small class="text-muted">${escapeHtml(requester.email || "-")}</small></td>
                <td><span class="badge text-bg-light">Store settings</span><br><small>${escapeHtml(fields)}</small></td>
                <td class="small">${escapeHtml(item.request_note || "-")}</td>
                <td><span class="badge text-bg-${statusClass}">${escapeHtml(item.status)}</span></td>
                <td class="small">${escapeHtml(new Date(item.created_at).toLocaleString("id-ID"))}</td>
                <td class="text-nowrap">${actions}</td>
            </tr>`;
        }).join("");
    } catch (error) {
        body.innerHTML = `<tr><td colspan="6" class="text-center text-danger py-4">${escapeHtml(error.message)}</td></tr>`;
    }
}

async function reviewApproval(id, action) {
    if (action === "approve" && !window.confirm("Setujui request ini dan terapkan pengaturan?")) return;
    const review_note = action === "reject" ? (window.prompt("Alasan penolakan (opsional):") || "") : "";
    try {
        await withAdminPin(async (security_pin) => {
            const res = await apiFetch(`/admin/approvals/${encodeURIComponent(id)}/${action}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ review_note, security_pin })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.message || "Gagal memproses approval");
            showToast(data.message || "Approval diproses");
            loadApprovals();
        }, action === "approve" ? "menyetujui perubahan staff" : "menolak pengajuan staff");
    } catch (error) { showToast(error.message, true); }
}

function collectStoreSettingsApprovalPayload() {
    const value = (id) => document.getElementById(id)?.value ?? "";
    return {
        store_name: value("storeName").trim(),
        tagline: value("storeTagline").trim(),
        contact_whatsapp: value("storeWhatsapp").trim(),
        contact_phone: value("storePhone").trim(),
        contact_email: value("storeEmail").trim(),
        contact_instagram: value("storeInstagram").trim(),
        address: value("storeAddress").trim(),
        trust_bar_enabled: Boolean(document.getElementById("storeTrustBar")?.checked),
        trust_bar_orders_offset: Number(value("storeTrustOrdersOffset")) || 0,
        trust_bar_games_offset: Number(value("storeTrustGamesOffset")) || 0,
        ticker_text: value("storeTickerText").trim(),
        ticker_speed_seconds: Number(value("storeTickerSpeed")) || 30
    };
}

async function submitStoreSettingsApproval(payload, errorId = "storeError") {
    const reason = document.getElementById("staffApprovalReason")?.value?.trim() || "";
    const res = await apiFetch("/admin/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_type: "store_settings", proposed_changes: payload, request_note: reason })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || "Gagal mengirim pengajuan approval");
    document.getElementById(errorId).textContent = "";
    showToast("Pengajuan sudah dikirim ke Admin");
    loadApprovals();
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
            document.getElementById("storeInstagram").value = store.contact_instagram || "";
            document.getElementById("storeAddress").value = store.address || "";
            document.getElementById("storeTrustBar").checked = store.trust_bar_enabled !== false;
            document.getElementById("storeTrustOrdersOffset").value = store.trust_bar_orders_offset || 0;
            document.getElementById("storeTrustGamesOffset").value = store.trust_bar_games_offset || 0;
            document.getElementById("storeTickerText").value = store.ticker_text || "";
            document.getElementById("storeTickerSpeed").value = store.ticker_speed_seconds || 30;
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

    if (currentUser?.role === "staff") {
        try {
            await submitStoreSettingsApproval(payload, "contentError");
        } catch (err) { errorEl.textContent = err.message; }
        return;
    }

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

    if (currentUser?.role === "staff") {
        try {
            await submitStoreSettingsApproval(collectStoreSettingsApprovalPayload(), "storeError");
        } catch (err) { errorEl.textContent = err.message; }
        return;
    }

    try {
        const security_pin = await withAdminPin((pin) => pin, "menyimpan pengaturan toko");
        let logoUrl;
        const file = storeLogoInput ? storeLogoInput.files[0] : null;
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
            contact_instagram: document.getElementById("storeInstagram").value.trim(),
            address: document.getElementById("storeAddress").value.trim(),
            trust_bar_enabled: document.getElementById("storeTrustBar").checked,
            trust_bar_orders_offset: parseInt(document.getElementById("storeTrustOrdersOffset").value, 10) || 0,
            trust_bar_games_offset: parseInt(document.getElementById("storeTrustGamesOffset").value, 10) || 0,
            ticker_text: document.getElementById("storeTickerText").value.trim(),
            ticker_speed_seconds: parseInt(document.getElementById("storeTickerSpeed").value, 10) || 30
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
        waapi_target_number: document.getElementById("waapiTargetNumber").value.trim(),
        seo_screenshot_base_url: document.getElementById("seoScreenshotBaseUrl").value.trim(),
        chrome_executable_path: document.getElementById("chromeExecutablePath").value.trim(),
        fonnte_user_enabled: document.getElementById("fonnteUserEnabled").checked,
        wa_template_otp: document.getElementById("fonnteTemplateOtp").value.trim(),
        wa_template_pending: document.getElementById("fonnteTemplatePending").value.trim(),
        wa_template_success: document.getElementById("fonnteTemplateSuccess").value.trim()
    };
// Field kosong berarti "tidak diubah" untuk secret waapi_key/waapi_url —
// jangan overwrite ke database (biar admin bisa save form tanpa harus
// isi ulang field yang emang gak mau diubah)
    // kirim string kosong ke backend supaya token lama tidak ketimpa/hilang
    // (lihat updateApiKeys: field yang dikirim "" akan diabaikan, tapi kita
    // tetap eksplisit di sini biar niatnya jelas dibaca ulang nanti).
    if (!payload.apigames_secret_key) delete payload.apigames_secret_key;

    try {
        await withAdminPin(async (security_pin) => {
            const res = await apiFetch("/settings/api-keys", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...payload, security_pin })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.message || "Gagal menyimpan API keys");

            showToast("Konfigurasi berhasil disimpan");
            // Reuse PIN yang sudah diverifikasi di request Save ini — jangan minta
            // PIN lagi cuma buat reload form (dulu ini penyebab PIN muncul 2x).
            loadApiKeys(security_pin).catch(() => { });
        }, "menyimpan API Keys");
    } catch (err) {
        if (err.message === "unauthorized") return;
        errorEl.textContent = err.message;
    }
}

async function provisionWaGateway() {
    const button = document.getElementById("waProvisionBtn");
    const errorEl = document.getElementById("apiKeysError");
    const urlInput = document.getElementById("waapiUrl");
    const keyInput = document.getElementById("waapiKey");
    const originalHtml = button.innerHTML;
    errorEl.textContent = "";
    button.disabled = true;
    button.innerHTML = `<span class="spinner-border spinner-border-sm me-1" role="status"></span> Menyimpan...`;

    try {
        await withAdminPin(async (security_pin) => {
            const res = await apiFetch("/settings/wa-api/provision", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ security_pin, waapi_url: urlInput.value.trim() })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.message || "Gagal mengonfigurasi WA Gateway");

            urlInput.value = data.waapi_url || urlInput.value.trim();
            keyInput.value = "••••••••••••••••";
            showToast(data.message || "WA Gateway berhasil dikonfigurasi.");
            loadApiKeys(security_pin).catch(() => {});
            refreshWaQr().catch(() => {});
        }, "membuat atau merotasi key WA Gateway");
    } catch (error) {
        if (error.message !== "unauthorized") errorEl.textContent = error.message;
    } finally {
        button.disabled = false;
        button.innerHTML = originalHtml;
    }
}

async function testApiGames() {
    const btn = document.getElementById("agTestBtn");
    if (!btn) return;

    btn.disabled = true;
    const oldHtml = btn.innerHTML;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span> Mengecek...`;

    try {
        await withAdminPin(async (security_pin) => {
            const res = await apiFetch("/settings/apigames/test", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ security_pin })
            });
            const data = await res.json().catch(() => ({}));

            if (res.ok) {
                showToast(data.message || "Konfigurasi ApiGames tersimpan.");
            } else {
                showToast(data.message || "Gagal memeriksa konfigurasi ApiGames.", true);
            }
        }, "memeriksa konfigurasi ApiGames");
    } catch (err) {
        if (err.message !== "unauthorized") {
            showToast(err.message || "Gagal memeriksa konfigurasi ApiGames.", true);
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = oldHtml;
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

async function testFonnteWhatsApp() {
    const btn = document.getElementById("fonnteTestBtn");
    const resultWrap = document.getElementById("fonnteTestResult");
    const alertEl = document.getElementById("fonnteTestAlert");
    const rawEl = document.getElementById("fonnteTestRaw");

    const payload = {
        number: document.getElementById("fonnteTestNumber").value.trim(),
        message: document.getElementById("fonnteTestMessage").value.trim()
    };

    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span> Mengirim...`;
    resultWrap.classList.add("d-none");

    try {
        await withAdminPin(async (security_pin) => {
            const res = await apiFetch("/settings/test-user-whatsapp", {
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
        }, "mengirim test WhatsApp API");
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
// Topup TokoVoucher
// ================================

document.querySelectorAll("#topupTabs [data-topup-tab]").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll("#topupTabs .nav-link").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        const tab = btn.dataset.topupTab;
        document.getElementById("topupTabProducts").classList.toggle("d-none", tab !== "products");
        document.getElementById("topupTabOrders").classList.toggle("d-none", tab !== "orders");
        if (tab === "orders") {
            loadTopupOrders();
        } else {
            if (typeof topupAutoRefreshTimer !== 'undefined') clearTimeout(topupAutoRefreshTimer);
        }
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

// Katalog produk topup sekarang SEPENUHNYA dipegang js/catalogSync.js
// (window.loadTopupProducts + renderProductTable). Yang tinggal di sini
// cuma state seleksi dan aksi massal yang dipanggil dari toolbar.

// State seleksi checkbox produk topup — dipakai bareng sama catalogSync.js.
let topupSelectedIds = new Set();
let topupSearchQuery = "";

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

// Bungkus bagian nama produk yang cocok sama kata pencarian pake <mark>,
// biar admin gampang lihat kenapa produk itu nongol pas ngetik "weekly".
function highlightSearchMatch(nama) {
    const safe = escapeHtml(nama || "");
    if (!topupSearchQuery) return safe;
    const q = topupSearchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // escape regex meta char dari input user
    return safe.replace(new RegExp(`(${q})`, "ig"), "<mark>$1</mark>");
}


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

async function bulkMarkupTopupPrice() {
    if (topupSelectedIds.size === 0) return showToast("Pilih minimal 1 produk dulu", true);

    const type = document.getElementById("topupBulkMarkupType").value;
    const valueInput = document.getElementById("topupBulkMarkupValue");
    const value = parseFloat(valueInput.value);
    // Pembulatan gak lagi punya input sendiri di toolbar — backend yang
    // nentuin. Sebelumnya baris ini baca elemen yang gak ada dan bikin
    // seluruh tombol markup massal mati dengan TypeError.
    const rounding = 0;

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
// backend yang hitung sendiri markup wajarnya per produk (persen dari
// MARKUP_TIERS buat kategori biasa, admin flat khusus E-Wallet — lihat
// hitungMarkupWajar di topupHelpers.js)
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

// Aktivasi cerdas SATU KLIK ke seluruh katalog (tombol "Aktivasi Cerdas
// Semua" di langkah 2). Backend-nya fungsi yang sama kayak versi produk
// terpilih di atas — cuma dikasih applyToAll: true, terus dia sendiri yang
// misahin jalur produk game (dedupe per nominal + cap/popularitas) sama
// produk non-game Marketplace (dedupe duplikat, sisanya diaktifkan).
async function smartActivateAllTopup() {
    if (
        !confirm(
            "Jalankan aktivasi cerdas ke SELURUH katalog?\n\n" +
            "• Produk game: cuma varian termurah per nominal yang aktif\n" +
            "• Produk non-game (Pulsa/PLN/E-Wallet/Tagihan): duplikat dimatiin, sisanya diaktifkan\n" +
            "• Produk yang statusnya udah diatur manual tetap dilindungi\n\n" +
            "Aksi ini bisa di-undo."
        )
    )
        return;

    const btn = document.getElementById("btnSmartActivateAll");
    const labelAsli = btn ? btn.innerHTML : "";
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span> Memproses…`;
    }

    try {
        const res = await apiFetch("/topup/admin/products/smart-activate", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ applyToAll: true })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Gagal menjalankan aktivasi cerdas");

        showToast(data.message || "Aktivasi cerdas selesai");
        topupSelectedIds.clear();
        loadTopupProducts();
        if (typeof loadCatalogSummary === "function") loadCatalogSummary();
    } catch (err) {
        if (err.message === "unauthorized") return;
        showToast(err.message, true);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = labelAsli;
        }
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

let topupAutoRefreshTimer = null;
let isFetchingTopupOrders = false;

// autoRefresh = dipanggil timer 1 detik, bukan aksi admin -> ditandai
// sebagai polling latar biar sesi idle tetap bisa berakhir sendiri.
async function loadTopupOrders(autoRefresh = false) {
    if (isFetchingTopupOrders) return;
    isFetchingTopupOrders = true;

    const tbody = document.getElementById("topupOrders");
    if (!topupOrdersLoaded) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4"><span class="spinner-border spinner-border-sm me-2"></span>Memuat data...</td></tr>`;
    }

    try {
        const res = await apiFetch("/topup/admin/orders", { background: autoRefresh });
        if (!res.ok) throw new Error("Gagal mengambil data pesanan topup");

        topupOrders = await res.json();
        topupOrdersLoaded = true;
        renderTopupOrders();
    } catch (err) {
        if (err.message === "unauthorized") {
            isFetchingTopupOrders = false;
            return;
        }
        if (!topupOrdersLoaded) {
            tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger py-4">${escapeHtml(err.message)}</td></tr>`;
        }
    }

    isFetchingTopupOrders = false;

    // Atomic / Active view only check
    clearTimeout(topupAutoRefreshTimer);
    const isTopupTabActive = currentView === "topup" && document.getElementById("topupTabOrders") && !document.getElementById("topupTabOrders").classList.contains("d-none");
    if (isTopupTabActive && document.visibilityState === "visible") {
        topupAutoRefreshTimer = setTimeout(() => loadTopupOrders(true), 1000);
    }
}

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && currentView === "topup" && document.getElementById("topupTabOrders") && !document.getElementById("topupTabOrders").classList.contains("d-none")) {
        loadTopupOrders();
    }
});

async function exportOrdersCsv() {
    try {
        showToast("Mengekspor data pesanan...");
        const res = await apiFetch("/admin/stats/export-orders");
        if (!res.ok) throw new Error("Gagal mengunduh laporan pesanan");
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `laporan_penjualan_nexshop_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        showToast("Laporan berhasil diunduh!");
    } catch (err) {
        if (err.message === "unauthorized") return;
        showToast(err.message || "Gagal ekspor laporan", true);
    }
}

async function updateOrderStatusAdmin(orderId, newStatus) {
    const isAction = ["cancelled", "refunded"].includes(newStatus);
    const action = newStatus === "cancelled" ? "cancel" : "refund";
    const actionLabel = action === "cancel" ? "membatalkan" : "merefund";
    if (!confirm(`${isAction ? `Konfirmasi ${actionLabel}` : "Ubah status"} order #${orderId}${isAction ? "?" : ` menjadi "${newStatus}"?`}`)) return;
    try {
        const isTopup = String(orderId).startsWith("TP");
        const endpoint = isAction
            ? (isTopup ? `/topup/admin/orders/${orderId}/actions` : `/orders/${orderId}/actions`)
            : `/orders/${orderId}/status`;
        const options = {
            method: isAction ? "POST" : "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(isAction ? { action, reason: "Aksi dari dashboard admin" } : { status: newStatus })
        };
        const res = await apiFetch(endpoint, options);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Gagal memproses aksi order");

        showToast(data.message || (isAction ? `Aksi ${action} berhasil diproses` : "Status order berhasil diubah"));
        if (typeof loadOrders === "function") loadOrders();
        loadTopupOrders();
    } catch (err) {
        if (err.message === "unauthorized") return;
        showToast(err.message, true);
    }
}

function statusBadge(status) {
    const map = {
        pending: "bg-secondary", paid: "bg-info", processing: "bg-warning",
        sukses: "bg-success", gagal: "bg-danger", failed: "bg-danger",
        cancelled: "bg-dark", refunded: "bg-primary"
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
                <div class="btn-group btn-group-sm">
                    <button class="btn btn-outline-secondary btn-sm" onclick="recheckTopupStatus('${o.id}')" title="Cek ulang status ke TokoVoucher">
                        <i class="bi bi-arrow-repeat"></i>
                    </button>
                    <button class="btn btn-outline-danger btn-sm" onclick="updateOrderStatusAdmin('${o.id}', 'cancelled')" title="Batalkan pesanan">
                        <i class="bi bi-x-circle"></i>
                    </button>
                    <button class="btn btn-outline-warning btn-sm" onclick="updateOrderStatusAdmin('${o.id}', 'refunded')" title="Refund pesanan">
                        <i class="bi bi-arrow-counterclockwise"></i>
                    </button>
                </div>
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
        // Cuma produk AKTIF yang masuk akal buat dijadiin target kode promo,
        // dan endpoint-nya sekarang balikin { data, total, ... }.
        const res = await apiFetch("/topup/admin/products?status=active&limit=0");
        if (res.ok) {
            const payload = await res.json();
            topupProducts = Array.isArray(payload) ? payload : (payload.data || []);
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
        <div class="text-muted small mt-2 mb-1 border-top pt-2"><i class="bi bi-gem"></i> Produk Topup TokoVoucher</div>
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

function requestAdminLogoutConfirmation() {
    const modalEl = document.getElementById("logoutConfirmModal");
    if (!modalEl || !window.bootstrap?.Modal) return Promise.resolve(false);
    return new Promise((resolve) => {
        adminLogoutResolver = resolve;
        modalEl.addEventListener("hidden.bs.modal", () => {
            if (adminLogoutResolver !== resolve) return;
            adminLogoutResolver = null;
            resolve(false);
        }, { once: true });
        bootstrap.Modal.getOrCreateInstance(modalEl).show();
    });
}

function settleAdminLogoutConfirmation(confirmed) {
    const resolve = adminLogoutResolver;
    adminLogoutResolver = null;
    const modalEl = document.getElementById("logoutConfirmModal");
    if (modalEl && window.bootstrap?.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).hide();
    if (resolve) resolve(Boolean(confirmed));
}

document.getElementById("adminLogoutSubmit")?.addEventListener("click", () => settleAdminLogoutConfirmation(true));
document.getElementById("adminLogoutCancel")?.addEventListener("click", () => settleAdminLogoutConfirmation(false));

function logout() {
    requestAdminLogoutConfirmation().then((confirmed) => {
        if (!confirmed) return;
        localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
        localStorage.removeItem(ADMIN_LAST_ACTIVITY_KEY);
        try { sessionStorage.removeItem(ADMIN_PIN_TRUST_KEY); } catch (e) { /* noop */ }
        window.location.href = "/admin/login.html";
    });
}

// Dipakai tombol "Keluar" di overlay gerbang — forceAdminLogout sengaja
// melempar error buat menghentikan pemanggilnya (apiFetch), jadi di sini
// ditelan supaya gak jadi error liar di handler klik.
function logoutAdminNow() {
    requestAdminLogoutConfirmation().then((confirmed) => {
        if (!confirmed) return;
        try {
            forceAdminLogout("manual");
        } catch (e) { /* redirect sudah jalan */ }
    });
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
        const res = await apiFetch("/notifications", { background: true });
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
            <span class="dot ${n.type}" style="margin-top:6px;width:8px;height:8px;border-radius:50%;flex-shrink:0;background:${n.type === "order" ? "#22C55E" : n.type === "topup" ? "#22D3EE" : n.type === "security" ? "#F0475C" : "#8B5CF6"
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

// Auto-logout idle + gerbang akses dashboard sekarang ditangani di blok
// "GERBANG AKSES + SESI IDLE DASHBOARD ADMIN" di atas (batas 15 menit,
// ditegakkan juga oleh server lewat middleware/adminSession.js).

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
    const setText = (id, value) => {
        const node = document.getElementById(id);
        if (node) node.textContent = value;
    };

    setText("statTotalRevenue", rupiah(stats.total_revenue));
    setText("statRevenueRegular", rupiah(stats.revenue_regular));
    setText("statRevenueTopup", rupiah(stats.revenue_topup));
    setText("statOrderCount", `${stats.total_paid_orders || 0} / ${stats.total_orders || 0}`);

    // Semua daftar di bawah dikasih default array kosong: kalau backend
    // sempat balikin payload tanpa salah satu key-nya, satu baris .length
    // yang gagal bikin SELURUH panel statistik kosong (termasuk grafiknya).
    const topProducts = stats.top_products || [];
    const topKategori = stats.top_topup_categories || [];

    const topProductsEl = document.getElementById("statTopProducts");
    if (topProductsEl) {
        topProductsEl.innerHTML = topProducts.length
            ? topProducts.map(p => `
                <tr><td>${escapeHtml(p.name)}</td><td>${p.qty}</td><td>${rupiah(p.revenue)}</td></tr>
            `).join("")
            : `<tr><td colspan="3" class="text-center text-muted py-3">Belum ada penjualan produk biasa.</td></tr>`;
    }

    const topKategoriEl = document.getElementById("statTopTopupCategories");
    if (topKategoriEl) {
        topKategoriEl.innerHTML = topKategori.length
            ? topKategori.map(k => `
                <tr><td>${escapeHtml(k.kategori)}</td><td>${k.count}</td><td>${rupiah(k.revenue)}</td></tr>
            `).join("")
            : `<tr><td colspan="3" class="text-center text-muted py-3">Belum ada penjualan topup.</td></tr>`;
    }

    // status breakdown badges
    const statusColors = { paid: "success", sukses: "success", pending: "warning", processing: "info", failed: "danger", gagal: "danger" };
    const statusEl = document.getElementById("statStatusBreakdown");
    if (statusEl) {
        const entries = Object.entries(stats.status_breakdown || {});
        statusEl.innerHTML = entries.length
            ? entries.map(([status, count]) => `
                <span class="badge bg-${statusColors[status] || "secondary"} fs-6 fw-normal px-3 py-2">${escapeHtml(status)}: ${count}</span>
            `).join("")
            : `<span class="text-muted small">Belum ada data order.</span>`;
    }

    // chart tren omzet 30 hari
    const ctx = document.getElementById("statRevenueChart");
    if (!ctx || typeof Chart === "undefined") return;

    const byDay = stats.revenue_by_day || [];
    const labels = byDay.map(d => String(d.date || "").slice(5)); // MM-DD
    const data = byDay.map(d => d.revenue);

    // Warna grid/label diambil dari token tema, bukan default Chart.js yang
    // abu-abu terang -- di tema gelap sumbu grafiknya nyaris gak kebaca.
    const styles = getComputedStyle(document.documentElement);
    const axisColor = styles.getPropertyValue("--text-muted").trim() || "#8891B0";
    const gridColor = styles.getPropertyValue("--line").trim() || "#242c4a";

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
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (item) => "Omzet: Rp " + Number(item.parsed.y || 0).toLocaleString("id-ID")
                    }
                }
            },
            scales: {
                x: { ticks: { color: axisColor }, grid: { color: gridColor } },
                y: {
                    ticks: { color: axisColor, callback: (v) => "Rp " + Number(v).toLocaleString("id-ID") },
                    grid: { color: gridColor }
                }
            }
        }
    });
}

function initThemeToggle() {
    const THEME_STORAGE_KEY = "nexshop-admin-theme";
    function applyTheme(theme) {
        document.documentElement.dataset.theme = theme;
        document.documentElement.setAttribute("data-theme", theme);
        // Sinkron ke color mode bawaan Bootstrap 5.3 -- lihat theme-init.js.
        // Tanpa ini, komponen Bootstrap (tabel, form, dropdown, offcanvas,
        // utility *-subtle) tetap ngerender versi terang di tema gelap.
        document.documentElement.setAttribute("data-bs-theme", theme);
        try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch (e) { }
        const isLight = theme === "light";

        // Chart.js nge-bake warna sumbu waktu chart dibuat, jadi grafik yang
        // udah tampil harus digambar ulang pas tema diganti.
        if (typeof statRevenueChartInstance !== "undefined" && statRevenueChartInstance && statsLoaded) {
            loadStats();
        }

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
    window.open(`/?mascotPreview=1&mascotAsset=${encodeURIComponent(mascot_url)}`, "_blank", "noopener");
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
        const agStatusEl = document.getElementById("agStatus");
        if (agStatusEl) {
            if (keys.apigames_merchant_id && keys.apigames_secret_key) {
                agStatusEl.textContent = "Konfigurasi ApiGames tersimpan";
                agStatusEl.className = "badge bg-success";
            } else {
                agStatusEl.textContent = "ApiGames belum dikonfigurasi";
                agStatusEl.className = "badge bg-secondary";
            }
        }
        document.getElementById("brevoApiKey").value = keys.brevo_api_key || "";
        document.getElementById("brevoSenderEmail").value = keys.brevo_sender_email || "";
        document.getElementById("brevoSenderName").value = keys.brevo_sender_name || "";
        document.getElementById("geminiApiKey").value = keys.gemini_api_key || "";
        document.getElementById("geminiNewsModel").value = keys.gemini_news_model || "gemini-2.0-flash";
        document.getElementById("smtpHost").value = keys.smtp_host || "";
        document.getElementById("smtpPort").value = keys.smtp_port || "";
        document.getElementById("smtpUser").value = keys.smtp_user || "";
        document.getElementById("smtpPassword").value = keys.smtp_password || "";
        document.getElementById("smtpFromEmail").value = keys.smtp_from_email || "";
        document.getElementById("smtpFromName").value = keys.smtp_from_name || "";
        document.getElementById("waapiUrl").value = keys.waapi_url || "";
        document.getElementById("waapiKey").value = keys.waapi_key || "";
        document.getElementById("waapiTargetNumber").value = keys.waapi_target_number || "";
        document.getElementById("seoScreenshotBaseUrl").value = keys.seo_screenshot_base_url || "";
        document.getElementById("chromeExecutablePath").value = keys.chrome_executable_path || "";
        document.getElementById("fonnteUserEnabled").checked = !!keys.fonnte_user_enabled;
        document.getElementById("fonnteTemplateOtp").value = keys.wa_template_otp || "";
        document.getElementById("fonnteTemplatePending").value = keys.wa_template_pending || "";
        document.getElementById("fonnteTemplateSuccess").value = keys.wa_template_success || "";
        maskedApiKeys = Object.fromEntries(Object.keys(SECRET_API_FIELDS).map(id => [id, document.getElementById(id).value]));
        Object.keys(SECRET_API_FIELDS).forEach(id => { document.getElementById(id).type = "password"; });
    } catch (err) {
        if (err.message !== "unauthorized") errorEl.textContent = err.message;
    }
}

// =========================================
// Runtime auth config — Turnstile / Google
// =========================================
let runtimeConfigDefinitions = [];
const runtimeMaskedValues = new Map();
const runtimeRevealTimers = new Map();

function runtimeInputId(key) {
    return `runtimeConfig_${key}`;
}

function hideRevealedRuntimeSecrets() {
    for (const timer of runtimeRevealTimers.values()) clearTimeout(timer);
    runtimeRevealTimers.clear();
    runtimeMaskedValues.forEach((maskedValue, key) => {
        const input = document.getElementById(runtimeInputId(key));
        if (!input) return;
        input.value = maskedValue || "";
        input.type = "password";
    });
}

function renderRuntimeConfigFields(fields) {
    const container = document.getElementById("runtimeConfigFields");
    if (!container) return;
    runtimeConfigDefinitions = Array.isArray(fields) ? fields : [];
    runtimeMaskedValues.clear();
    hideRevealedRuntimeSecrets();
    container.replaceChildren();

    runtimeConfigDefinitions.forEach((field) => {
        const inputId = runtimeInputId(field.key);
        const col = document.createElement("div");
        col.className = "col-12";

        if (field.type === "boolean") {
            const check = document.createElement("div");
            check.className = "form-check form-switch";
            const input = document.createElement("input");
            input.className = "form-check-input";
            input.type = "checkbox";
            input.role = "switch";
            input.id = inputId;
            input.checked = field.value === true;
            const label = document.createElement("label");
            label.className = "form-check-label";
            label.htmlFor = inputId;
            label.textContent = field.label;
            check.append(input, label);
            col.append(check);
        } else {
            const label = document.createElement("label");
            label.className = "form-label";
            label.htmlFor = inputId;
            label.textContent = field.label;
            const input = document.createElement("input");
            input.className = "form-control";
            input.id = inputId;
            input.type = field.secret ? "password" : (field.type === "url" ? "url" : "text");
            input.autocomplete = "off";
            input.spellcheck = false;
            input.value = field.value || "";
            if (field.type === "url") input.placeholder = "https://nexshop.cloud/api/auth/google/callback";
            col.append(label, input);

            if (field.secret) {
                runtimeMaskedValues.set(field.key, field.value || "");
                const actions = document.createElement("div");
                actions.className = "d-flex align-items-center gap-3 flex-wrap mt-2";
                const reveal = document.createElement("button");
                reveal.type = "button";
                reveal.className = "btn btn-outline-warning btn-sm";
                reveal.innerHTML = '<i class="bi bi-eye"></i> Tampilkan 15 detik';
                reveal.addEventListener("click", () => revealRuntimeConfigSecret(field.key));
                const clearWrap = document.createElement("div");
                clearWrap.className = "form-check mb-0";
                const clear = document.createElement("input");
                clear.className = "form-check-input";
                clear.type = "checkbox";
                clear.id = `${inputId}_clear`;
                const clearLabel = document.createElement("label");
                clearLabel.className = "form-check-label small";
                clearLabel.htmlFor = clear.id;
                clearLabel.textContent = "Hapus override dashboard (pakai fallback .env)";
                clearWrap.append(clear, clearLabel);
                actions.append(reveal, clearWrap);
                col.append(actions);
            }
        }

        if (field.description) {
            const help = document.createElement("div");
            help.className = "form-text";
            help.textContent = field.description;
            col.append(help);
        }
        container.append(col);
    });
}

async function loadRuntimeConfig(security_pin) {
    const errorEl = document.getElementById("runtimeConfigError");
    if (errorEl) errorEl.textContent = "";
    try {
        const res = await apiFetch("/settings/runtime-config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ security_pin })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Gagal memuat konfigurasi Login & Captcha");
        renderRuntimeConfigFields(data.fields);
    } catch (err) {
        if (err.message !== "unauthorized" && errorEl) errorEl.textContent = err.message;
    }
}

async function revealRuntimeConfigSecret(key) {
    const input = document.getElementById(runtimeInputId(key));
    if (!input) return;
    try {
        await withAdminPin(async (security_pin) => {
            const res = await apiFetch("/settings/runtime-config/reveal", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ security_pin, key, purpose: "reveal" })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.message || "Gagal menampilkan secret");
            hideRevealedRuntimeSecrets();
            input.type = "text";
            input.value = data.value || "";
            runtimeRevealTimers.set(key, setTimeout(() => {
                input.value = runtimeMaskedValues.get(key) || "";
                input.type = "password";
                runtimeRevealTimers.delete(key);
            }, 15000));
        }, "menampilkan secret Login & Captcha");
    } catch (err) {
        if (err.message !== "unauthorized") showToast(err.message || "Gagal menampilkan secret", true);
    }
}

async function saveRuntimeConfig() {
    const errorEl = document.getElementById("runtimeConfigError");
    if (errorEl) errorEl.textContent = "";
    const values = {};
    const clear_keys = [];
    runtimeConfigDefinitions.forEach((field) => {
        const input = document.getElementById(runtimeInputId(field.key));
        if (!input) return;
        if (field.type === "boolean") values[field.key] = input.checked;
        else if (!field.secret || input.value !== (runtimeMaskedValues.get(field.key) || "")) values[field.key] = input.value.trim();
        if (field.secret && document.getElementById(`${runtimeInputId(field.key)}_clear`)?.checked) clear_keys.push(field.key);
    });

    try {
        await withAdminPin(async (security_pin) => {
            const res = await apiFetch("/settings/runtime-config", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ security_pin, values, clear_keys })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.message || "Gagal menyimpan Login & Captcha");
            showToast(data.message || "Konfigurasi Login & Captcha berhasil disimpan");
            await loadRuntimeConfig(security_pin);
        }, "menyimpan Login & Captcha");
    } catch (err) {
        if (err.message !== "unauthorized" && errorEl) errorEl.textContent = err.message;
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

document.addEventListener("DOMContentLoaded", () => {
    loadCurrentUser();
    initThemeToggle();
    loadSystemHealth();
});

// ================================
// Enterprise Features: Command Palette & System Health
// ================================

let cmdKModalInstance = null;

function openCmdKModal() {
    if (!cmdKModalInstance) {
        cmdKModalInstance = new bootstrap.Modal(document.getElementById("cmdKModal"));
    }
    renderCmdKResults();
    cmdKModalInstance.show();
    setTimeout(() => document.getElementById("cmdKSearchInput")?.focus(), 300);
}

function renderCmdKResults() {
    const query = (document.getElementById("cmdKSearchInput")?.value || "").toLowerCase().trim();
    const listEl = document.getElementById("cmdKResultsList");
    if (!listEl) return;

    const items = [
        { title: "Dashboard Overview", icon: "bi-speedometer2", action: () => switchView("dashboard") },
        { title: "Statistik & Omzet Penjualan", icon: "bi-graph-up", action: () => switchView("stats") },
        { title: "Kelola Produk Fisik/Digital", icon: "bi-box-seam", action: () => switchView("dashboard") },
        { title: "Kelola Pesanan & Transaction Logs", icon: "bi-cart", action: () => switchView("orders") },
        { title: "Kelola Topup TokoVoucher & Game", icon: "bi-gem", action: () => switchView("topup") },
        { title: "Daftar Pengguna & OTP", icon: "bi-people", action: () => switchView("users") },
        { title: "Pengaturan Slide Promo & Banner", icon: "bi-megaphone", action: () => switchView("promo") },
        { title: "NexShop News (Editorial)", icon: "bi-newspaper", action: () => switchView("editorial") },
        { title: "Kode Promo & Kupon Diskon", icon: "bi-ticket-perforated", action: () => switchView("promocodes") },
        { title: "Pengaturan Toko & API Keys", icon: "bi-gear", action: () => switchView("settings") },
        { title: "Top Spenders (Hall of Fame)", icon: "bi-trophy", action: () => switchView("topSpenders") },
        { title: "Export Laporan CSV / Excel", icon: "bi-file-earmark-excel", action: () => exportOrdersCsv() },
        { title: "Tambah Produk Baru", icon: "bi-plus-circle", action: () => openProductModal() },
        { title: "Generate AI Sales Insights", icon: "bi-stars", action: () => { switchView("dashboard"); loadAiInsights(); } }
    ];

    const filtered = items.filter(i => i.title.toLowerCase().includes(query));
    if (!filtered.length) {
        listEl.innerHTML = `<div class="text-center text-muted py-3 small">Tidak ada menu yang sesuai "${escapeHtml(query)}"</div>`;
        return;
    }

    listEl.innerHTML = filtered.map((item, idx) => `
        <div class="cmd-k-item" onclick="execCmdKAction(${idx})">
            <div><i class="bi ${item.icon} me-2 text-primary"></i><strong>${escapeHtml(item.title)}</strong></div>
            <span class="text-muted small">Buka <i class="bi bi-chevron-right"></i></span>
        </div>
    `).join("");

    window._cmdKFilteredItems = filtered;
}

function execCmdKAction(idx) {
    if (window._cmdKFilteredItems && window._cmdKFilteredItems[idx]) {
        if (cmdKModalInstance) cmdKModalInstance.hide();
        window._cmdKFilteredItems[idx].action();
    }
}

document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openCmdKModal();
    }
});

async function loadSystemHealth() {
    try {
        const res = await apiFetch("/admin/stats/system-health");
        if (!res.ok) return;
        const data = await res.json();

        document.getElementById("sysStatusBadge").textContent = data.status === "online" ? "Online" : "Warning";
        document.getElementById("sysRamHeap").textContent = (data.memory?.heap_used_mb || 0) + " MB";
        document.getElementById("sysNodeVer").textContent = data.node_version || "-";

        const uptimeMins = Math.floor((data.uptime_seconds || 0) / 60);
        document.getElementById("sysUptime").textContent = `${uptimeMins} m`;
        document.getElementById("sysDbLatency").textContent = `${data.database?.latency_ms || 0} ms`;
    } catch (err) {
        // ignore background errors
    }
}

async function loadAiInsights() {
    const box = document.getElementById("aiInsightsBox");
    if (!box) return;
    box.innerHTML = `<span class="spinner-border spinner-border-sm text-primary me-2"></span>Menghubungi Google Gemini AI...`;

    try {
        const res = await apiFetch("/admin/stats/ai-insights");
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Gagal mendapatkan AI Insights");

        box.innerHTML = escapeHtml(data.advice || "Tidak ada masukan yang dihasilkan saat ini.");
    } catch (err) {
        if (err.message === "unauthorized") return;
        box.innerHTML = `<span class="text-danger">${escapeHtml(err.message)}</span>`;
    }
}

/* =========================================================
 * AI Knowledge Base Management Functions (Robust & Debugged)
 * ========================================================= */
let knowledgeBaseList = [];
let kbModalInstance = null;
let isKbLoading = false;

function getKbModalInstance() {
    const el = document.getElementById("kbModal");
    if (!el) {
        console.error("❌ Element #kbModal tidak ditemukan di DOM!");
        return null;
    }
    return bootstrap.Modal.getOrCreateInstance(el);
}

async function loadKnowledgeBase() {
    const tbody = document.getElementById("kbTableBody");
    if (!tbody || isKbLoading) return;

    isKbLoading = true;
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted"><span class="spinner-border spinner-border-sm me-2 text-primary" role="status"></span>Memuat Knowledge Base...</td></tr>`;

    try {
        console.log("🔍 Fetching Knowledge Base from /api/ai/knowledge...");
        const res = await apiFetch("/ai/knowledge");
        const json = await res.json().catch(() => ({}));

        if (!res.ok) {
            throw new Error(json.message || `HTTP Error ${res.status}`);
        }

        knowledgeBaseList = json.data || [];
        console.log(`✅ Loaded ${knowledgeBaseList.length} Knowledge Base items.`);
        populateKbCategories();
        filterKnowledgeTable();
    } catch (err) {
        if (err.message === "unauthorized") return;
        console.error("❌ Error loading Knowledge Base:", err);
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="text-center text-danger py-4">
                    <div><i class="bi bi-exclamation-triangle fs-4 d-block mb-1"></i>Gagal memuat Knowledge Base: ${escapeHtml(err.message)}</div>
                    <button class="btn btn-outline-primary btn-sm mt-2" onclick="loadKnowledgeBase()"><i class="bi bi-arrow-clockwise me-1"></i> Coba Lagi</button>
                </td>
            </tr>`;
    } finally {
        isKbLoading = false;
    }
}

function populateKbCategories() {
    const select = document.getElementById("kbCategoryFilter");
    if (!select) return;

    const categories = Array.from(new Set(knowledgeBaseList.map(k => k.category || "Umum").filter(Boolean)));
    const currentVal = select.value;

    select.innerHTML = `<option value="">Semua Kategori</option>` + categories.map(cat => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`).join("");
    select.value = currentVal;
}

function filterKnowledgeTable() {
    const tbody = document.getElementById("kbTableBody");
    if (!tbody) return;

    const query = (document.getElementById("kbSearchInput")?.value || "").toLowerCase().trim();
    const selectedCat = (document.getElementById("kbCategoryFilter")?.value || "").toLowerCase().trim();

    const filtered = knowledgeBaseList.filter(item => {
        const matchesQuery = !query ||
            (item.title && item.title.toLowerCase().includes(query)) ||
            (item.keywords && item.keywords.toLowerCase().includes(query)) ||
            (item.content && item.content.toLowerCase().includes(query));

        const matchesCat = !selectedCat || (item.category && item.category.toLowerCase().trim() === selectedCat);

        return matchesQuery && matchesCat;
    });

    renderKnowledgeTable(filtered);
}

function renderKnowledgeTable(itemsToRender = knowledgeBaseList) {
    const tbody = document.getElementById("kbTableBody");
    if (!tbody) return;

    if (itemsToRender.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="text-center py-4 text-muted">
                    <div>Belum ada data Knowledge Base yang cocok.</div>
                    <button class="btn btn-primary btn-sm mt-2" onclick="openAddKnowledgeModal()"><i class="bi bi-plus-circle me-1"></i> Tambah Knowledge Pertama</button>
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = itemsToRender.map(item => `
        <tr>
            <td>
                <strong>${escapeHtml(item.title)}</strong>
                <div class="text-muted small">${escapeHtml((item.content || '').slice(0, 70))}...</div>
            </td>
            <td><span class="badge bg-secondary">${escapeHtml(item.category || 'Umum')}</span></td>
            <td><small class="text-muted">${escapeHtml(item.keywords || '-')}</small></td>
            <td>
                <span class="badge ${item.status === 'active' ? 'bg-success' : 'bg-danger'}">${item.status === 'active' ? 'Aktif' : 'Nonaktif'}</span>
            </td>
            <td><span class="badge bg-info text-dark">P-${item.priority || 0}</span></td>
            <td class="text-end">
                <button type="button" class="btn btn-sm btn-outline-primary me-1" onclick="openEditKnowledgeModal('${item.id}')"><i class="bi bi-pencil"></i> Edit</button>
                <button type="button" class="btn btn-sm btn-outline-danger" onclick="deleteKnowledge('${item.id}')"><i class="bi bi-trash"></i> Hapus</button>
            </td>
        </tr>
    `).join("");
}

function openAddKnowledgeModal() {
    console.log("➕ Opening Add Knowledge Modal...");
    const modal = getKbModalInstance();
    if (!modal) {
        showToast("Modal #kbModal tidak ditemukan pada halaman!", true);
        return;
    }

    const form = document.getElementById("kbForm");
    if (form) form.reset();

    const idEl = document.getElementById("kbId");
    if (idEl) idEl.value = "";

    const titleEl = document.getElementById("kbModalTitle");
    if (titleEl) titleEl.innerHTML = '<i class="bi bi-journal-plus me-2"></i>Tambah Knowledge RAG';

    const errEl = document.getElementById("kbError");
    if (errEl) errEl.textContent = "";

    modal.show();
}

function openEditKnowledgeModal(id) {
    console.log(`✏️ Opening Edit Knowledge Modal for ID: ${id}...`);
    const modal = getKbModalInstance();
    if (!modal) {
        showToast("Modal #kbModal tidak ditemukan pada halaman!", true);
        return;
    }

    const item = knowledgeBaseList.find(k => String(k.id) === String(id));
    if (!item) {
        showToast("Knowledge item tidak ditemukan!", true);
        return;
    }

    document.getElementById("kbId").value = item.id;
    document.getElementById("kbTitle").value = item.title || "";
    document.getElementById("kbCategory").value = item.category || "";
    document.getElementById("kbKeywords").value = item.keywords || "";
    document.getElementById("kbContent").value = item.content || "";
    document.getElementById("kbPriority").value = item.priority || 10;
    document.getElementById("kbStatus").value = item.status || "active";
    document.getElementById("kbError").textContent = "";

    document.getElementById("kbModalTitle").innerHTML = '<i class="bi bi-journal-text me-2"></i>Edit Knowledge RAG';
    modal.show();
}

async function saveKnowledge() {
    const saveBtn = document.getElementById("btnSaveKnowledge");
    const errorEl = document.getElementById("kbError");
    if (errorEl) errorEl.textContent = "";

    const id = document.getElementById("kbId")?.value;
    const title = document.getElementById("kbTitle")?.value.trim();
    const category = document.getElementById("kbCategory")?.value.trim();
    const keywords = document.getElementById("kbKeywords")?.value.trim();
    const content = document.getElementById("kbContent")?.value.trim();
    const priority = document.getElementById("kbPriority")?.value;
    const status = document.getElementById("kbStatus")?.value;

    if (!title || !content) {
        if (errorEl) errorEl.textContent = "Judul dan Konten wajib diisi!";
        return;
    }

    const payload = { title, category, keywords, content, priority, status };

    try {
        if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Menyimpan...'; }
        const url = id ? `/ai/knowledge/${id}` : "/ai/knowledge";
        const method = id ? "PUT" : "POST";

        console.log(`💾 Saving Knowledge (${method} ${url})...`, payload);
        const res = await apiFetch(url, {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.message || "Gagal menyimpan knowledge");

        showToast(json.message || "Knowledge berhasil disimpan!");
        const modal = getKbModalInstance();
        if (modal) modal.hide();

        loadKnowledgeBase();
    } catch (err) {
        console.error("❌ Error saving Knowledge:", err);
        if (errorEl) errorEl.textContent = err.message;
    } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="bi bi-floppy me-1"></i> Simpan Knowledge'; }
    }
}

async function deleteKnowledge(id) {
    if (!confirm("Apakah Anda yakin ingin menghapus entry knowledge ini?")) return;
    try {
        console.log(`🗑️ Deleting Knowledge ID ${id}...`);
        const res = await apiFetch(`/ai/knowledge/${id}`, { method: "DELETE" });
        const json = await res.json().catch(() => ({}));

        if (!res.ok) throw new Error(json.message || "Gagal menghapus knowledge");

        showToast(json.message || "Knowledge berhasil dihapus");
        loadKnowledgeBase();
    } catch (err) {
        console.error("❌ Error deleting Knowledge:", err);
        showToast(err.message, true);
    }
}

async function reseedKnowledgeBase() {
    const seedBtn = document.getElementById("btnAutoSeedKnowledge");
    if (!confirm("Otomatis generate Knowledge Base dari data produk, topup, promo, & informasi toko saat ini?")) return;

    try {
        if (seedBtn) { seedBtn.disabled = true; seedBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Generating...'; }
        console.log("🪄 Auto-generating RAG Knowledge Base...");

        const res = await apiFetch("/ai/knowledge/reseed", { method: "POST" });
        const json = await res.json().catch(() => ({}));

        if (!res.ok) throw new Error(json.message || "Gagal auto-generate knowledge base");

        showToast(json.message || "Berhasil men-generate Knowledge Base otomatis!");
        loadKnowledgeBase();
    } catch (err) {
        console.error("❌ Error reseeding Knowledge Base:", err);
        showToast(err.message, true);
    } finally {
        if (seedBtn) { seedBtn.disabled = false; seedBtn.innerHTML = '<i class="bi bi-magic me-1"></i> Auto-Generate Knowledge'; }
    }
}

async function generateProductFaqs() {
    const faqBtn = document.getElementById("btnAutoGenerateFaq");
    if (!confirm("Otomatis generate FAQ lengkap untuk seluruh katalog produk saat ini?")) return;

    try {
        if (faqBtn) { faqBtn.disabled = true; faqBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Generating FAQ...'; }
        console.log("❓ Auto-generating Product FAQs...");

        const res = await apiFetch("/ai/faq/generate", { method: "POST" });
        const json = await res.json().catch(() => ({}));

        if (!res.ok) throw new Error(json.message || "Gagal auto-generate FAQ produk");

        showToast(json.message || "Berhasil men-generate FAQ produk otomatis!");
        loadKnowledgeBase();
    } catch (err) {
        console.error("❌ Error generating product FAQs:", err);
        showToast(err.message, true);
    } finally {
        if (faqBtn) { faqBtn.disabled = false; faqBtn.innerHTML = '<i class="bi bi-patch-question me-1"></i> Generate FAQ Produk'; }
    }
}

// ===================================
// Multi-AI Provider System Dashboard
// ===================================

let aiHealthCheckInterval = null;
let currentMultiAiData = null;

// PENTING: penyedia AI rutin menghapus model lama. Daftar Groq lama di
// sini (llama-3.3-70b-versatile, mixtral-8x7b-32768, dst) SEMUANYA sudah
// di-decommission -- akibatnya model yang kepilih dari dropdown ini gak
// pernah bisa dipanggil dan NexBot jawab "informasi belum tersedia" ke
// SEMUA pertanyaan. Backend sekarang nanya daftar model langsung ke Groq
// waktu runtime (lihat services/groqProvider.js), jadi kalaupun daftar di
// bawah ini basi lagi, NexBot tetap jalan. Tetap perbarui daftar ini kalau
// penyedianya ganti katalog.
const AI_PRESET_MODELS = {
    gemini: ["gemini-flash-latest", "gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash", "custom"],
    groq: ["openai/gpt-oss-20b", "openai/gpt-oss-120b", "groq/compound-mini", "groq/compound", "qwen/qwen3.6-27b", "custom"],
    openrouter: ["meta-llama/llama-3.3-70b-instruct", "deepseek/deepseek-r1-distill-llama-70b", "google/gemini-2.0-flash-001", "qwen/qwen-2.5-72b-instruct", "custom"]
};

function startAiHealthCheckTimer() {
    if (aiHealthCheckInterval) clearInterval(aiHealthCheckInterval);
    aiHealthCheckInterval = setInterval(() => {
        const viewEl = document.getElementById("view-aimgmt");
        if (viewEl && !viewEl.classList.contains("d-none")) {
            console.log("⏱️ Executing 60s Auto AI Health Check...");
            loadMultiAiStatus();
        }
    }, 60000);
}

async function loadMultiAiStatus() {
    try {
        const res = await apiFetch("/admin/ai/status", { background: true });
        if (!res.ok) return;
        const data = await res.json().catch(() => ({}));
        currentMultiAiData = data;

        const activeBadge = document.getElementById("activeAiProviderBadge");
        if (activeBadge) {
            activeBadge.innerHTML = `<i class="bi bi-cpu me-1"></i> ${escapeHtml(data.active_provider || 'Google Gemini')}`;
        }

        const providers = data.providers || {};
        for (const [id, stats] of Object.entries(providers)) {
            const badge = document.getElementById(`statusBadge_${id}`);
            if (badge) {
                if (stats.connected) {
                    badge.className = "badge bg-success px-2 py-1";
                    badge.innerHTML = '<i class="bi bi-check-circle-fill me-1"></i> Connected';
                } else {
                    badge.className = "badge bg-danger px-2 py-1";
                    badge.innerHTML = '<i class="bi bi-x-circle-fill me-1"></i> Disconnected';
                }
            }

            const masked = document.getElementById(`maskedKey_${id}`);
            if (masked) masked.textContent = stats.masked_key || "Belum diisi";

            const modelEl = document.getElementById(`model_${id}`);
            if (modelEl) modelEl.textContent = stats.model || "-";

            const latEl = document.getElementById(`latency_${id}`);
            if (latEl) latEl.textContent = stats.avg_latency_ms ? `${stats.avg_latency_ms} ms` : "-";

            const rateEl = document.getElementById(`rate_${id}`);
            if (rateEl) rateEl.textContent = `${stats.success_rate || 0}%`;

            const reqEl = document.getElementById(`requests_${id}`);
            if (reqEl) reqEl.textContent = stats.total_requests || 0;

            const toggle = document.getElementById(`toggle_${id}`);
            if (toggle) toggle.checked = Boolean(stats.enabled);

            const priorityBadge = document.getElementById(`priorityBadge_${id}`);
            if (priorityBadge) priorityBadge.textContent = `#${stats.priority || 1}`;

            const lastSuccessEl = document.getElementById(`lastSuccess_${id}`);
            if (lastSuccessEl) lastSuccessEl.textContent = stats.last_success ? new Date(stats.last_success).toLocaleTimeString("id-ID") : "-";

            const lastFailedEl = document.getElementById(`lastFailed_${id}`);
            if (lastFailedEl) lastFailedEl.textContent = stats.last_failed ? new Date(stats.last_failed).toLocaleTimeString("id-ID") : "-";

            const lastCheckedEl = document.getElementById(`lastChecked_${id}`);
            if (lastCheckedEl) lastCheckedEl.textContent = stats.last_checked ? new Date(stats.last_checked).toLocaleTimeString("id-ID") : "-";
        }
    } catch (err) {
        console.error("Gagal memuat status Multi-AI:", err);
    }
}

async function testSingleAiProvider(providerId) {
    const badge = document.getElementById(`statusBadge_${providerId}`);
    try {
        if (badge) {
            badge.className = "badge bg-warning text-dark px-2 py-1";
            badge.innerHTML = '<i class="bi bi-arrow-repeat spin me-1"></i> Testing...';
        }

        const res = await apiFetch("/admin/ai/test", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ provider_id: providerId })
        });

        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.success) {
            throw new Error(json.message || json.error || `HTTP ${res.status}: Gagal menghubungi ${providerId}`);
        }

        showToast(`✅ Uji Koneksi ${json.providerName || providerId} Berhasil! (${json.latency_ms} ms)`);
        loadMultiAiStatus();
        loadMultiAiLogs();
    } catch (err) {
        showToast(err.message || `❌ Uji koneksi ${providerId} gagal`, true);
        loadMultiAiStatus();
        loadMultiAiLogs();
    }
}

async function testAllAiProviders() {
    try {
        showToast("🚀 Menguji koneksi ke seluruh AI Provider...");
        const res = await apiFetch("/admin/ai/test", { method: "POST" });
        const json = await res.json().catch(() => ({}));

        if (!res.ok) throw new Error(json.message || "Gagal menguji seluruh provider");

        showToast("✅ Pengujian seluruh AI Provider selesai!");
        loadMultiAiStatus();
        loadMultiAiLogs();
    } catch (err) {
        showToast(err.message || "❌ Gagal menguji provider", true);
        loadMultiAiStatus();
    }
}

async function toggleAiProvider(providerId, enabled) {
    try {
        const res = await apiFetch("/admin/ai/provider", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: providerId, enabled })
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.message || "Gagal mengubah status provider");

        showToast(`✅ Status ${providerId} berhasil diubah.`);
        loadMultiAiStatus();
    } catch (err) {
        showToast(err.message, true);
        loadMultiAiStatus();
    }
}

function openApiKeyModal(providerId, providerName, defaultModel) {
    const stats = currentMultiAiData?.providers?.[providerId] || {};

    document.getElementById("modalApiKeyProviderId").value = providerId;
    document.getElementById("modalApiKeyProviderTitle").textContent = providerName;
    document.getElementById("modalApiKeyBadge").textContent = providerName;
    document.getElementById("modalApiKeyMaskedKeyPreview").textContent = stats.masked_key || "Belum diisi";

    const keyInput = document.getElementById("modalApiKeyInput");
    keyInput.value = "";
    keyInput.type = "password";
    document.getElementById("iconToggleKey").className = "bi bi-eye";

    // Priority & Enabled
    const prioritySelect = document.getElementById("modalApiKeyPriority");
    if (prioritySelect) prioritySelect.value = String(stats.priority || (providerId === "gemini" ? 1 : providerId === "groq" ? 2 : 3));

    const enabledSwitch = document.getElementById("modalApiKeyEnabled");
    if (enabledSwitch) enabledSwitch.checked = stats.enabled !== undefined ? stats.enabled : true;

    // Model select options
    const modelSelect = document.getElementById("modalApiKeyModelSelect");
    const modelCustomInput = document.getElementById("modalApiKeyModelInput");
    const presetList = AI_PRESET_MODELS[providerId] || [defaultModel, "custom"];

    modelSelect.innerHTML = presetList.map((m) => {
        if (m === "custom") return `<option value="custom">Model Custom (Tulis sendiri)</option>`;
        return `<option value="${m}">${m}</option>`;
    }).join("");

    const activeModel = stats.model || defaultModel;
    if (presetList.includes(activeModel)) {
        modelSelect.value = activeModel;
        modelCustomInput.value = activeModel;
    } else {
        modelSelect.value = "custom";
        modelCustomInput.value = activeModel;
    }

    // OpenRouter fields
    const openRouterBox = document.getElementById("modalOpenRouterFields");
    if (providerId === "openrouter") {
        openRouterBox.classList.remove("d-none");
        document.getElementById("modalApiKeyHttpReferer").value = stats.http_referer || "https://nexshop.id";
        document.getElementById("modalApiKeyAppName").value = stats.app_name || "NexShop NexBot";
    } else {
        openRouterBox.classList.add("d-none");
    }

    // Clear feedback alert
    const feedbackAlert = document.getElementById("modalTestFeedbackAlert");
    if (feedbackAlert) feedbackAlert.className = "alert d-none py-2 mb-3";

    // Icons
    const iconHeader = document.getElementById("modalApiKeyHeaderIcon");
    if (iconHeader) {
        if (providerId === "gemini") iconHeader.className = "bi bi-google text-primary me-2";
        else if (providerId === "groq") iconHeader.className = "bi bi-lightning-fill text-warning me-2";
        else iconHeader.className = "bi bi-globe text-info me-2";
    }

    const modalEl = document.getElementById("modalApiKey");
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl, {
        backdrop: "static",
        keyboard: true
    });
    modal.show();
}

function onAiModelSelectChange(val) {
    const input = document.getElementById("modalApiKeyModelInput");
    if (val !== "custom") {
        input.value = val;
    } else {
        input.focus();
    }
}

function toggleShowApiKey() {
    const input = document.getElementById("modalApiKeyInput");
    const icon = document.getElementById("iconToggleKey");
    if (input.type === "password") {
        input.type = "text";
        icon.className = "bi bi-eye-slash";
    } else {
        input.type = "password";
        icon.className = "bi bi-eye";
    }
}

function copyApiKeyToClipboard() {
    const input = document.getElementById("modalApiKeyInput");
    const providerId = document.getElementById("modalApiKeyProviderId").value;
    const stats = currentMultiAiData?.providers?.[providerId] || {};
    const textToCopy = input.value.trim() || stats.masked_key || "";

    if (!textToCopy) {
        showToast("⚠️ Tidak ada API Key yang dapat disalin.", true);
        return;
    }

    navigator.clipboard.writeText(textToCopy).then(() => {
        showToast("📋 API Key berhasil disalin ke clipboard!");
    }).catch(() => {
        showToast("Gagal menyalin key", true);
    });
}

function resetAiConfigModal() {
    document.getElementById("modalApiKeyInput").value = "";
    document.getElementById("modalApiKeyModelSelect").selectedIndex = 0;
    const firstVal = document.getElementById("modalApiKeyModelSelect").value;
    onAiModelSelectChange(firstVal);
    showToast("Input modal direset ke default.");
}

async function testAiConnectionFromModal() {
    const id = document.getElementById("modalApiKeyProviderId").value;
    const apiKey = document.getElementById("modalApiKeyInput").value.trim();
    const modelSelect = document.getElementById("modalApiKeyModelSelect").value;
    const customModel = document.getElementById("modalApiKeyModelInput").value.trim();
    const model = modelSelect === "custom" ? customModel : (modelSelect || customModel);

    const alertEl = document.getElementById("modalTestFeedbackAlert");
    const textEl = document.getElementById("modalTestFeedbackText");
    const badgeEl = document.getElementById("modalTestFeedbackBadge");
    const btn = document.getElementById("btnModalTestConn");

    try {
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Testing...';
        }
        if (alertEl) {
            alertEl.className = "alert alert-warning py-2 mb-3";
            textEl.textContent = `Menguji koneksi ${id}... (Mengirim REST ping real-time)`;
            badgeEl.className = "badge bg-warning text-dark";
            badgeEl.textContent = "Testing...";
        }

        if (apiKey) {
            await apiFetch("/admin/ai/apikey", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id, api_key: apiKey, model })
            });
        }

        const res = await apiFetch("/admin/ai/test", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ provider_id: id })
        });
        const json = await res.json().catch(() => ({}));

        if (!res.ok || !json.success) {
            throw new Error(json.message || json.error || `HTTP ${res.status}: Gagal menghubungi ${id}`);
        }

        const latencyVal = json.latency ?? json.latency_ms ?? json.latencyMs ?? 0;
        const httpVal = json.httpStatus ?? json.http_status ?? 200;

        if (alertEl) {
            alertEl.className = "alert alert-success py-2 mb-3";
            textEl.textContent = `✅ Connected! Latency: ${latencyVal} ms | HTTP ${httpVal} OK`;
            badgeEl.className = "badge bg-success";
            badgeEl.textContent = "🟢 Connected";
        }
        loadMultiAiStatus();
    } catch (err) {
        if (alertEl) {
            alertEl.className = "alert alert-danger py-2 mb-3";
            textEl.textContent = `🔴 Disconnected: ${err.message}`;
            badgeEl.className = "badge bg-danger";
            badgeEl.textContent = "Disconnected";
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="bi bi-lightning-charge me-1"></i> Test Connection';
        }
    }
}

async function saveAiApiKeyFromModal() {
    const id = document.getElementById("modalApiKeyProviderId").value;
    const apiKey = document.getElementById("modalApiKeyInput").value.trim();
    const modelSelect = document.getElementById("modalApiKeyModelSelect").value;
    const customModel = document.getElementById("modalApiKeyModelInput").value.trim();
    const model = modelSelect === "custom" ? customModel : (modelSelect || customModel);
    const priority = Number(document.getElementById("modalApiKeyPriority").value) || 1;
    const enabled = Boolean(document.getElementById("modalApiKeyEnabled").checked);
    const httpReferer = document.getElementById("modalApiKeyHttpReferer")?.value.trim();
    const appName = document.getElementById("modalApiKeyAppName")?.value.trim();

    if (!id) return;

    const btn = document.getElementById("btnSaveAiConfig");
    try {
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Menyimpan...';
        }

        const payload = { id, model, priority, enabled };
        if (apiKey) payload.api_key = apiKey;
        if (httpReferer) payload.http_referer = httpReferer;
        if (appName) payload.app_name = appName;

        const res = await apiFetch("/admin/ai/apikey", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        const json = await res.json().catch(() => ({}));

        if (!res.ok) throw new Error(json.message || "Gagal menyimpan konfigurasi AI");

        showToast(json.message || "✅ Konfigurasi AI berhasil disimpan!");

        const modalEl = document.getElementById("modalApiKey");
        const modal = bootstrap.Modal.getInstance(modalEl);
        if (modal) modal.hide();

        loadMultiAiStatus();
        loadMultiAiLogs();
    } catch (err) {
        showToast(err.message, true);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="bi bi-floppy me-1"></i> Simpan Konfigurasi';
        }
    }
}

async function deleteAiApiKeyFromModal() {
    const id = document.getElementById("modalApiKeyProviderId").value;
    const providerTitle = document.getElementById("modalApiKeyProviderTitle").textContent;

    if (!confirm(`Hapus API Key untuk ${providerTitle}? Provider akan dinonaktifkan.`)) return;

    try {
        const res = await apiFetch("/admin/ai/apikey", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, api_key: "", enabled: false })
        });
        const json = await res.json().catch(() => ({}));

        if (!res.ok) throw new Error(json.message || "Gagal menghapus API Key");

        showToast(`🗑️ API Key untuk ${providerTitle} berhasil dihapus.`);
        const modalEl = document.getElementById("modalApiKey");
        const modal = bootstrap.Modal.getInstance(modalEl);
        if (modal) modal.hide();

        loadMultiAiStatus();
        loadMultiAiLogs();
    } catch (err) {
        showToast(err.message, true);
    }
}

async function loadMultiAiLogs() {
    const tbody = document.getElementById("multiAiLogsTbody");
    if (!tbody) return;

    const providerFilter = document.getElementById("aiLogProviderFilter")?.value || "all";
    const statusFilter = document.getElementById("aiLogStatusFilter")?.value || "all";
    const dateFilter = document.getElementById("aiLogDateFilter")?.value || "";

    try {
        const queryParams = new URLSearchParams({
            provider: providerFilter,
            status: statusFilter,
            date: dateFilter,
            limit: 100
        });

        const res = await apiFetch(`/admin/ai/logs?${queryParams.toString()}`);
        const json = await res.json().catch(() => ({}));

        if (!res.ok) throw new Error(json.message || "Gagal memuat log Multi-AI");

        const logs = json.data || [];
        if (!logs.length) {
            tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-3">Tidak ada aktivitas log permintaan AI yang sesuai filter.</td></tr>`;
            return;
        }

        tbody.innerHTML = logs.map(log => {
            const timeStr = new Date(log.created_at).toLocaleString("id-ID");
            const badgeClass = log.is_success ? "bg-success" : "bg-danger";
            const badgeText = log.is_success ? "Berhasil" : "Gagal";
            const promptTrunc = escapeHtml(log.user_prompt || "-").slice(0, 50);

            let tokenStr = "-";
            if (log.token_usage) {
                if (typeof log.token_usage === "object") {
                    const promptTokens = log.token_usage.promptTokenCount || log.token_usage.prompt_tokens || 0;
                    const compTokens = log.token_usage.candidatesTokenCount || log.token_usage.completion_tokens || 0;
                    tokenStr = `P: ${promptTokens}, Out: ${compTokens}`;
                }
            }

            const errStr = log.error_message ? `<span class="text-danger small">${escapeHtml(log.error_message)}</span>` : tokenStr;

            return `
                <tr>
                    <td><small class="text-muted">${timeStr}</small></td>
                    <td><span class="badge bg-dark text-white">${escapeHtml(log.provider || 'AI')}</span></td>
                    <td><span class="badge bg-light text-dark border">${escapeHtml(log.model || '-')}</span></td>
                    <td title="${escapeHtml(log.user_prompt || '')}"><strong>${promptTrunc}</strong></td>
                    <td>${log.latency_ms} ms</td>
                    <td><code>${log.http_status}</code></td>
                    <td><span class="badge ${badgeClass}">${badgeText}</span></td>
                    <td><small>${errStr}</small></td>
                </tr>
            `;
        }).join("");
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center text-danger py-3">Gagal memuat log: ${escapeHtml(err.message)}</td></tr>`;
    }
}

// ==========================================
// TOP SPENDERS (HALL OF FAME)
// ==========================================

let adminTopSpenders = [];

async function loadAdminTopSpenders() {
    try {
        const res = await fetch(`${API_BASE}/stats/admin/leaderboard`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        if (!res.ok) throw new Error("Gagal mengambil data top spenders");
        adminTopSpenders = await res.json();
        renderTopSpendersTable();
    } catch (err) {
        console.error(err);
        Swal.fire("Error", "Gagal mengambil data Top Spenders", "error");
    }
}

function renderTopSpendersTable() {
    const tbody = document.getElementById("topSpendersTableBody");
    if (!tbody) return;

    if (adminTopSpenders.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted">Belum ada Top Spender manual</td></tr>`;
        return;
    }

    tbody.innerHTML = adminTopSpenders.map(ts => `
        <tr>
            <td>
                <span class="badge ${ts.rank <= 3 ? 'bg-primary' : 'bg-secondary'}">${ts.rank}</span>
            </td>
            <td>
                <div class="d-flex align-items-center gap-2">
                    ${ts.avatar_url ? `<img src="${ts.avatar_url}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;">` : `<div style="width:32px;height:32px;border-radius:50%;background:#495057;display:flex;align-items:center;justify-content:center;"><i class="bi bi-person text-white"></i></div>`}
                    <div class="fw-bold">${escapeHtml(ts.display_name)}</div>
                </div>
            </td>
            <td>Rp ${Number(ts.total_spending).toLocaleString('id-ID')}</td>
            <td>
                ${ts.badge ? `<span class="badge bg-info text-dark">${escapeHtml(ts.badge)}</span>` : '-'}
            </td>
            <td>
                <span class="badge ${ts.is_active ? 'bg-success' : 'bg-danger'}">
                    ${ts.is_active ? 'Active' : 'Inactive'}
                </span>
            </td>
            <td class="text-end">
                <button onclick="editTopSpender(${ts.id})" class="btn btn-warning btn-sm" title="Edit">
                    <i class="bi bi-pencil"></i>
                </button>
                <button onclick="deleteTopSpender(${ts.id})" class="btn btn-danger btn-sm" title="Hapus">
                    <i class="bi bi-trash"></i>
                </button>
            </td>
        </tr>
    `).join("");
}

let topSpenderModalInstance = null;

function openTopSpenderModal(id = null) {
    if (!topSpenderModalInstance) {
        const modalEl = document.getElementById('topSpenderModal');
        if (modalEl) {
            topSpenderModalInstance = new bootstrap.Modal(modalEl);
        }
    }
    const title = document.getElementById("topSpenderModalTitle");
    const form = document.getElementById("topSpenderForm");

    if (form) form.reset();
    document.getElementById("tsId").value = "";
    document.getElementById("tsActive").checked = true;
    document.getElementById("tsRank").value = "99";

    if (id) {
        if (title) title.innerHTML = '<i class="bi bi-trophy me-2"></i>Edit Top Spender';
        const ts = adminTopSpenders.find(t => t.id === id);
        if (ts) {
            document.getElementById("tsId").value = ts.id;
            document.getElementById("tsName").value = ts.display_name;
            document.getElementById("tsTotal").value = ts.total_spending;
            document.getElementById("tsAvatar").value = ts.avatar_url || "";
            document.getElementById("tsBadge").value = ts.badge || "";
            document.getElementById("tsRank").value = ts.rank || 99;
            document.getElementById("tsActive").checked = ts.is_active;
        }
    } else {
        if (title) title.innerHTML = '<i class="bi bi-trophy me-2"></i>Tambah Top Spender';
    }

    if (topSpenderModalInstance) {
        topSpenderModalInstance.show();
    }
}

function closeTopSpenderModal() {
    if (topSpenderModalInstance) {
        topSpenderModalInstance.hide();
    } else {
        const modalEl = document.getElementById('topSpenderModal');
        if (modalEl) {
            const inst = bootstrap.Modal.getInstance(modalEl);
            if (inst) inst.hide();
        }
    }
}

async function handleTopSpenderSubmit(e) {
    e.preventDefault();
    const id = document.getElementById("tsId").value;
    const payload = {
        display_name: document.getElementById("tsName").value.trim(),
        total_spending: parseFloat(document.getElementById("tsTotal").value),
        avatar_url: document.getElementById("tsAvatar").value.trim(),
        badge: document.getElementById("tsBadge").value.trim(),
        rank: parseInt(document.getElementById("tsRank").value) || 99,
        is_active: document.getElementById("tsActive").checked
    };

    try {
        const url = id ? `${API_BASE}/stats/admin/leaderboard/${id}` : `${API_BASE}/stats/admin/leaderboard`;
        const method = id ? "PUT" : "POST";

        const res = await fetch(url, {
            method,
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.message || "Gagal menyimpan");
        }

        Swal.fire({
            icon: "success",
            title: "Berhasil",
            text: "Top Spender berhasil disimpan",
            background: '#0f172a',
            color: '#fff',
            confirmButtonColor: '#8b5cf6'
        });

        closeTopSpenderModal();
        loadAdminTopSpenders();
    } catch (err) {
        Swal.fire("Error", err.message, "error");
    }
}

function editTopSpender(id) {
    openTopSpenderModal(id);
}

async function deleteTopSpender(id) {
    const result = await Swal.fire({
        title: 'Hapus Top Spender?',
        text: "Data ini tidak dapat dikembalikan",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#3b82f6',
        confirmButtonText: 'Ya, Hapus!',
        cancelButtonText: 'Batal',
        background: '#0f172a',
        color: '#fff'
    });

    if (result.isConfirmed) {
        try {
            const res = await fetch(`${API_BASE}/stats/admin/leaderboard/${id}`, {
                method: "DELETE",
                headers: { "Authorization": `Bearer ${token}` }
            });
            if (!res.ok) throw new Error("Gagal menghapus");

            Swal.fire({
                icon: "success",
                title: "Terhapus",
                background: '#0f172a',
                color: '#fff',
                confirmButtonColor: '#8b5cf6'
            });
            loadAdminTopSpenders();
        } catch (err) {
            Swal.fire("Error", "Gagal menghapus Top Spender", "error");
        }
    }
}


// ================================
// Ratings Management
// ================================
let currentRatingPage = 1;

async function loadAdminRatingSummary() {
    try {
        const res = await apiFetch("/ratings/admin/summary");
        if (res.ok) {
            const data = await res.json();
            document.getElementById("ratingAvgVal").textContent = data.average;
            document.getElementById("ratingTotalVal").textContent = data.total;
            document.getElementById("ratingPosVal").textContent = data.positive_percentage + "%";
            document.getElementById("ratingTodayVal").textContent = data.today_count;
        }
    } catch (e) {
        console.error("Gagal memuat ringkasan rating", e);
    }
}

async function loadAdminRatings(page = 1) {
    currentRatingPage = page;
    const tbody = document.getElementById("adminRatingsTbody");
    tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4"><div class="spinner-border text-primary" role="status"><span class="visually-hidden">Loading...</span></div></td></tr>`;

    const search = document.getElementById("searchRating").value.trim();
    const score = document.getElementById("filterRatingScore").value;
    const buyerType = document.getElementById("filterRatingBuyer").value;
    const dateFrom = document.getElementById("filterRatingFrom").value;
    const dateTo = document.getElementById("filterRatingTo").value;

    const query = new URLSearchParams({
        page: currentRatingPage,
        limit: 10
    });

    if (search) query.append("search", search);
    if (score) query.append("score", score);
    if (buyerType) query.append("buyer_type", buyerType);
    if (dateFrom) query.append("date_from", dateFrom);
    if (dateTo) query.append("date_to", dateTo);

    try {
        const res = await apiFetch(`/ratings/admin?${query.toString()}`);
        if (!res.ok) throw new Error("Gagal mengambil data rating");
        const json = await res.json();

        tbody.innerHTML = "";

        if (json.data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">Tidak ada ulasan ditemukan.</td></tr>`;
        } else {
            json.data.forEach(r => {
                const tr = document.createElement("tr");
                const dt = new Date(r.created_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });

                let starsHtml = "";
                for (let i = 1; i <= 5; i++) {
                    if (i <= r.score) starsHtml += `<i class="bi bi-star-fill text-warning me-1"></i>`;
                    else starsHtml += `<i class="bi bi-star text-muted me-1"></i>`;
                }

                const buyerTypeBadge = r.is_guest
                    ? `<span class="badge bg-secondary ms-2">Guest</span>`
                    : `<span class="badge bg-primary ms-2">Login</span>`;

                tr.innerHTML = `
                    <td class="text-nowrap">${dt}</td>
                    <td><strong>${escapeHtml(r.order_id)}</strong></td>
                    <td>${escapeHtml(r.buyer_name)} ${buyerTypeBadge}</td>
                    <td class="text-nowrap">${starsHtml}</td>
                    <td>${escapeHtml(r.comment || "-")}</td>
                `;
                tbody.appendChild(tr);
            });
        }

        document.getElementById("ratingPageInfo").textContent = `Halaman ${json.meta.page} dari ${json.meta.totalPages || 1} (${json.meta.total} ulasan)`;

        document.getElementById("btnRatingPrev").disabled = json.meta.page <= 1;
        document.getElementById("btnRatingNext").disabled = json.meta.page >= json.meta.totalPages;

    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center text-danger">Error: ${escapeHtml(e.message)}</td></tr>`;
    }
}

function changeRatingPage(dir) {
    loadAdminRatings(currentRatingPage + dir);
}

// ================================
// Testimoni Kustom (Homepage "Apa Kata Mereka")
// ================================
let customTestimonials = [];
const customTestimonialModalEl = document.getElementById("customTestimonialModal");
let customTestimonialModal = null;
if (customTestimonialModalEl) {
    customTestimonialModal = new bootstrap.Modal(customTestimonialModalEl);
}

const ctAvatarInput = document.getElementById("ctAvatarInput");
const ctAvatarPreview = document.getElementById("ctAvatarPreview");

if (ctAvatarInput) {
    ctAvatarInput.addEventListener("change", () => {
        const file = ctAvatarInput.files[0];
        if (!file) {
            ctAvatarPreview.classList.add("d-none");
            ctAvatarPreview.src = "";
            return;
        }
        ctAvatarPreview.src = URL.createObjectURL(file);
        ctAvatarPreview.classList.remove("d-none");
    });
}

if (customTestimonialModalEl) {
    customTestimonialModalEl.addEventListener("hidden.bs.modal", () => {
        document.getElementById("ctId").value = "";
        document.getElementById("ctName").value = "";
        document.getElementById("ctScore").value = "5";
        document.getElementById("ctProductName").value = "";
        document.getElementById("ctComment").value = "";
        document.getElementById("ctIsActive").checked = true;
        document.getElementById("ctError").textContent = "";
        ctAvatarInput.value = "";
        ctAvatarPreview.src = "";
        ctAvatarPreview.classList.add("d-none");
    });
}

async function loadCustomTestimonials() {
    const tbody = document.getElementById("customTestimonialsTbody");
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4"><div class="spinner-border text-primary" role="status"></div></td></tr>`;

    try {
        const res = await apiFetch("/ratings/admin/custom");
        const json = await res.json().catch(() => ([]));
        if (!res.ok) throw new Error(json.message || "Gagal mengambil testimoni kustom");

        customTestimonials = Array.isArray(json) ? json : [];

        if (customTestimonials.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">Belum ada testimoni kustom. Klik "Tambah Testimoni" untuk membuat.</td></tr>`;
            return;
        }

        tbody.innerHTML = customTestimonials.map(t => {
            const stars = "★".repeat(t.score) + "☆".repeat(5 - t.score);
            const avatarHtml = t.avatar_url
                ? `<img src="${escapeHtml(t.avatar_url)}" style="width:40px;height:40px;object-fit:cover;border-radius:50%;">`
                : `<div class="d-flex align-items-center justify-content-center rounded-circle bg-secondary text-white" style="width:40px;height:40px;font-size:.75rem;">${escapeHtml((t.name || "?").charAt(0).toUpperCase())}</div>`;
            const statusBadge = t.is_active
                ? `<span class="badge bg-success">Aktif</span>`
                : `<span class="badge bg-secondary">Nonaktif</span>`;

            return `
                <tr>
                    <td>${avatarHtml}</td>
                    <td><strong>${escapeHtml(t.name)}</strong></td>
                    <td class="text-warning text-nowrap">${stars}</td>
                    <td>${escapeHtml(t.product_name || "-")}</td>
                    <td style="max-width:260px;">${escapeHtml(t.comment)}</td>
                    <td>${statusBadge}</td>
                    <td class="text-nowrap">
                        <button class="btn btn-sm btn-outline-warning me-1" onclick="editCustomTestimonial(${t.id})" title="Edit"><i class="bi bi-pencil"></i></button>
                        <button class="btn btn-sm btn-outline-danger" onclick="deleteCustomTestimonial(${t.id})" title="Hapus"><i class="bi bi-trash"></i></button>
                    </td>
                </tr>`;
        }).join("");

    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger">Error: ${escapeHtml(e.message)}</td></tr>`;
    }
}

function openCustomTestimonialModal() {
    document.getElementById("customTestimonialModalTitle").innerHTML = `<i class="bi bi-chat-square-quote me-2"></i>Tambah Testimoni`;
    customTestimonialModal.show();
}

function editCustomTestimonial(id) {
    const t = customTestimonials.find(x => x.id === id);
    if (!t) return;

    document.getElementById("ctId").value = t.id;
    document.getElementById("ctName").value = t.name || "";
    document.getElementById("ctScore").value = String(t.score || 5);
    document.getElementById("ctProductName").value = t.product_name || "";
    document.getElementById("ctComment").value = t.comment || "";
    document.getElementById("ctIsActive").checked = !!t.is_active;

    if (t.avatar_url) {
        ctAvatarPreview.src = t.avatar_url;
        ctAvatarPreview.classList.remove("d-none");
    }

    document.getElementById("customTestimonialModalTitle").innerHTML = `<i class="bi bi-chat-square-quote me-2"></i>Edit Testimoni`;
    customTestimonialModal.show();
}

async function saveCustomTestimonial() {
    const id = document.getElementById("ctId").value;
    const name = document.getElementById("ctName").value.trim();
    const score = parseInt(document.getElementById("ctScore").value, 10);
    const productName = document.getElementById("ctProductName").value.trim();
    const comment = document.getElementById("ctComment").value.trim();
    const isActive = document.getElementById("ctIsActive").checked;
    const avatarFile = ctAvatarInput.files[0];
    const errorEl = document.getElementById("ctError");

    errorEl.textContent = "";

    if (!name) { errorEl.textContent = "Nama wajib diisi."; return; }
    if (!comment) { errorEl.textContent = "Isi testimoni wajib diisi."; return; }

    const saveBtn = document.getElementById("saveCustomTestimonialBtn");
    const originalHtml = saveBtn.innerHTML;
    saveBtn.disabled = true;
    saveBtn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> Menyimpan...`;

    try {
        let avatarUrl;
        if (id) {
            const existing = customTestimonials.find(t => t.id == id);
            avatarUrl = existing ? existing.avatar_url : null;
        }

        if (avatarFile) {
            const formData = new FormData();
            formData.append("image", avatarFile);
            const uploadRes = await apiFetch("/upload/image?type=avatar", { method: "POST", body: formData });
            const uploadJson = await uploadRes.json().catch(() => ({}));
            if (!uploadRes.ok) throw new Error(uploadJson.message || "Gagal upload foto profil");
            avatarUrl = uploadJson.url;
        }

        const payload = {
            name,
            score,
            product_name: productName,
            comment,
            is_active: isActive,
            avatar_url: avatarUrl || null
        };

        const endpoint = id ? `/ratings/admin/custom/${id}` : "/ratings/admin/custom";
        const method = id ? "PUT" : "POST";

        const res = await apiFetch(endpoint, {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.message || "Gagal menyimpan testimoni");

        customTestimonialModal.hide();
        showToast(id ? "Testimoni berhasil diupdate" : "Testimoni berhasil ditambahkan");
        loadCustomTestimonials();

    } catch (e) {
        errorEl.textContent = e.message;
    } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = originalHtml;
    }
}

async function deleteCustomTestimonial(id) {
    if (!confirm("Hapus testimoni ini permanen?")) return;
    try {
        const res = await apiFetch(`/ratings/admin/custom/${id}`, { method: "DELETE" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.message || "Gagal menghapus testimoni");
        showToast("Testimoni berhasil dihapus");
        loadCustomTestimonials();
    } catch (e) {
        showToast(e.message, true);
    }
}

// ================================
// Music Player Management
// ================================

let musicList = [];
const musicModalEl = document.getElementById("musicModal");
let musicModal = null;
if (musicModalEl) {
    musicModal = new bootstrap.Modal(musicModalEl);
}

const musicAudioInput = document.getElementById("musicAudioInput");
const musicAudioPreview = document.getElementById("musicAudioPreview");
const musicAudioElement = document.getElementById("musicAudioElement");
const musicCoverInput = document.getElementById("musicCoverInput");
const musicCoverPreview = document.getElementById("musicCoverPreview");

if (musicAudioInput) {
    musicAudioInput.addEventListener("change", () => {
        const file = musicAudioInput.files[0];
        if (!file) {
            musicAudioPreview.classList.add("d-none");
            musicAudioElement.src = "";
            return;
        }
        musicAudioElement.src = URL.createObjectURL(file);
        musicAudioPreview.classList.remove("d-none");
    });
}

if (musicCoverInput) {
    musicCoverInput.addEventListener("change", () => {
        const file = musicCoverInput.files[0];
        if (!file) {
            musicCoverPreview.src = "";
            musicCoverPreview.classList.add("d-none");
            return;
        }
        musicCoverPreview.src = URL.createObjectURL(file);
        musicCoverPreview.classList.remove("d-none");
    });
}

if (musicModalEl) {
    musicModalEl.addEventListener("hidden.bs.modal", () => {
        document.getElementById("musicForm").reset();
        musicAudioPreview.classList.add("d-none");
        musicAudioElement.src = "";
        musicCoverPreview.src = "";
        musicCoverPreview.classList.add("d-none");
        document.getElementById("musicError").textContent = "";
    });
}

async function loadMusicList() {
    const tbody = document.getElementById("musicList");
    tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4"><div class="spinner-border text-primary" role="status"></div></td></tr>`;

    try {
        const res = await apiFetch("/music/admin");
        if (!res.ok) throw new Error("Gagal mengambil data lagu");
        const json = await res.json();

        musicList = json.musicList;
        document.getElementById("masterMusicToggle").checked = json.enabled;

        if (musicList.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">Belum ada lagu.</td></tr>`;
            return;
        }

        tbody.innerHTML = musicList.map((m) => `
            <tr>
                <td><img src="${escapeHtml(m.cover_url)}" style="width:50px;height:50px;object-fit:cover;border-radius:50%;"></td>
                <td><strong>${escapeHtml(m.title)}</strong></td>
                <td>
                    <audio controls src="${escapeHtml(m.audio_url)}" style="height:32px; max-width:200px;"></audio>
                </td>
                <td>
                    ${m.is_active
                ? '<span class="badge bg-success"><i class="bi bi-play-circle"></i> Aktif Tampil</span>'
                : '<span class="badge bg-secondary">Tidak Aktif</span>'}
                </td>
                <td>
                    ${!m.is_active ? `<button class="btn btn-sm btn-outline-success me-1" onclick="setActiveMusic(${m.id})" title="Jadikan Lagu Aktif"><i class="bi bi-check-circle"></i></button>` : ''}
                    <button class="btn btn-sm btn-outline-warning me-1" onclick="editMusic(${m.id})" title="Edit"><i class="bi bi-pencil"></i></button>
                    <button class="btn btn-sm btn-outline-danger" onclick="deleteMusic(${m.id})" title="Hapus"><i class="bi bi-trash"></i></button>
                </td>
            </tr>
        `).join("");

    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center text-danger">Error: ${escapeHtml(e.message)}</td></tr>`;
    }
}

function openMusicModal() {
    document.getElementById("musicId").value = "";
    document.getElementById("musicModalTitle").innerHTML = `<i class="bi bi-music-note-list me-2"></i>Tambah Lagu`;
    musicModal.show();
}

function editMusic(id) {
    const music = musicList.find(m => m.id === id);
    if (!music) return;

    document.getElementById("musicId").value = music.id;
    document.getElementById("musicTitle").value = music.title;

    // Preview current audio/cover
    musicAudioElement.src = music.audio_url;
    musicAudioPreview.classList.remove("d-none");
    musicCoverPreview.src = music.cover_url;
    musicCoverPreview.classList.remove("d-none");

    document.getElementById("musicModalTitle").innerHTML = `<i class="bi bi-music-note-list me-2"></i>Edit Lagu`;
    musicModal.show();
}

async function saveMusic() {
    const id = document.getElementById("musicId").value;
    const title = document.getElementById("musicTitle").value.trim();
    const audioFile = musicAudioInput.files[0];
    const coverFile = musicCoverInput.files[0];
    const errorEl = document.getElementById("musicError");

    errorEl.textContent = "";

    if (!title) {
        errorEl.textContent = "Judul lagu wajib diisi!";
        return;
    }

    if (!id && (!audioFile || !coverFile)) {
        errorEl.textContent = "File audio dan gambar cover wajib diisi untuk lagu baru!";
        return;
    }

    const saveBtn = document.getElementById("saveMusicBtn");
    const originalHtml = saveBtn.innerHTML;
    saveBtn.disabled = true;
    saveBtn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> Menyimpan...`;

    try {
        let audioUrl = "";
        let coverUrl = "";

        if (id) {
            // Get existing URLs if editing and no new file uploaded
            const existingMusic = musicList.find(m => m.id == id);
            audioUrl = existingMusic.audio_url;
            coverUrl = existingMusic.cover_url;
        }

        // Upload audio
        if (audioFile) {
            const audioData = new FormData();
            audioData.append("audio", audioFile);
            let audioUploadRes = await apiFetch("/upload/audio", { method: "POST", body: audioData });
            let audioUploadJson = await audioUploadRes.json().catch(() => ({}));
            if (!audioUploadRes.ok) throw new Error(audioUploadJson.message || "Gagal upload audio");
            audioUrl = audioUploadJson.url;
        }

        // Upload cover
        if (coverFile) {
            const coverData = new FormData();
            coverData.append("image", coverFile);
            let coverUploadRes = await apiFetch("/upload/image?type=music_cover", { method: "POST", body: coverData });
            let coverUploadJson = await coverUploadRes.json().catch(() => ({}));
            if (!coverUploadRes.ok) throw new Error(coverUploadJson.message || "Gagal upload gambar cover");
            coverUrl = coverUploadJson.url;
        }

        // Save to DB
        const endpoint = id ? `/music/${id}` : "/music";
        const method = id ? "PUT" : "POST";

        const res = await apiFetch(endpoint, {
            method: method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title, audio_url: audioUrl, cover_url: coverUrl })
        });
        const json = await res.json().catch(() => ({}));

        if (!res.ok) throw new Error(json.message || "Gagal menyimpan lagu");

        musicModal.hide();
        showToast(id ? "Lagu berhasil diupdate" : "Lagu berhasil ditambahkan");
        loadMusicList();

    } catch (e) {
        errorEl.textContent = e.message;
    } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = originalHtml;
    }
}

async function setActiveMusic(id) {
    if (!confirm("Aktifkan lagu ini untuk diputar di homepage?")) return;
    try {
        const res = await apiFetch(`/music/${id}/active`, { method: "PUT" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.message || "Gagal mengaktifkan lagu");
        showToast("Lagu aktif berhasil diperbarui");
        loadMusicList();
    } catch (e) {
        showToast(e.message, true);
    }
}

async function deleteMusic(id) {
    if (!confirm("Hapus lagu ini permanen?")) return;
    try {
        const res = await apiFetch(`/music/${id}`, { method: "DELETE" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.message || "Gagal menghapus lagu");
        showToast("Lagu berhasil dihapus");
        loadMusicList();
    } catch (e) {
        showToast(e.message, true);
    }
}

async function toggleMasterMusicPlayer(enabled) {
    try {
        const res = await apiFetch("/music/toggle", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled })
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
            document.getElementById("masterMusicToggle").checked = !enabled; // revert
            throw new Error(json.message || "Gagal merubah status player");
        }
        showToast(`Music Player ${enabled ? 'diaktifkan' : 'dinonaktifkan'}`);
    } catch (e) {
        showToast(e.message, true);
    }
}

// ===========================================================
// WhatsApp API — QR status & rescan (admin dashboard)
// ===========================================================
var waQrRefreshTimer = null;

/** fetch WA connection status + QR code — GET (NO security PIN needed, read-only) */
async function refreshWaQr() {
    const badge = document.getElementById("waQrBadge");
    const container = document.getElementById("waQrContainer");
    const qrImg = document.getElementById("waQrImage");
    const errEl = document.getElementById("waQrError");
    errEl.classList.add("d-none");

    try {
        const res = await apiFetch("/settings/wa-api/status");
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Gagal ambil status WA");

        if (data.waConnected) {
            badge.textContent = "✅ Terhubung";
            badge.className = "badge bg-success";
            container.classList.add("d-none");
        } else if (data.qr) {
            badge.textContent = "⚠️ Belum terhubung — scan QR";
            badge.className = "badge bg-warning text-dark";
            qrImg.src = data.qrImage || "";
            container.classList.remove("d-none");
        } else {
            badge.textContent = "⏳ Menunggu QR...";
            badge.className = "badge bg-secondary";
            container.classList.add("d-none");
        }
    } catch (err) {
        badge.textContent = "❌ Offline";
        badge.className = "badge bg-danger";
        errEl.textContent = err.message;
        errEl.classList.remove("d-none");
    }
}

/** hapus session & trigger QR baru */
async function forceWaRescan() {
    if (!confirm("Reset session WhatsApp & generate QR baru? WhatsApp akan terputus & perlu scan ulang.")) return;

    const btn = document.getElementById("waRescanBtn");
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> Reset...`;

    try {
        await withAdminPin(async (security_pin) => {
            const res = await apiFetch("/settings/wa-api/rescan", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ security_pin })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.message || "Gagal reset WA");

            showToast(data.message || "QR baru digenerate. Scan di WhatsApp ponsel.");
            setTimeout(refreshWaQr, 1000);
        }, "mereset sesi WhatsApp (scan ulang)");
    } catch (err) {
        if (err.message === "unauthorized") return;
        showToast("Gagal reset WA: " + err.message, true);
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="bi bi-trash"></i> Reset & Scan Ulang`;
    }
}

// WhatsApp API manager terpisah dari Settings > API Keys.
async function loadWaApiManager(force = false) {
    if (waApiManagerLoaded && !force) return;
    const statusError = document.getElementById("waManagerStatusError");
    try {
        const [statusRes, campaignsRes, contactsRes] = await Promise.all([apiFetch("/settings/wa-api/status"), apiFetch("/wa-marketing/campaigns"), apiFetch("/wa-marketing/contacts")]);
        const status = await statusRes.json().catch(() => ({}));
        if (status.gateway_url) document.getElementById("waManagerUrl").value = status.gateway_url;
        if (status.target_number) document.getElementById("waManagerTarget").value = status.target_number;
        renderWaApiManagerStatus(status);
        const campaigns = await campaignsRes.json().catch(() => ({}));
        const contacts = await contactsRes.json().catch(() => ({}));
        if (!campaignsRes.ok && campaignsRes.status !== 503) throw new Error(campaigns.message || "Gagal memuat campaign");
        if (!contactsRes.ok && contactsRes.status !== 503) throw new Error(contacts.message || "Gagal memuat kontak");
        renderWaCampaigns(campaigns.campaigns || []); renderWaContacts(contacts.contacts || []); waApiManagerLoaded = true;
    } catch (error) { statusError.textContent = error.message || "Gagal memuat WhatsApp API."; }
}

function renderWaApiManagerStatus(data) {
    const badge = document.getElementById("waManagerBadge"); const state = document.getElementById("waManagerState"); const qrWrap = document.getElementById("waManagerQrWrap"); const qrImage = document.getElementById("waManagerQrImage"); const error = document.getElementById("waManagerStatusError");
    error.textContent = data.success === false ? (data.message || "Gateway tidak dapat dihubungi.") : "";
    if (data.waConnected) { badge.textContent = "Connected"; badge.className = "badge bg-success"; state.textContent = "WhatsApp terhubung dan siap mengirim pesan."; }
    else if (data.qrAvailable && data.qrImage) { badge.textContent = "Scan QR"; badge.className = "badge bg-warning text-dark"; state.textContent = "QR tersedia. Scan dari WhatsApp ponsel admin."; }
    else { badge.textContent = data.success === false ? "Offline" : "Belum terhubung"; badge.className = `badge ${data.success === false ? "bg-danger" : "bg-secondary"}`; state.textContent = "Gateway belum terhubung atau sedang menunggu QR."; }
    qrWrap.classList.toggle("d-none", !data.qrAvailable || !data.qrImage); if (data.qrImage) qrImage.src = data.qrImage;
}

async function refreshWaApiManagerStatus() {
    try { const res = await apiFetch("/settings/wa-api/status"); renderWaApiManagerStatus(await res.json().catch(() => ({}))); }
    catch (error) { document.getElementById("waManagerStatusError").textContent = error.message; }
}

async function provisionWaApiManager() {
    const result = document.getElementById("waManagerProvisionResult");
    try { await withAdminPin(async (security_pin) => {
        const res = await apiFetch("/settings/wa-api/provision", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ security_pin, waapi_url: document.getElementById("waManagerUrl").value.trim(), waapi_target_number: document.getElementById("waManagerTarget").value.trim() }) });
        const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.message || "Provisioning WA gagal");
        result.className = "small mt-3 text-success"; result.textContent = data.message || "Gateway berhasil diprovision."; await refreshWaApiManagerStatus();
    }, "membuat atau merotasi key WhatsApp API"); }
    catch (error) { if (error.message !== "unauthorized") { result.className = "small mt-3 text-danger"; result.textContent = error.message; } }
}

async function resetWaApiManagerSession() {
    if (!confirm("Reset sesi WhatsApp? Ponsel admin harus scan QR ulang.")) return;
    try { await withAdminPin(async (security_pin) => {
        const res = await apiFetch("/settings/wa-api/rescan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ security_pin }) }); const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.message || "Reset WhatsApp gagal");
        showToast(data.message || "Sesi direset. QR baru sedang dibuat."); setTimeout(refreshWaApiManagerStatus, 1500);
    }, "mereset sesi WhatsApp API"); } catch (error) { if (error.message !== "unauthorized") showToast(error.message, true); }
}

async function sendWaApiManagerTest() {
    const result = document.getElementById("waManagerTestResult");
    try { await withAdminPin(async (security_pin) => {
        const res = await apiFetch("/settings/test-whatsapp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ security_pin, number: document.getElementById("waManagerTestNumber").value.trim(), message: document.getElementById("waManagerTestMessage").value.trim(), mediaUrl: document.getElementById("waManagerTestMedia").value.trim() }) }); const data = await res.json().catch(() => ({})); if (!res.ok || data.success === false) throw new Error(data.message || "Test chat gagal");
        result.className = "small mt-3 text-success"; result.textContent = data.message || "Test chat berhasil dikirim.";
    }, "mengirim test chat WhatsApp"); } catch (error) { if (error.message !== "unauthorized") { result.className = "small mt-3 text-danger"; result.textContent = error.message; } }
}

function renderWaCampaigns(campaigns) {
    const tbody = document.getElementById("waCampaignTbody"); tbody.innerHTML = campaigns.length ? campaigns.map((campaign) => `<tr><td>${escapeHtml(campaign.title)}</td><td>${escapeHtml(campaign.kind)}</td><td>${escapeHtml(campaign.status)}</td><td>${new Date(campaign.scheduled_at).toLocaleString("id-ID")}</td><td>${campaign.sent_count || 0}/${(campaign.sent_count || 0) + (campaign.failed_count || 0)}</td></tr>`).join("") : '<tr><td colspan="5" class="text-muted">Belum ada campaign.</td></tr>';
}

function renderWaContacts(contacts) {
    const tbody = document.getElementById("waContactsTbody"); tbody.innerHTML = contacts.length ? contacts.map((contact) => `<tr><td>${escapeHtml(contact.display_name)}</td><td>${escapeHtml(contact.phone_normalized)}</td><td><button class="btn btn-sm ${contact.marketing_opt_in ? "btn-success" : "btn-outline-secondary"}" onclick="toggleWaContactOptIn('${contact.id}', ${!contact.marketing_opt_in})">${contact.marketing_opt_in ? "Opt-in" : "Opt-in?"}</button></td><td>${contact.user_id ? "Terdaftar" : "Tamu"}</td></tr>`).join("") : '<tr><td colspan="4" class="text-muted">Belum ada chat inbound.</td></tr>';
}

async function toggleWaContactOptIn(id, value) {
    const res = await apiFetch(`/wa-marketing/contacts/${encodeURIComponent(id)}/opt-in`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ marketing_opt_in: value }) }); const data = await res.json().catch(() => ({})); if (!res.ok) return showToast(data.message || "Gagal mengubah opt-in", true); await loadWaCampaignData();
}

async function loadWaCampaignData() {
    const [campaignsRes, contactsRes] = await Promise.all([apiFetch("/wa-marketing/campaigns"), apiFetch("/wa-marketing/contacts")]); const campaigns = await campaignsRes.json().catch(() => ({})); const contacts = await contactsRes.json().catch(() => ({})); renderWaCampaigns(campaigns.campaigns || []); renderWaContacts(contacts.contacts || []);
}

async function createWaCampaign() {
    const result = document.getElementById("waCampaignResult"); const scheduleRaw = document.getElementById("waCampaignSchedule").value;
    try { const res = await apiFetch("/wa-marketing/campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: document.getElementById("waCampaignKind").value, title: document.getElementById("waCampaignTitle").value.trim(), message: document.getElementById("waCampaignMessage").value.trim(), media_url: document.getElementById("waCampaignMedia").value.trim(), promo_code: document.getElementById("waCampaignCode").value.trim(), scheduled_at: scheduleRaw ? new Date(scheduleRaw).toISOString() : new Date().toISOString() }) }); const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.message || "Campaign gagal dibuat"); result.className = "small mt-3 text-success"; result.textContent = "Campaign masuk queue. Hanya kontak terdaftar opt-in yang akan menerima."; await loadWaCampaignData(); }
    catch (error) { result.className = "small mt-3 text-danger"; result.textContent = error.message; }
}

async function runWaMarketingNow() {
    const result = document.getElementById("waCampaignResult");
    try { const res = await apiFetch("/wa-marketing/run-now", { method: "POST" }); const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.message || "Queue gagal dijalankan"); result.className = "small mt-3 text-success"; result.textContent = `Queue selesai: ${data.campaigns?.sent || 0} pesan campaign terkirim, ${data.followups?.processed || 0} follow-up diproses.`; await loadWaCampaignData(); }
    catch (error) { result.className = "small mt-3 text-danger"; result.textContent = error.message; }
}

// Auto-refresh QR status setiap 15 detik
document.addEventListener("DOMContentLoaded", () => {
    refreshWaQr();
    waQrRefreshTimer = setInterval(refreshWaQr, 15000);
});
