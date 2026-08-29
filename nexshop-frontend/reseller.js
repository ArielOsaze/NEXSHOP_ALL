"use strict";

(function () {
    const page = document.body;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const supportsObserver = "IntersectionObserver" in window;

    const add = (selector, className, delay = 0, stagger = false) => {
        document.querySelectorAll(selector).forEach((element, index) => {
            element.classList.add(className, "rs-reveal");
            if (stagger) element.classList.add("rs-stagger");
            element.style.setProperty("--rs-reveal-delay", `${delay + (stagger ? index * 70 : 0)}ms`);
        });
    };

    const show = (element) => {
        element.classList.add("rs-is-visible");
    };

    const revealAll = () => {
        document.querySelectorAll(".rs-reveal").forEach(show);
    };

    const initMotion = () => {
        page.classList.add("rs-motion-ready");

        add(".rs-brand", "rs-reveal-brand", 0);
        add(".rs-nav-panel", "rs-reveal-nav", 70);
        add(".rs-hero .rs-eyebrow", "rs-reveal-hero", 130);
        add(".rs-hero h1", "rs-reveal-hero", 210);
        add(".rs-hero-lead", "rs-reveal-hero", 290);
        add(".rs-hero-actions", "rs-reveal-hero", 370);
        add(".rs-hero-note", "rs-reveal-hero", 450);
        add(".rs-hero-visual", "rs-reveal-visual", 250);

        add(".rs-section-heading", "rs-reveal-heading", 0);
        add(".rs-feature-card", "rs-reveal-card", 80, true);
        add(".rs-tier-card", "rs-reveal-card", 90, true);
        add(".rs-caption", "rs-reveal-caption", 160);
        add(".rs-step", "rs-reveal-step", 90, true);
        add(".rs-api-copy", "rs-reveal-api", 0);
        add(".rs-code-card", "rs-reveal-code", 130);
        add(".rs-faq-layout", "rs-reveal-faq", 0);
        add(".rs-final-cta-inner", "rs-reveal-cta", 0);

        if (reducedMotion.matches || !supportsObserver) {
            revealAll();
        } else {
            const observer = new IntersectionObserver((entries, currentObserver) => {
                entries.forEach((entry) => {
                    if (!entry.isIntersecting) return;
                    show(entry.target);
                    entry.target.classList.add("rs-motion-seen");
                    currentObserver.unobserve(entry.target);
                });
            }, { rootMargin: "0px 0px -10%", threshold: 0.12 });

            document.querySelectorAll(".rs-reveal").forEach((element) => observer.observe(element));
        }

        if (!reducedMotion.matches) {
            window.setTimeout(() => {
                document.querySelector(".rs-steps-grid")?.classList.add("rs-steps-progress");
            }, 180);
        } else {
            document.querySelector(".rs-steps-grid")?.classList.add("rs-steps-progress");
        }
    };

    const initHeroTilt = () => {
        const visual = document.querySelector(".rs-hero-visual");
        if (!visual || reducedMotion.matches || !finePointer.matches) return;

        const reset = () => {
            visual.style.setProperty("--rs-tilt-x", "0deg");
            visual.style.setProperty("--rs-tilt-y", "0deg");
        };

        visual.addEventListener("pointermove", (event) => {
            const rect = visual.getBoundingClientRect();
            const x = (event.clientX - rect.left) / rect.width - 0.5;
            const y = (event.clientY - rect.top) / rect.height - 0.5;
            visual.style.setProperty("--rs-tilt-x", `${(x * 2.2).toFixed(2)}deg`);
            visual.style.setProperty("--rs-tilt-y", `${(-y * 1.8).toFixed(2)}deg`);
        });
        visual.addEventListener("pointerleave", reset);
    };

    const initMenu = () => {
        const toggle = document.getElementById("resellerNavToggle");
        const menu = document.getElementById("resellerNavMenu");
        if (!toggle || !menu) return;

        let lastFocused = null;
        const closeMenu = () => {
            page.classList.remove("rs-menu-is-open");
            toggle.setAttribute("aria-expanded", "false");
            toggle.setAttribute("aria-label", "Buka menu navigasi");
            if (lastFocused) lastFocused.focus();
        };
        const openMenu = () => {
            lastFocused = document.activeElement;
            page.classList.add("rs-menu-is-open");
            toggle.setAttribute("aria-expanded", "true");
            toggle.setAttribute("aria-label", "Tutup menu navigasi");
            menu.querySelector("a")?.focus();
        };

        toggle.addEventListener("click", () => {
            if (page.classList.contains("rs-menu-is-open")) closeMenu();
            else openMenu();
        });
        menu.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMenu));
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && page.classList.contains("rs-menu-is-open")) closeMenu();
        });
        window.addEventListener("resize", () => {
            if (window.innerWidth > 860 && page.classList.contains("rs-menu-is-open")) closeMenu();
        });
    };

    const initAnchors = () => {
        document.querySelectorAll('a[href^="#"]').forEach((link) => {
            link.addEventListener("click", (event) => {
                const target = document.getElementById(link.getAttribute("href").slice(1));
                if (!target) return;
                event.preventDefault();
                target.scrollIntoView({
                    behavior: reducedMotion.matches ? "auto" : "smooth",
                    block: "start"
                });
                window.history.replaceState(null, "", link.getAttribute("href"));
            });
        });
    };

    const initFaq = () => {
        const activePanels = new WeakMap();
        document.querySelectorAll(".rs-faq-trigger").forEach((trigger) => {
            trigger.addEventListener("click", () => {
                const panel = document.getElementById(trigger.getAttribute("aria-controls"));
                if (!panel) return;
                const isOpen = trigger.getAttribute("aria-expanded") === "true";
                const previous = activePanels.get(panel);
                if (previous) previous();

                trigger.setAttribute("aria-expanded", String(!isOpen));
                if (reducedMotion.matches) {
                    panel.hidden = isOpen;
                    panel.classList.toggle("rs-faq-panel-open", !isOpen);
                    return;
                }

                if (!isOpen) {
                    panel.hidden = false;
                    panel.classList.add("rs-faq-panel-open");
                    panel.style.maxHeight = "0px";
                    const frame = window.requestAnimationFrame(() => {
                        panel.style.maxHeight = `${panel.scrollHeight}px`;
                    });
                    activePanels.set(panel, () => {
                        window.cancelAnimationFrame(frame);
                        panel.style.maxHeight = "";
                    });
                } else {
                    panel.hidden = false;
                    panel.style.maxHeight = `${panel.scrollHeight}px`;
                    panel.classList.remove("rs-faq-panel-open");
                    const frame = window.requestAnimationFrame(() => {
                        panel.style.maxHeight = "0px";
                    });
                    const finish = () => {
                        panel.hidden = true;
                        panel.style.maxHeight = "";
                        panel.removeEventListener("transitionend", finish);
                        activePanels.delete(panel);
                    };
                    panel.addEventListener("transitionend", finish, { once: true });
                    activePanels.set(panel, () => {
                        window.cancelAnimationFrame(frame);
                        panel.removeEventListener("transitionend", finish);
                        panel.hidden = true;
                        panel.style.maxHeight = "";
                    });
                }
            });
        });
    };

    initMotion();
    initHeroTilt();
    initMenu();
    initAnchors();
    initFaq();
})();
