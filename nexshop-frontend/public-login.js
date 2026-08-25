const API_BASE = (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
    ? (window.location.port === "3000" ? "/api" : "http://localhost:3000/api")
    : "/api";
const PUBLIC_TOKEN_STORAGE_KEY = "nexshop-public-token";

const form = document.getElementById("loginForm");
const status = document.getElementById("loginStatus");
const button = document.getElementById("loginButton");

async function finishGoogleLogin(data) {
    localStorage.setItem(PUBLIC_TOKEN_STORAGE_KEY, data.token);
    localStorage.setItem("nexshop_user", JSON.stringify(data.user));
    window.location.assign("/");
}

async function initPublicLoginSecurity() {
    const security = window.NexShopAuthSecurity;
    if (!security) return;
    await security.mountCaptcha("public-login", "publicLoginTurnstile", "publicLoginTurnstileStatus");
    document.getElementById("googleLoginButton")?.addEventListener("click", async () => {
        status.textContent = "";
        status.classList.remove("is-error");
        try {
            await security.beginGoogle("login");
        } catch (error) {
            status.textContent = error.message || "Login Google belum dapat dimulai.";
            status.classList.add("is-error");
        }
    });
    await security.consumeGoogleCallback(finishGoogleLogin, (error) => {
        const messages = {
            account_link_required: "Email ini sudah memiliki akun NexShop. Masuk dengan password lalu hubungkan Google dari menu akun.",
            cancelled: "Login Google dibatalkan.",
            not_configured: "Login Google belum dikonfigurasi."
        };
        status.textContent = messages[error] || error || "Login Google tidak dapat diselesaikan.";
        status.classList.add("is-error");
    });
}

initPublicLoginSecurity();

form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = document.getElementById("email").value.trim().toLowerCase();
    const password = document.getElementById("password").value;
    status.textContent = "";
    status.classList.remove("is-error");
    button.disabled = true;

    try {
        const captcha_token = window.NexShopAuthSecurity
            ? await window.NexShopAuthSecurity.captchaToken("public-login")
            : "";
        const response = await fetch(`${API_BASE}/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password, captcha_token })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.token) {
            window.NexShopAuthSecurity?.resetCaptcha("public-login");
            throw new Error(data.message || "Login gagal. Coba lagi.");
        }

        window.NexShopAuthSecurity?.resetCaptcha("public-login");
        await finishGoogleLogin(data);
    } catch (error) {
        status.textContent = error.message || "Gagal terhubung ke server.";
        status.classList.add("is-error");
    } finally {
        button.disabled = false;
    }
});
