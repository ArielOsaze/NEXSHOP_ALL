const API_BASE = (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
    ? (window.location.port === "3000" ? "/api" : "http://localhost:3000/api")
    : "/api";
const PUBLIC_TOKEN_STORAGE_KEY = "nexshop-public-token";

const form = document.getElementById("loginForm");
const status = document.getElementById("loginStatus");
const button = document.getElementById("loginButton");

form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = document.getElementById("email").value.trim().toLowerCase();
    const password = document.getElementById("password").value;
    status.textContent = "";
    status.classList.remove("is-error");
    button.disabled = true;

    try {
        const response = await fetch(`${API_BASE}/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.token) {
            throw new Error(data.message || "Login gagal. Coba lagi.");
        }

        localStorage.setItem(PUBLIC_TOKEN_STORAGE_KEY, data.token);
        localStorage.setItem("nexshop_user", JSON.stringify(data.user));
        window.location.assign("index.html");
    } catch (error) {
        status.textContent = error.message || "Gagal terhubung ke server.";
        status.classList.add("is-error");
    } finally {
        button.disabled = false;
    }
});
