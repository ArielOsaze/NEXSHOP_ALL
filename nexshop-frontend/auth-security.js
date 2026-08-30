/* Shared authentication security UI for NexShop's static pages.
 * Turnstile site keys are public by design; verification remains server-side.
 */
(function () {
    "use strict";

    const API_BASE = "/api";
    const AUTH_REQUEST_TIMEOUT_MS = 10000;
    const TURNSTILE_LOAD_TIMEOUT_MS = 12000;
    const widgets = new Map();
    let configPromise;
    let scriptPromise;

    function fetchWithTimeout(url, options = {}, timeoutMs = AUTH_REQUEST_TIMEOUT_MS) {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
        return fetch(url, { ...options, signal: controller.signal }).finally(() => window.clearTimeout(timeoutId));
    }

    async function getConfig() {
        if (!configPromise) {
            configPromise = fetchWithTimeout(`${API_BASE}/auth/public-config`, { credentials: "same-origin" })
                .then((response) => response.ok ? response.json() : { __unavailable: true })
                .catch(() => ({ __unavailable: true }));
        }
        return configPromise;
    }

    function loadTurnstile() {
        if (window.turnstile) return Promise.resolve(window.turnstile);
        if (!scriptPromise) {
            scriptPromise = new Promise((resolve, reject) => {
                const script = document.createElement("script");
                let timeoutId;
                const finish = (error, value) => {
                    window.clearTimeout(timeoutId);
                    script.removeEventListener("load", onLoad);
                    script.removeEventListener("error", onError);
                    if (error) {
                        scriptPromise = null;
                        reject(error);
                    } else {
                        resolve(value);
                    }
                };
                const onLoad = () => window.turnstile
                    ? finish(null, window.turnstile)
                    : finish(new Error("Turnstile tidak tersedia"));
                const onError = () => finish(new Error("Gagal memuat verifikasi keamanan"));
                script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
                script.async = true;
                script.addEventListener("load", onLoad, { once: true });
                script.addEventListener("error", onError, { once: true });
                timeoutId = window.setTimeout(() => finish(new Error("Gagal memuat verifikasi keamanan dalam batas waktu")), TURNSTILE_LOAD_TIMEOUT_MS);
                document.head.append(script);
            });
        }
        return scriptPromise;
    }

    function setStatus(statusEl, message) {
        if (!statusEl) return;
        statusEl.textContent = message || "";
        statusEl.classList.toggle("hidden", !message);
    }

    async function mountCaptcha(name, containerId, statusId, { allowUnconfigured = false } = {}) {
        const container = document.getElementById(containerId);
        const status = document.getElementById(statusId);
        if (!container) return;
        const config = await getConfig();
        if (config.__unavailable) {
            container.hidden = true;
            setStatus(status, "Verifikasi keamanan tidak dapat terhubung. Muat ulang halaman lalu coba lagi.");
            widgets.set(name, { widgetId: null, token: "", configured: false, unavailable: true, status });
            return;
        }
        if (!config.turnstile_site_key) {
            container.hidden = true;
            if (config.turnstile_required && !allowUnconfigured) setStatus(status, "Verifikasi keamanan belum tersedia. Coba lagi nanti.");
            return;
        }
        container.hidden = false;
        try {
            const turnstile = await loadTurnstile();
            const widgetId = turnstile.render(container, {
                sitekey: config.turnstile_site_key,
                theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
                callback: (token) => {
                    const state = widgets.get(name);
                    if (state) state.token = token;
                    setStatus(status, "");
                },
                "expired-callback": () => {
                    const state = widgets.get(name);
                    if (state) state.token = "";
                    setStatus(status, "Verifikasi kedaluwarsa. Silakan ulangi.");
                },
                "error-callback": () => setStatus(status, "Verifikasi keamanan tidak dapat dimuat. Coba lagi."),
                "timeout-callback": () => setStatus(status, "Verifikasi keamanan habis waktu. Silakan ulangi.")
            });
            widgets.set(name, { widgetId, token: "", turnstile, configured: true, status });
        } catch (error) {
            setStatus(status, "Verifikasi keamanan tidak dapat dimuat. Coba lagi.");
            widgets.set(name, { widgetId: null, token: "", configured: true, status });
        }
    }

    async function captchaToken(name, { allowUnconfigured = false } = {}) {
        const config = await getConfig();
        if (config.__unavailable) throw new Error("Verifikasi keamanan tidak dapat terhubung. Muat ulang halaman lalu coba lagi.");
        if (!config.turnstile_site_key) {
            if (config.turnstile_required && !allowUnconfigured) throw new Error("Verifikasi keamanan belum tersedia. Coba lagi nanti.");
            return "";
        }
        const state = widgets.get(name);
        if (!state || !state.token) throw new Error("Selesaikan verifikasi keamanan terlebih dahulu.");
        return state.token;
    }

    function resetCaptcha(name) {
        const state = widgets.get(name);
        if (!state) return;
        state.token = "";
        if (state.widgetId !== null && state.turnstile) state.turnstile.reset(state.widgetId);
    }

    async function beginGoogle(mode, token) {
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const response = await fetch(`${API_BASE}/auth/google/${mode === "link" ? "link/" : ""}start?return_to=${encodeURIComponent(window.location.pathname + window.location.search)}`, { headers });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.url) throw new Error(data.message || "Login Google belum dapat dimulai.");
        window.location.assign(data.url);
    }

    async function consumeGoogleCallback(onSuccess, onError) {
        const params = new URLSearchParams(window.location.search);
        const error = params.get("oauth_error");
        const code = params.get("code");
        const mode = params.get("oauth");
        if (!error && (!code || !mode)) return;

        params.delete("oauth_error");
        params.delete("code");
        params.delete("oauth");
        const cleanUrl = `${window.location.pathname}${params.size ? `?${params}` : ""}${window.location.hash}`;
        history.replaceState(null, "", cleanUrl);

        if (error) {
            onError?.(error);
            return;
        }
        try {
            const response = await fetch(`${API_BASE}/auth/google/exchange`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data.token) throw new Error(data.message || "Login Google tidak dapat diselesaikan.");
            onSuccess?.(data, mode);
        } catch (exchangeError) {
            onError?.(exchangeError.message || "Login Google tidak dapat diselesaikan.");
        }
    }

    window.NexShopAuthSecurity = { mountCaptcha, captchaToken, resetCaptcha, beginGoogle, consumeGoogleCallback };
})();
