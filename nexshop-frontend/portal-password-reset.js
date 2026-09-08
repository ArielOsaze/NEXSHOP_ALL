(() => {
    "use strict";

    const API_BASE = `${window.location.origin}/api`;
    const REQUEST_TIMEOUT_MS = 15000;
    let forgotCaptchaMounted = false;

    function byId(id) {
        return document.getElementById(id);
    }

    function setHidden(id, hidden) {
        const element = byId(id);
        if (element) element.hidden = hidden;
    }

    function setMessage(id, message, state = "") {
        const element = byId(id);
        if (!element) return;
        element.textContent = message || "";
        if (state) element.dataset.state = state;
        else delete element.dataset.state;
    }

    function setAuthChrome(hidden) {
        document.querySelectorAll(".tv-auth-tabs, .tv-auth-separation-note").forEach((element) => {
            element.hidden = hidden;
        });
        setHidden("authPaneRegister", hidden);
        setHidden("portalTwoFactorChallenge", true);
    }

    function showLoginPane() {
        setAuthChrome(false);
        setHidden("authPaneLogin", false);
        setHidden("portalForgotPasswordPane", true);
        setHidden("portalResetPasswordPane", true);
        const email = byId("portalForgotEmail")?.value.trim();
        if (email && byId("loginEmail")) byId("loginEmail").value = email;
        byId("loginEmail")?.focus();
    }

    function showForgotPane() {
        setAuthChrome(true);
        setHidden("authPaneLogin", true);
        setHidden("portalForgotPasswordPane", false);
        setHidden("portalResetPasswordPane", true);
        setMessage("portalForgotPasswordMessage", "");
        byId("portalForgotEmail")?.focus();
        if (!forgotCaptchaMounted && window.NexShopAuthSecurity?.mountCaptcha) {
            forgotCaptchaMounted = true;
            window.NexShopAuthSecurity.mountCaptcha(
                "reseller-forgot",
                "resellerForgotTurnstile",
                "resellerForgotTurnstileStatus"
            ).catch(() => {});
        }
    }

    function showResetPane() {
        setAuthChrome(true);
        setHidden("authPaneLogin", true);
        setHidden("portalForgotPasswordPane", true);
        setHidden("portalResetPasswordPane", false);
        byId("portalResetPassword")?.focus();
    }

    async function portalRequest(path, body) {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
            const response = await fetch(`${API_BASE}${path}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
                signal: controller.signal
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.message || "Permintaan belum dapat diproses.");
            return data;
        } catch (error) {
            if (error?.name === "AbortError") throw new Error("Server NexShop belum merespons. Coba lagi.");
            throw error;
        } finally {
            window.clearTimeout(timeoutId);
        }
    }

    async function submitForgotPassword(event) {
        event.preventDefault();
        const button = byId("btnPortalForgotPasswordSubmit");
        const email = byId("portalForgotEmail")?.value.trim().toLowerCase() || "";
        if (!email) return;
        button.disabled = true;
        setMessage("portalForgotPasswordMessage", "Mengirim link reset ke WhatsApp…");
        try {
            const security = window.NexShopAuthSecurity;
            if (!security?.captchaToken) throw new Error("Verifikasi keamanan belum siap. Muat ulang halaman lalu coba lagi.");
            const captchaToken = await security.captchaToken("reseller-forgot");
            const data = await portalRequest("/reseller/auth/forgot-password", {
                email,
                captcha_token: captchaToken || ""
            });
            setMessage("portalForgotPasswordMessage", data.message || "Jika data terdaftar, link reset dikirim ke WhatsApp.", "success");
            window.NexShopAuthSecurity?.resetCaptcha("reseller-forgot");
        } catch (error) {
            setMessage("portalForgotPasswordMessage", error.message || "Permintaan reset belum dapat diproses.", "error");
        } finally {
            button.disabled = false;
        }
    }

    async function submitResetPassword(event) {
        event.preventDefault();
        const button = byId("btnPortalResetPasswordSubmit");
        const password = byId("portalResetPassword")?.value || "";
        const confirmation = byId("portalResetPasswordConfirm")?.value || "";
        const token = new URLSearchParams(window.location.search).get("token") || "";
        if (password !== confirmation) {
            setMessage("portalResetPasswordMessage", "Konfirmasi password belum sama.", "error");
            return;
        }
        if (!token) {
            setMessage("portalResetPasswordMessage", "Link reset tidak memiliki token yang valid.", "error");
            return;
        }
        button.disabled = true;
        setMessage("portalResetPasswordMessage", "Menyimpan password baru…");
        try {
            const data = await portalRequest("/reseller/auth/reset-password", { token, newPassword: password });
            setMessage("portalResetPasswordMessage", data.message || "Password berhasil diganti.", "success");
            window.history.replaceState({}, document.title, `${window.location.pathname}?mode=login`);
            window.setTimeout(showLoginPane, 900);
        } catch (error) {
            setMessage("portalResetPasswordMessage", error.message || "Password belum dapat diganti.", "error");
        } finally {
            button.disabled = false;
        }
    }

    function init() {
        byId("btnPortalForgotPassword")?.addEventListener("click", showForgotPane);
        byId("btnPortalForgotPasswordBack")?.addEventListener("click", showLoginPane);
        byId("btnPortalResetPasswordBack")?.addEventListener("click", showLoginPane);
        byId("formPortalForgotPassword")?.addEventListener("submit", submitForgotPassword);
        byId("formPortalResetPassword")?.addEventListener("submit", submitResetPassword);
        const token = new URLSearchParams(window.location.search).get("token");
        if (token) showResetPane();
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
    else init();
})();
