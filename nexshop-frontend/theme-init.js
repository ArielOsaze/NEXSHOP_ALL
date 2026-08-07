(() => {
    try {
        const path = (location && location.pathname) ? location.pathname : "";
        const isAdmin = path.includes("/admin/") || path.startsWith("/admin");
        const key = isAdmin ? "nexshop-admin-theme" : "nexshop-public-theme";
        const theme = localStorage.getItem(key) === "light" ? "light" : "dark";
        document.documentElement.dataset.theme = theme;
        document.documentElement.setAttribute("data-theme", theme);
        if (theme === "dark") document.documentElement.classList.add("dark");
        else document.documentElement.classList.remove("dark");
    } catch {
        document.documentElement.dataset.theme = "dark";
        document.documentElement.setAttribute("data-theme", "dark");
        document.documentElement.classList.add("dark");
    }
})();
