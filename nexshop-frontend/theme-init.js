(() => {
    try {
        const path = (location && location.pathname) ? location.pathname : "";
        const isAdmin = path.includes("/admin/") || path.startsWith("/admin");
        const key = isAdmin ? "nexshop-admin-theme" : "nexshop-public-theme";
        document.documentElement.dataset.theme = localStorage.getItem(key) === "light" ? "light" : "dark";
    } catch {
        document.documentElement.dataset.theme = "dark";
    }
})();
