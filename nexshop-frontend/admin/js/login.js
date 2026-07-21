const API_BASE = "https://nexshop-backend-production.up.railway.app/api";

// Already logged in? Skip straight to dashboard.
if (localStorage.getItem("token")) {
    window.location.href = "dashboard.html";
}

if (localStorage.getItem("nexshop_admin_logout_reason") === "idle") {
    localStorage.removeItem("nexshop_admin_logout_reason");
    window.addEventListener("DOMContentLoaded", () => {
        document.getElementById("loginError").textContent =
            "Kamu otomatis di-logout karena tidak ada aktivitas selama 15 menit. Silakan login kembali.";
    });
}

const form = document.getElementById("loginForm");
const errorEl = document.getElementById("loginError");
const loginBtn = document.getElementById("loginBtn");
const passwordInput = document.getElementById("password");
const toggleBtn = document.getElementById("togglePassword");

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
        const res = await fetch(`${API_BASE}/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password })
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
            throw new Error(data.message || "Login gagal. Periksa email dan password kamu.");
        }

        if (!data.token) {
            throw new Error("Server tidak mengirimkan token. Hubungi admin backend.");
        }

        localStorage.setItem("token", data.token);
        window.location.href = "dashboard.html";

    } catch (err) {
        console.error(err);
        errorEl.textContent = err.message || "Terjadi kesalahan. Coba lagi.";
        setLoading(false);
    }
});

function setLoading(isLoading) {
    loginBtn.disabled = isLoading;
    loginBtn.innerHTML = isLoading
        ? `<span class="spinner-border spinner-border-sm me-2"></span>Memproses...`
        : `<i class="bi bi-box-arrow-in-right me-2"></i>Login`;
}
