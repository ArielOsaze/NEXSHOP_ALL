const API_BASE = (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
    ? (window.location.port === "3000" ? "/api" : "http://localhost:3000/api")
    : (window.location.protocol.startsWith("http") ? "/api" : "https://nexshop.cloud/api");
const ADMIN_TOKEN_STORAGE_KEY = "nexshop-admin-token";

// Already logged in? Skip straight to dashboard.
if (localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY)) {
    window.location.href = "/admin/dashboard.html";
}

// Pesan kenapa sesi sebelumnya berakhir — disimpen dashboard sebelum
// redirect ke sini, biar admin gak bingung kenapa tiba-tiba ke-logout.
const ADMIN_LOGOUT_REASONS = {
    idle: "Kamu otomatis di-logout karena tidak ada aktivitas selama 15 menit. Silakan login kembali.",
    forbidden: "Akun ini tidak (lagi) punya akses admin/staff. Hubungi Super Admin kalau ini keliru.",
    expired: "Sesi kamu sudah berakhir. Silakan login kembali."
};

const lastLogoutReason = localStorage.getItem("nexshop_admin_logout_reason");
if (lastLogoutReason && ADMIN_LOGOUT_REASONS[lastLogoutReason]) {
    localStorage.removeItem("nexshop_admin_logout_reason");
    window.addEventListener("DOMContentLoaded", () => {
        document.getElementById("loginError").textContent = ADMIN_LOGOUT_REASONS[lastLogoutReason];
    });
}

const form = document.getElementById("loginForm");
const errorEl = document.getElementById("loginError");
const loginBtn = document.getElementById("loginBtn");
const passwordInput = document.getElementById("password");
const toggleBtn = document.getElementById("togglePassword");

async function initAdminLoginSecurity() {
    const security = window.NexShopAuthSecurity;
    if (!security) return;
    await security.mountCaptcha("admin-login", "adminLoginTurnstile", "adminLoginTurnstileStatus", { allowUnconfigured: true });
}

const adminCaptchaReady = initAdminLoginSecurity();

toggleBtn.addEventListener("click", () => {
    const isHidden = passwordInput.type === "password";
    passwordInput.type = isHidden ? "text" : "password";
    toggleBtn.querySelector("i").className = isHidden ? "bi bi-eye-slash" : "bi bi-eye";
});

form.addEventListener("submit", async (e) => {
    e.preventDefault(); // form now submits properly through this handler, not window navigation

    errorEl.textContent = "";

    const email = document.getElementById("email").value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
        errorEl.textContent = "Email dan Password wajib diisi!";
        return;
    }

    setLoading(true);

    try {
        await adminCaptchaReady;
        const captcha_token = window.NexShopAuthSecurity
            ? await window.NexShopAuthSecurity.captchaToken("admin-login", { allowUnconfigured: true })
            : "";
        let res;
        try {
            res = await fetch(`${API_BASE}/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password, captcha_token, login_context: "admin" })
            });
        } catch {
            throw new Error("Tidak dapat terhubung ke server NexShop. Periksa status backend lalu coba lagi.");
        }

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
            if (data.message) throw new Error(data.message);
            if (res.status >= 500) {
                throw new Error(`Server NexShop sedang tidak tersedia (HTTP ${res.status}). Coba lagi setelah backend aktif.`);
            }
            throw new Error("Login ditolak. Periksa email dan password kamu.");
        }

        if (!data.token || !data.user || !["admin", "staff"].includes(data.user.role)) {
            throw new Error("Akun ini tidak memiliki akses administrator atau staff.");
        }

        localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, data.token);
        window.location.href = "/admin/dashboard.html";

    } catch (err) {
        console.error(err);
        errorEl.textContent = err.message || "Terjadi kesalahan. Coba lagi.";
        setLoading(false);
        if (window.NexShopAuthSecurity && typeof window.NexShopAuthSecurity.resetCaptcha === "function") {
            window.NexShopAuthSecurity.resetCaptcha("admin-login");
        }
    }
});

function setLoading(isLoading) {
    loginBtn.disabled = isLoading;
    loginBtn.innerHTML = isLoading
        ? `<span class="spinner-border spinner-border-sm me-2"></span>Memproses...`
        : `<i class="bi bi-box-arrow-in-right me-2"></i>Login`;
}
