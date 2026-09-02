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
        add(".rs-showcase-card", "rs-reveal-card", 80, true);
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
            }, { rootMargin: "0px 0px 8%", threshold: 0.12 });

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

    const initShowcaseStories = () => {
        const cards = [...document.querySelectorAll(".rs-showcase-card[data-showcase-story]")];
        if (!cards.length) return;

        const timers = new WeakMap();
        const write = (card, selector, value) => {
            const element = card.querySelector(selector);
            if (element) element.textContent = value;
        };
        const schedule = (card, callback, delay) => {
            const pending = timers.get(card) || [];
            const timer = window.setTimeout(callback, delay);
            pending.push(timer);
            timers.set(card, pending);
        };
        const repeat = (card, callback, delay) => {
            const pending = timers.get(card) || [];
            const timer = window.setInterval(callback, delay);
            pending.push(timer);
            timers.set(card, pending);
        };
        const stop = (card) => {
            (timers.get(card) || []).forEach((timer) => {
                window.clearTimeout(timer);
                window.clearInterval(timer);
            });
            timers.delete(card);
            delete card.dataset.storyRepeatStarted;
            card.classList.remove("rs-story-in-viewport");
        };
        const finalState = (card) => {
            const story = card.dataset.showcaseStory;
            card.classList.add("rs-story-is-active");
            if (story === "transactions") {
                card.querySelectorAll(".rs-transaction-status b").forEach((status) => { status.textContent = "Berhasil"; });
                write(card, "[data-story-metric]", "125");
            } else if (story === "bills") {
                write(card, "[data-story-status]", "Pembayaran berhasil");
            } else if (story === "catalog") {
                write(card, ".rs-catalog-state", "Berhasil dikirim");
            } else if (story === "pricing") {
                write(card, ".rs-margin-note [data-story-status]", "Margin contoh terhitung");
            } else if (story === "wallet") {
                write(card, ".rs-wallet-status", "Transaksi tersalur");
            } else if (story === "api") {
                write(card, ".rs-api-response", "status: SUCCESS");
            }
        };
        const startRepeatingMotion = (card, story) => {
            if (card.dataset.storyRepeatStarted === "true") return;
            card.dataset.storyRepeatStarted = "true";
            if (story === "transactions") {
                repeat(card, () => {
                    const statuses = [...card.querySelectorAll(".rs-transaction-status b")];
                    const successFirst = card.dataset.storyBeat !== "success-first";
                    statuses.forEach((status, index) => { status.textContent = (successFirst ? index % 2 === 0 : index % 2 !== 0) ? "Berhasil" : "Diproses"; });
                    card.dataset.storyBeat = successFirst ? "success-first" : "success-second";
                }, 3400);
            }
            if (story === "catalog") {
                repeat(card, () => {
                    const state = card.querySelector(".rs-catalog-state");
                    if (state) state.textContent = state.textContent === state.dataset.after ? state.dataset.before : state.dataset.after;
                }, 4200);
            }
            if (story === "wallet") {
                repeat(card, () => {
                    const status = card.querySelector(".rs-wallet-status");
                    if (status) status.textContent = status.textContent === "Transaksi tersalur" ? "Siap disalurkan" : "Transaksi tersalur";
                }, 4200);
            }
        };
        const play = (card) => {
            const story = card.dataset.showcaseStory;
            const alreadyStarted = card.dataset.storyStarted === "true";
            card.classList.add("rs-story-is-active");
            if (alreadyStarted) {
                startRepeatingMotion(card, story);
                return;
            }
            card.dataset.storyStarted = "true";

            if (story === "transactions") {
                schedule(card, () => write(card, ".rs-transaction-status b", "Berhasil"), 700);
                schedule(card, () => write(card, "[data-story-metric]", "125"), 1300);
            }
            if (story === "bills") {
                schedule(card, () => card.querySelector(".rs-bill-result")?.classList.add("is-current"), 550);
            }
            if (story === "catalog") {
                schedule(card, () => write(card, ".rs-catalog-state", "Berhasil dikirim"), 800);
            }
            if (story === "pricing") {
                schedule(card, () => write(card, ".rs-margin-note [data-story-status]", "Margin contoh terhitung"), 850);
            }
            if (story === "wallet") {
                schedule(card, () => write(card, ".rs-wallet-status", "Transaksi tersalur"), 1000);
            }
            if (story === "api") {
                schedule(card, () => write(card, ".rs-api-response", "status: REQUEST"), 450);
                schedule(card, () => write(card, ".rs-api-response", "status: SUCCESS"), 1350);
            }
            startRepeatingMotion(card, story);
        };
        const activate = (card) => {
            card.classList.add("rs-story-in-viewport");
            if (reducedMotion.matches) finalState(card);
            else play(card);
        };

        if (reducedMotion.matches || !supportsObserver) {
            cards.forEach((card) => {
                card.classList.add("rs-story-in-viewport");
                finalState(card);
            });
            return;
        }

        const observer = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) activate(entry.target);
                else stop(entry.target);
            });
        }, { rootMargin: "0px", threshold: 0.08 });
        cards.forEach((card) => observer.observe(card));
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

    const initShowcaseCardTilt = () => {
        if (reducedMotion.matches || !finePointer.matches) return;
        document.querySelectorAll(".rs-showcase-card").forEach((card) => {
            let frame = null;
            let pointer = null;
            const reset = () => {
                if (frame) window.cancelAnimationFrame(frame);
                frame = null;
                pointer = null;
                card.classList.remove("rs-pointer-active");
                card.style.removeProperty("--rs-card-tilt-x");
                card.style.removeProperty("--rs-card-tilt-y");
                card.style.removeProperty("--rs-spotlight-x");
                card.style.removeProperty("--rs-spotlight-y");
            };
            const apply = () => {
                frame = null;
                if (!pointer) return;
                const rect = card.getBoundingClientRect();
                if (!rect.width || !rect.height) return;
                const x = Math.max(0, Math.min(1, (pointer.clientX - rect.left) / rect.width));
                const y = Math.max(0, Math.min(1, (pointer.clientY - rect.top) / rect.height));
                card.style.setProperty("--rs-card-tilt-x", `${((x - .5) * 3.4).toFixed(2)}deg`);
                card.style.setProperty("--rs-card-tilt-y", `${((.5 - y) * 3).toFixed(2)}deg`);
                card.style.setProperty("--rs-spotlight-x", `${(x * 100).toFixed(1)}%`);
                card.style.setProperty("--rs-spotlight-y", `${(y * 100).toFixed(1)}%`);
                card.classList.add("rs-pointer-active");
            };
            card.addEventListener("pointermove", (event) => {
                pointer = event;
                if (!frame) frame = window.requestAnimationFrame(apply);
            });
            card.addEventListener("pointerleave", reset);
        });
    };

    const initFinalCtaMotion = () => {
        const cta = document.querySelector(".rs-final-cta");
        if (!cta) return;
        if (reducedMotion.matches || !supportsObserver) {
            cta.classList.add("rs-cta-in-viewport");
            return;
        }
        const observer = new IntersectionObserver(([entry]) => {
            cta.classList.toggle("rs-cta-in-viewport", entry.isIntersecting);
        }, { threshold: 0.18 });
        observer.observe(cta);
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

    const initHeroCommandCenter = () => {
        const visual = document.querySelector(".rs-hero-visual");
        const flow = document.querySelector(".rs-command-flow");
        const balance = document.querySelector("[data-hero-balance]");
        if (!visual || !flow || !balance || reducedMotion.matches) return;
        const steps = [...flow.querySelectorAll("span")];
        let timer = null;
        let index = 0;
        const stop = () => { if (timer) window.clearInterval(timer); timer = null; visual.classList.remove("rs-command-in-viewport"); };
        const tick = () => {
            steps.forEach((step, stepIndex) => step.classList.toggle("is-current", stepIndex === index));
            balance.textContent = index === 2 ? "Rp1.300.000" : "Rp1.250.000";
            index = (index + 1) % steps.length;
        };
        const start = () => { if (timer) return; visual.classList.add("rs-command-in-viewport"); tick(); timer = window.setInterval(tick, 2200); };
        if (supportsObserver) {
            const observer = new IntersectionObserver(([entry]) => entry.isIntersecting ? start() : stop(), { threshold: 0.2 });
            observer.observe(visual);
        } else start();
    };

    const initUniverseMotion = () => {
        const stage = document.querySelector("[data-universe-stage]");
        const nodes = [...document.querySelectorAll(".rs-universe-node")];
        const routes = stage ? [...stage.querySelectorAll(".rs-universe-route")] : [];
        if (!stage || !nodes.length) return;
        let timer = null;
        let index = 0;
        const stop = () => { if (timer) window.clearInterval(timer); timer = null; stage.classList.remove("rs-universe-in-viewport"); };
        const tick = () => { nodes.forEach((node, nodeIndex) => node.classList.toggle("is-active", nodeIndex === index)); routes.forEach((route, routeIndex) => route.classList.toggle("is-active", routeIndex === index)); index = (index + 1) % nodes.length; };
        const start = () => {
            stage.classList.add("rs-universe-in-viewport");
            if (reducedMotion.matches) { nodes.forEach((node) => node.classList.add("is-active")); return; }
            if (timer) return; tick(); timer = window.setInterval(tick, 1800);
        };
        if (reducedMotion.matches || !supportsObserver) start();
        else { const observer = new IntersectionObserver(([entry]) => entry.isIntersecting ? start() : stop(), { threshold: 0.18 }); observer.observe(stage); }
    };

    const initPartnerSimulator = () => {
        const shell = document.querySelector(".rs-simulator-shell");
        if (!shell) return;
        const product = shell.querySelector("[data-simulator-product]");
        const target = shell.querySelector("[data-simulator-target]");
        const price = shell.querySelector("[data-simulator-price]");
        const status = shell.querySelector("[data-simulator-status]");
        const icon = shell.querySelector(".rs-simulator-icon i");
        const data = {
            "Pulsa": { product: "Pulsa Telkomsel 50.000", target: "Tujuan: 08••••••21", price: "Rp50.850", icon: "fa-mobile-screen-button" },
            "PLN": { product: "Token PLN 100.000", target: "Meter: 5123••••890", price: "Rp101.200", icon: "fa-plug" },
            "E-wallet": { product: "DANA Top Up 100.000", target: "Tujuan: 08••••••21", price: "Rp99.500", icon: "fa-wallet" },
            "Game": { product: "ML Diamond 86", target: "User ID: 1234••••", price: "Rp21.340", icon: "fa-gamepad" }
        };
        let pending = null;
        const setCategory = (category) => {
            const item = data[category] || data.Pulsa;
            shell.querySelectorAll("[data-simulator-category]").forEach((button) => {
                const active = button.dataset.simulatorCategory === category;
                button.classList.toggle("is-active", active);
                button.setAttribute("aria-selected", String(active));
            });
            product.textContent = item.product;
            target.textContent = item.target;
            price.textContent = item.price;
            if (icon) icon.className = `fa-solid ${item.icon}`;
            status.innerHTML = '<i class="fa-solid fa-spinner" aria-hidden="true"></i> Mengirim contoh transaksi';
            shell.classList.add("is-processing");
            if (pending) window.clearTimeout(pending);
            pending = window.setTimeout(() => { status.innerHTML = '<i class="fa-solid fa-circle-check" aria-hidden="true"></i> Transaksi berhasil'; shell.classList.remove("is-processing"); }, reducedMotion.matches ? 0 : 650);
        };
        shell.querySelectorAll("[data-simulator-category]").forEach((button) => button.addEventListener("click", () => setCategory(button.dataset.simulatorCategory)));
    };

    initMotion();
    initShowcaseStories();
    initHeroCommandCenter();
    initUniverseMotion();
    initPartnerSimulator();
    initHeroTilt();
    initShowcaseCardTilt();
    initFinalCtaMotion();
    initMenu();
    initAnchors();
    initFaq();
})();
