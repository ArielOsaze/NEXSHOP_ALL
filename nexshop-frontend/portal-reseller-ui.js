"use strict";

(function () {
    const init = () => {
        const shell = document.getElementById("sectionDashboard");
        const sidebar = document.getElementById("tvSidebar");
        const menuButton = document.querySelector(".tv-mobile-menu-button");
        const sidebarToggle = document.querySelector(".tv-sidebar-toggle");
        const scrim = document.querySelector(".tv-sidebar-scrim");
        const pageTitle = document.getElementById("tvPageTitle");
        const pageSubtitle = document.getElementById("tvPageSubtitle");
        const moreButton = document.querySelector(".tv-nav-more");
        const secondaryNav = document.getElementById("tvNavSecondary");
        const views = {
            "view-dashboard": ["Dashboard", "Ringkasan performa, saldo, dan aktivitas terbaru akun reseller."],
            "view-products": ["Katalog produk", "Temukan produk digital dan harga modal sesuai tingkatan akunmu."],
            "view-deposit": ["Deposit saldo", "Isi saldo modal reseller melalui metode pembayaran yang tersedia."],
            "view-mutations": ["Mutasi saldo", "Tinjau seluruh pergerakan saldo masuk dan keluar secara terstruktur."],
            "view-transactions": ["Transaksi", "Pantau pesanan API dan status pemrosesannya dari satu tempat."],
            "view-settings": ["Pengaturan akun", "Kelola profil portal dan lapisan keamanan akun reseller."],
            "view-api": ["Integrasi API", "Atur kredensial, IP whitelist, dan webhook relay dengan aman."],
            "view-tiers": ["Tingkatan reseller", "Lihat tingkatan dan potongan yang diterapkan pada katalog akunmu."]
        };

        const syncDrawer = () => {
            if (!shell || !sidebar) return;
            const open = sidebar.classList.contains("open");
            shell.classList.toggle("portal-drawer-open", open);
            if (menuButton) {
                menuButton.setAttribute("aria-expanded", String(open));
                menuButton.setAttribute("aria-controls", "tvSidebar");
                menuButton.setAttribute("aria-label", open ? "Tutup menu portal reseller" : "Buka menu portal reseller");
            }
            if (sidebarToggle) {
                sidebarToggle.setAttribute("aria-expanded", String(open));
                sidebarToggle.setAttribute("aria-controls", "tvSidebar");
            }
            if (scrim) scrim.setAttribute("aria-hidden", String(!open));
            if (open && window.innerWidth <= 992 && document.activeElement === menuButton) {
                sidebar.querySelector(".tv-nav-link")?.focus();
            }
        };

        const syncSecondaryNav = () => {
            if (!moreButton || !secondaryNav) return;
            const open = secondaryNav.classList.contains("is-open");
            moreButton.setAttribute("aria-expanded", String(open));
            if (window.innerWidth <= 992 && secondaryNav.querySelector(".tv-nav-link.active")) {
                secondaryNav.classList.add("is-open");
                moreButton.setAttribute("aria-expanded", "true");
            }
        };

        if (moreButton && secondaryNav) {
            moreButton.addEventListener("click", () => {
                const open = secondaryNav.classList.toggle("is-open");
                moreButton.setAttribute("aria-expanded", String(open));
            });
        }

        const closeDrawer = (restoreFocus = true) => {
            if (!sidebar) return;
            const wasOpen = sidebar.classList.contains("open");
            sidebar.classList.remove("open");
            syncDrawer();
            if (restoreFocus && wasOpen && menuButton) menuButton.focus();
        };

        if (sidebar) {
            sidebar.setAttribute("aria-label", "Navigasi Partner Portal Reseller");
            new MutationObserver(syncDrawer).observe(sidebar, { attributes: true, attributeFilter: ["class"] });
        }
        if (scrim) scrim.addEventListener("click", () => closeDrawer(false));
        document.addEventListener("keydown", (event) => {
            if (event.key !== "Escape" || !sidebar?.classList.contains("open")) return;
            closeDrawer();
        });
        document.querySelectorAll(".tv-nav-link").forEach((link) => {
            link.addEventListener("click", () => {
                window.requestAnimationFrame(() => {
                    syncDrawer();
                    updatePageChrome();
                    if (window.innerWidth <= 992) closeDrawer(false);
                });
            });
        });

        const updatePageChrome = () => {
            if (!pageTitle || !pageSubtitle) return;
            const active = document.querySelector(".tv-nav-link.active");
            const viewId = active?.dataset.view || "view-dashboard";
            const copy = views[viewId] || views["view-dashboard"];
            pageTitle.textContent = copy[0];
            pageSubtitle.textContent = copy[1];
            syncSecondaryNav();
        };

        const activeNavObserver = new MutationObserver(updatePageChrome);
        document.querySelectorAll(".tv-nav-link").forEach((link) => {
            activeNavObserver.observe(link, { attributes: true, attributeFilter: ["class"] });
        });

        syncDrawer();
        updatePageChrome();
    };

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
    else init();
})();
