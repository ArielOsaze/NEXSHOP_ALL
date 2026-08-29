"use strict";

(function () {
    const page = document.body;
    const toggle = document.getElementById("resellerNavToggle");
    const menu = document.getElementById("resellerNavMenu");

    if (toggle && menu) {
        const closeMenu = () => {
            page.classList.remove("rs-menu-is-open");
            toggle.setAttribute("aria-expanded", "false");
            toggle.setAttribute("aria-label", "Buka menu navigasi");
        };

        const openMenu = () => {
            page.classList.add("rs-menu-is-open");
            toggle.setAttribute("aria-expanded", "true");
            toggle.setAttribute("aria-label", "Tutup menu navigasi");
        };

        toggle.addEventListener("click", () => {
            if (page.classList.contains("rs-menu-is-open")) closeMenu();
            else openMenu();
        });

        menu.querySelectorAll("a").forEach((link) => {
            link.addEventListener("click", closeMenu);
        });

        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") closeMenu();
        });

        window.addEventListener("resize", () => {
            if (window.innerWidth > 860) closeMenu();
        });
    }

    document.querySelectorAll('a[href^="#"]').forEach((link) => {
        link.addEventListener("click", (event) => {
            const target = document.getElementById(link.getAttribute("href").slice(1));
            if (!target) return;
            event.preventDefault();
            target.scrollIntoView({
                behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
                block: "start"
            });
            window.history.replaceState(null, "", link.getAttribute("href"));
        });
    });

    document.querySelectorAll(".rs-faq-trigger").forEach((trigger) => {
        trigger.addEventListener("click", () => {
            const panel = document.getElementById(trigger.getAttribute("aria-controls"));
            if (!panel) return;
            const isOpen = trigger.getAttribute("aria-expanded") === "true";
            trigger.setAttribute("aria-expanded", String(!isOpen));
            panel.hidden = isOpen;
        });
    });
})();
