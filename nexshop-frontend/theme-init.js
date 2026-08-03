(() => {
    try {
        document.documentElement.dataset.theme = localStorage.getItem("nexshop_theme") === "light" ? "light" : "dark";
    } catch {
        document.documentElement.dataset.theme = "dark";
    }
})();
