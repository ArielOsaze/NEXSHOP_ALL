(() => {
    // Terapkan tema SEBELUM halaman dirender, biar gak ada kedipan putih.
    function apply(theme, isAdmin) {
        document.documentElement.dataset.theme = theme;
        document.documentElement.setAttribute("data-theme", theme);
        if (theme === "dark") document.documentElement.classList.add("dark");
        else document.documentElement.classList.remove("dark");

        // Dashboard admin dibangun di atas Bootstrap 5.3. Tanpa atribut
        // data-bs-theme, Bootstrap tetap nganggep halamannya mode terang --
        // jadi semua utility bawaannya (bg-light, table-light, *-subtle,
        // form-control, dropdown, modal, offcanvas) tetap ngerender warna
        // terang di atas panel gelap. Itu yang bikin bar aksi massal dan
        // header tabel nongol sebagai balok putih yang nabrak tema.
        if (isAdmin) document.documentElement.setAttribute("data-bs-theme", theme);
    }

    function readCookie(name) {
        const prefix = `${encodeURIComponent(name)}=`;
        const match = document.cookie.split("; ").find((item) => item.startsWith(prefix));
        return match ? decodeURIComponent(match.slice(prefix.length)) : null;
    }

    try {
        const path = (location && location.pathname) ? location.pathname : "";
        const isAdmin = path.includes("/admin/") || path.startsWith("/admin");
        const key = isAdmin ? "nexshop-admin-theme" : "nexshop-public-theme";
        const storedTheme = localStorage.getItem(key);
        const cookieTheme = !isAdmin ? readCookie("nexshop_user_theme") : null;
        const theme = (storedTheme || cookieTheme) === "light" ? "light" : "dark";
        apply(theme, isAdmin);
    } catch {
        apply("dark", true);
    }
})();
