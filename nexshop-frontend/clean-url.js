(function () {
    "use strict";

    const cleanToFile = Object.freeze({
        "/berita": "/berita.html",
        "/marketplace": "/marketplace.html",
        "/reseller": "/reseller.html",
        "/portal-reseller": "/portal-reseller.html",
        "/docs-reseller": "/docs-reseller.html",
        "/login": "/login.html",
        "/admin/login": "/admin/login.html",
        "/admin/dashboard": "/admin/dashboard.html"
    });
    const fileToClean = Object.freeze(
        Object.fromEntries(Object.entries(cleanToFile).map(([clean, file]) => [file, clean]))
    );

    const path = window.location.pathname.replace(/\/$/, "") || "/";
    const cleanPath = fileToClean[path];
    const serverNativeCleanPaths = new Set(["/admin/login", "/admin/dashboard"]);

    // Konfigurasi Nginx lama masih melayani file .html secara langsung. Begitu
    // dokumennya sudah benar, sembunyikan ekstensi tanpa membuat navigation baru
    // agar tombol Back browser tetap bekerja seperti biasa.
    if (cleanPath) {
        window.history.replaceState(window.history.state, "", cleanPath + window.location.search + window.location.hash);
        return;
    }

    // Login/dashboard admin memang dilayani langsung oleh exact location
    // Nginx. Halaman ini sengaja tidak punya canonical SEO karena privat;
    // menebak dari canonical yang kosong akan membuat loop clean URL ↔ .html.
    if (serverNativeCleanPaths.has(path)) return;

    const fallbackFile = cleanToFile[path];
    if (!fallbackFile) return;

    // Pada Nginx baru, clean URL sudah mengirim dokumen dengan canonical yang
    // sama sehingga tidak perlu melakukan apa pun. Jika yang terkirim justru
    // homepage (fallback deployment lama), muat file tujuan satu kali.
    const canonical = document.querySelector('link[rel="canonical"]');
    let canonicalPath = "";
    try {
        canonicalPath = canonical ? new URL(canonical.href, window.location.origin).pathname.replace(/\/$/, "") || "/" : "";
    } catch (_) {
        canonicalPath = "";
    }

    if (canonicalPath !== path) {
        window.location.replace(fallbackFile + window.location.search + window.location.hash);
    }
})();
