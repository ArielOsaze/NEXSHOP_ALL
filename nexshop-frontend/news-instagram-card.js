"use strict";

(() => {
    const BUTTON_ID = "instagramShareCardBtn";
    const FEEDBACK_ID = "instagramShareFeedback";
    const CARD_WIDTH = 1080;
    const CARD_HEIGHT = 1350;

    const text = (selector, fallback = "") => {
        const value = document.querySelector(selector)?.textContent?.trim();
        return value || fallback;
    };

    const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (char) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    }[char]));

    const getMeta = (name, property) => document.querySelector(`meta[name="${name}"], meta[property="${property}"]`)?.content || "";

    function articleMeta() {
        const image = document.querySelector(".article-hero-img-wrap img");
        return {
            title: text('[itemprop="headline"]', getMeta("title", "og:title") || "NexShop News"),
            excerpt: text('[itemprop="description"]', getMeta("description", "og:description")),
            category: text('[itemprop="articleSection"]', getMeta("", "article:section") || "NexShop News"),
            author: text('[itemprop="author"] [itemprop="name"]', getMeta("author", "article:author") || "NexShop Editorial"),
            date: document.querySelector('[itemprop="datePublished"]')?.getAttribute("datetime") || "",
            imageUrl: image?.currentSrc || image?.src || getMeta("twitter:image", "og:image"),
            canonical: document.querySelector('link[rel="canonical"]')?.href || window.location.href,
            slug: window.location.pathname.split("/").filter(Boolean).pop() || "artikel"
        };
    }

    function formatDate(value) {
        if (!value) return "";
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("id-ID", {
            day: "numeric", month: "long", year: "numeric"
        }).format(date);
    }

    function wrapText(ctx, value, maxWidth, maxLines) {
        const words = String(value || "").split(/\s+/).filter(Boolean);
        const lines = [];
        let line = "";
        for (const word of words) {
            const next = line ? `${line} ${word}` : word;
            if (ctx.measureText(next).width <= maxWidth || !line) {
                line = next;
            } else {
                lines.push(line);
                line = word;
                if (lines.length === maxLines - 1) break;
            }
        }
        if (line && lines.length < maxLines) lines.push(line);
        const consumed = lines.join(" ").length;
        if (consumed < String(value || "").trim().length && lines.length) {
            let last = lines[lines.length - 1];
            while (ctx.measureText(`${last}…`).width > maxWidth && last.length > 1) last = last.slice(0, -1);
            lines[lines.length - 1] = `${last}…`;
        }
        return lines;
    }

    function roundedRect(ctx, x, y, width, height, radius) {
        const r = Math.min(radius, width / 2, height / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + width, y, x + width, y + height, r);
        ctx.arcTo(x + width, y + height, x, y + height, r);
        ctx.arcTo(x, y + height, x, y, r);
        ctx.arcTo(x, y, x + width, y, r);
        ctx.closePath();
    }

    function loadImage(url) {
        return new Promise((resolve, reject) => {
            if (!url) return reject(new Error("no image"));
            const image = new Image();
            image.crossOrigin = "anonymous";
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error("image unavailable"));
            image.src = url;
        });
    }

    function drawCover(ctx, image, x, y, width, height) {
        const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
        const drawWidth = image.naturalWidth * scale;
        const drawHeight = image.naturalHeight * scale;
        ctx.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
    }

    async function createShareCard(meta) {
        const canvas = document.createElement("canvas");
        canvas.width = CARD_WIDTH;
        canvas.height = CARD_HEIGHT;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas tidak tersedia");

        const background = ctx.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT);
        background.addColorStop(0, "#07131c");
        background.addColorStop(0.55, "#102a36");
        background.addColorStop(1, "#091017");
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

        const glow = ctx.createRadialGradient(820, 150, 20, 820, 150, 520);
        glow.addColorStop(0, "rgba(0,194,232,0.28)");
        glow.addColorStop(1, "rgba(0,194,232,0)");
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, CARD_WIDTH, 700);

        ctx.fillStyle = "#ffffff";
        ctx.font = "700 34px Arial, sans-serif";
        ctx.fillText("NEXSHOP", 64, 78);
        ctx.fillStyle = "#00c2e8";
        ctx.font = "700 24px Arial, sans-serif";
        ctx.fillText("NEWS", 260, 78);

        const imageX = 64;
        const imageY = 130;
        const imageWidth = CARD_WIDTH - 128;
        const imageHeight = 520;
        roundedRect(ctx, imageX, imageY, imageWidth, imageHeight, 34);
        ctx.save();
        ctx.clip();
        try {
            const image = await loadImage(meta.imageUrl);
            drawCover(ctx, image, imageX, imageY, imageWidth, imageHeight);
            const overlay = ctx.createLinearGradient(0, imageY, 0, imageY + imageHeight);
            overlay.addColorStop(0, "rgba(0,0,0,0.05)");
            overlay.addColorStop(1, "rgba(0,0,0,0.78)");
            ctx.fillStyle = overlay;
            ctx.fillRect(imageX, imageY, imageWidth, imageHeight);
        } catch (error) {
            const placeholder = ctx.createLinearGradient(imageX, imageY, imageX + imageWidth, imageY + imageHeight);
            placeholder.addColorStop(0, "#164451");
            placeholder.addColorStop(1, "#101820");
            ctx.fillStyle = placeholder;
            ctx.fillRect(imageX, imageY, imageWidth, imageHeight);
        }
        ctx.restore();

        ctx.fillStyle = "#8be9f7";
        ctx.font = "700 22px Arial, sans-serif";
        ctx.fillText(String(meta.category).toUpperCase().slice(0, 38), 80, 590);

        ctx.fillStyle = "#ffffff";
        ctx.font = "700 56px Arial, sans-serif";
        const titleLines = wrapText(ctx, meta.title, CARD_WIDTH - 128, 3);
        titleLines.forEach((line, index) => ctx.fillText(line, 64, 760 + index * 68));

        ctx.fillStyle = "rgba(236,246,248,0.82)";
        ctx.font = "400 28px Arial, sans-serif";
        const excerptLines = wrapText(ctx, meta.excerpt, CARD_WIDTH - 128, 3);
        excerptLines.forEach((line, index) => ctx.fillText(line, 64, 1000 + index * 42));

        ctx.fillStyle = "#9db4bd";
        ctx.font = "400 22px Arial, sans-serif";
        const date = formatDate(meta.date);
        ctx.fillText(`${meta.author}${date ? `  •  ${date}` : ""}`, 64, 1180);
        ctx.fillStyle = "#00c2e8";
        ctx.font = "600 20px Arial, sans-serif";
        ctx.fillText(meta.canonical.replace(/^https?:\/\//, "").slice(0, 66), 64, 1240);
        ctx.fillStyle = "rgba(255,255,255,0.42)";
        ctx.font = "400 18px Arial, sans-serif";
        ctx.fillText("Baca selengkapnya di NexShop News", 64, 1290);

        return new Promise((resolve, reject) => {
            canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Gagal membuat PNG")), "image/png");
        });
    }

    function feedback(message, isError = false) {
        const node = document.getElementById(FEEDBACK_ID);
        if (!node) return;
        node.textContent = message;
        node.style.color = isError ? "#fb7185" : "";
    }

    function download(blob, filename) {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    async function shareInstagramCard(button) {
        const meta = articleMeta();
        button.disabled = true;
        button.classList.add("is-busy");
        button.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Menyiapkan kartu…';
        try {
            const blob = await createShareCard(meta);
            const filename = `nexshop-news-${meta.slug.replace(/[^a-z0-9-]/gi, "-")}.png`;
            const file = new File([blob], filename, { type: "image/png" });
            const canShareFiles = typeof navigator.share === "function"
                && (!navigator.canShare || navigator.canShare({ files: [file] }));
            if (canShareFiles) {
                await navigator.share({
                    title: meta.title,
                    text: `${meta.title}\n${meta.canonical}`,
                    files: [file]
                });
                feedback("Kartu Instagram siap dibagikan dari share sheet.");
            } else {
                download(blob, filename);
                feedback("Kartu Instagram sudah diunduh sebagai PNG. Upload gambar ini ke Instagram.");
            }
        } catch (error) {
            if (error?.name !== "AbortError") feedback("Kartu Instagram gagal dibuat. Coba lagi.", true);
        } finally {
            button.disabled = false;
            button.classList.remove("is-busy");
            button.innerHTML = '<i class="fa-brands fa-instagram" aria-hidden="true"></i> Kartu Instagram';
        }
    }

    function injectShareControl() {
        const buttons = document.querySelector(".share-buttons");
        if (!buttons || document.getElementById(BUTTON_ID) || !document.querySelector('[itemprop="headline"]')) return;
        const button = document.createElement("button");
        button.type = "button";
        button.id = BUTTON_ID;
        button.className = "share-btn instagram-share-btn";
        button.setAttribute("aria-label", "Buat kartu gambar untuk Instagram");
        button.innerHTML = '<i class="fa-brands fa-instagram" aria-hidden="true"></i> Kartu Instagram';
        button.addEventListener("click", () => shareInstagramCard(button));
        buttons.appendChild(button);

        const status = document.createElement("p");
        status.id = FEEDBACK_ID;
        status.className = "share-feedback";
        status.setAttribute("aria-live", "polite");
        buttons.parentElement.appendChild(status);
    }

    const observer = new MutationObserver(injectShareControl);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    injectShareControl();
})();
