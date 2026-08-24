(function () {
    "use strict";

    const CONSENT_COOKIE = "nexshop_cookie_consent";
    const CONSENT_STORAGE = "nexshop_cookie_consent";
    const THEME_COOKIE = "nexshop_user_theme";
    const CONSENT_ALL = "v1.all";
    const CONSENT_ESSENTIAL = "v1.essential";
    const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

    function readCookie(name) {
        const prefix = `${encodeURIComponent(name)}=`;
        const part = document.cookie.split("; ").find((item) => item.startsWith(prefix));
        return part ? decodeURIComponent(part.slice(prefix.length)) : null;
    }

    function writeCookie(name, value, maxAge) {
        const secure = location.protocol === "https:" ? "; Secure" : "";
        document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
    }

    function deleteCookie(name) {
        writeCookie(name, "", 0);
    }

    function getConsent() {
        const cookieValue = readCookie(CONSENT_COOKIE);
        if (cookieValue === CONSENT_ALL || cookieValue === CONSENT_ESSENTIAL) return cookieValue;

        // Beberapa browser/webview memblokir cookie persisten walau localStorage
        // tetap tersedia. Simpan pilihan esensial ini di kedua tempat agar banner
        // tidak muncul ulang di setiap halaman.
        try {
            const storedValue = localStorage.getItem(CONSENT_STORAGE);
            if (storedValue === CONSENT_ALL || storedValue === CONSENT_ESSENTIAL) {
                writeCookie(CONSENT_COOKIE, storedValue, ONE_YEAR_SECONDS);
                return storedValue;
            }
        } catch {
            // Tetap gunakan cookie jika storage browser diblokir.
        }
        return null;
    }

    function saveConsent(value) {
        writeCookie(CONSENT_COOKIE, value, ONE_YEAR_SECONDS);
        try {
            localStorage.setItem(CONSENT_STORAGE, value);
        } catch {
            // Cookie sudah cukup pada browser yang memblokir storage.
        }
    }

    function preferencesAllowed() {
        return getConsent() === CONSENT_ALL;
    }

    function syncThemePreference() {
        if (!preferencesAllowed()) {
            deleteCookie(THEME_COOKIE);
            try {
                localStorage.removeItem("nexshop-public-theme");
            } catch {
                // Cookie tetap bisa dikelola walau storage browser diblokir.
            }
            return;
        }
        const theme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
        writeCookie(THEME_COOKIE, theme, ONE_YEAR_SECONDS);
    }

    function addStyles() {
        if (document.getElementById("nexshopCookieStyles")) return;
        const style = document.createElement("style");
        style.id = "nexshopCookieStyles";
        style.textContent = `
            .nexshop-cookie-banner{position:fixed;z-index:100000;left:50%;bottom:18px;transform:translateX(-50%);width:min(620px,calc(100% - 28px));box-sizing:border-box;padding:18px;border:1px solid rgba(0,194,232,.28);border-radius:18px;background:rgba(7,12,24,.96);box-shadow:0 24px 70px rgba(0,0,0,.48);color:#f8fafc;font-family:Inter,"Plus Jakarta Sans",system-ui,sans-serif;backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}
            .nexshop-cookie-banner[hidden]{display:none!important}.nexshop-cookie-banner h2{margin:0 0 6px;font-size:1rem;line-height:1.4;color:#fff}.nexshop-cookie-banner p{margin:0;color:#a7b1c2;font-size:.82rem;line-height:1.6}.nexshop-cookie-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:15px;flex-wrap:wrap}.nexshop-cookie-button{appearance:none;border:1px solid rgba(255,255,255,.16);border-radius:10px;padding:9px 14px;background:rgba(255,255,255,.06);color:#e5e7eb;font:700 .78rem/1 Inter,"Plus Jakarta Sans",system-ui,sans-serif;cursor:pointer}.nexshop-cookie-button:hover,.nexshop-cookie-button:focus-visible{border-color:#00c2e8;outline:none}.nexshop-cookie-button--primary{border-color:#00c2e8;background:#00c2e8;color:#041018}@media(max-width:520px){.nexshop-cookie-banner{bottom:10px;padding:16px}.nexshop-cookie-actions{display:grid;grid-template-columns:1fr}.nexshop-cookie-button{min-height:40px}}
        `;
        document.head.appendChild(style);
    }

    function buildUi() {
        addStyles();

        const banner = document.createElement("section");
        banner.className = "nexshop-cookie-banner";
        banner.setAttribute("role", "dialog");
        banner.setAttribute("aria-modal", "false");
        banner.setAttribute("aria-labelledby", "nexshopCookieTitle");
        banner.setAttribute("aria-describedby", "nexshopCookieDescription");
        banner.innerHTML = `
            <h2 id="nexshopCookieTitle">Pilihan cookie kamu</h2>
            <p id="nexshopCookieDescription">NexShop memakai cookie esensial agar situs berfungsi. Dengan izinmu, cookie preferensi juga mengingat tema tampilan. Saat ini kami tidak memasang cookie analitik atau iklan.</p>
            <div class="nexshop-cookie-actions">
                <button type="button" class="nexshop-cookie-button" data-cookie-choice="essential">Hanya Esensial</button>
                <button type="button" class="nexshop-cookie-button nexshop-cookie-button--primary" data-cookie-choice="all">Terima Semua</button>
            </div>
        `;

        function showBanner() {
            banner.hidden = false;
            banner.querySelector("[data-cookie-choice='all']").focus({ preventScroll: true });
        }

        function hideBanner() {
            banner.hidden = true;
        }

        banner.addEventListener("click", (event) => {
            const choice = event.target.closest("[data-cookie-choice]")?.dataset.cookieChoice;
            if (!choice) return;
            saveConsent(choice === "all" ? CONSENT_ALL : CONSENT_ESSENTIAL);
            document.documentElement.dataset.cookieConsent = choice;
            syncThemePreference();
            hideBanner();
        });
        document.body.append(banner);
        if (getConsent()) hideBanner();
        else showBanner();

        return { showBanner };
    }

    function initialize() {
        const current = getConsent();
        document.documentElement.dataset.cookieConsent = current === CONSENT_ALL ? "all" : current === CONSENT_ESSENTIAL ? "essential" : "unset";
        const ui = buildUi();

        const observer = new MutationObserver((mutations) => {
            if (mutations.some((mutation) => mutation.attributeName === "data-theme")) syncThemePreference();
        });
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
        if (current) syncThemePreference();

        window.NexShopCookies = Object.freeze({
            getConsent,
            open: ui.showBanner,
            preferencesAllowed,
            reset: function () {
                deleteCookie(CONSENT_COOKIE);
                deleteCookie(THEME_COOKIE);
                try {
                    localStorage.removeItem(CONSENT_STORAGE);
                } catch {
                    // Tidak ada yang perlu dilakukan jika storage diblokir.
                }
                document.documentElement.dataset.cookieConsent = "unset";
                ui.showBanner();
            }
        });
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
    else initialize();
})();
