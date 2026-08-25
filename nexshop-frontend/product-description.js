(function () {
    "use strict";

    // Common section headers in NexShop
    const SECTION_MAPPINGS = [
        {
            type: "benefits",
            keywords: ["keunggulan", "keuntungan", "benefit", "fitur"],
            icon: "fa-solid fa-circle-check",
            className: "sd-benefits"
        },
        {
            type: "important",
            keywords: ["catatan penting", "perhatian", "penting"],
            icon: "fa-solid fa-triangle-exclamation",
            className: "sd-important"
        },
        {
            type: "terms",
            keywords: ["ketentuan", "syarat"],
            icon: "fa-solid fa-clipboard-list",
            className: "sd-terms"
        },
        {
            type: "usage",
            keywords: ["cara penggunaan", "cara aktivasi", "cara topup", "cara pakai", "cara"],
            icon: "fa-solid fa-bolt",
            className: "sd-usage"
        },
        {
            type: "compatibility",
            keywords: ["kompatibilitas", "device", "perangkat"],
            icon: "fa-solid fa-desktop",
            className: "sd-compatibility"
        },
        {
            type: "warranty",
            keywords: ["garansi", "keamanan", "safety"],
            icon: "fa-solid fa-shield-halved",
            className: "sd-warranty"
        },
        {
            type: "delivery",
            keywords: ["pengiriman", "proses", "waktu"],
            icon: "fa-solid fa-box",
            className: "sd-delivery"
        },
        {
            type: "general",
            keywords: ["tentang produk", "deskripsi", "informasi", "info", "faq", "detail"],
            icon: "fa-solid fa-circle-info",
            className: "sd-general"
        },
        {
            type: "account",
            keywords: ["login", "akun"],
            icon: "fa-solid fa-user",
            className: "sd-account"
        }
    ];

    function stripEmojiAndMarkdown(text) {
        let cleaned = text;
        // Strip leading emojis and common list bullets/decorations
        cleaned = cleaned.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D✓•\-\*✅📌🎮🔥⭐⚠️💡📦🛡️💳🚀\s]+/gu, '');
        // Strip trailing colon
        cleaned = cleaned.replace(/:$/, '');
        // Strip markdown artifacts like ##, **, __
        cleaned = cleaned.replace(/^#+\s+/g, '');
        cleaned = cleaned.replace(/\*\*/g, '');
        cleaned = cleaned.replace(/__/g, '');
        cleaned = cleaned.replace(/^>\s+/g, '');
        return cleaned.trim();
    }

    function detectSectionType(title) {
        const lower = title.toLowerCase();
        for (const mapping of SECTION_MAPPINGS) {
            if (mapping.keywords.some(k => lower.includes(k))) {
                return mapping;
            }
        }
        return {
            type: "general",
            icon: "fa-solid fa-circle-info",
            className: "sd-general"
        };
    }

    function isHeadingCandidate(line) {
        if (line.length > 50) return false; // Too long for a heading
        const stripped = stripEmojiAndMarkdown(line);
        if (stripped.length < 3) return false;
        
        // Exact match from keywords
        const lower = stripped.toLowerCase();
        const allKeywords = SECTION_MAPPINGS.flatMap(m => m.keywords);
        if (allKeywords.some(k => lower === k)) return true;
        
        // Or if it ends with colon
        if (line.trim().endsWith(':')) return true;
        
        // Or starts with an emoji and is short
        const startsWithEmoji = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D✅📌🎮🔥⭐⚠️💡📦🛡️💳🚀]/u.test(line.trim());
        if (startsWithEmoji && line.length < 30) return true;

        return false;
    }

    function parseDescription(rawText) {
        const lines = rawText.replace(/\r\n/g, '\n').split('\n').map(l => l.trim());
        const sections = [];
        let currentSection = null;
        let introParagraphs = [];
        let inIntro = true;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!line) continue;

            if (isHeadingCandidate(line)) {
                inIntro = false;
                if (currentSection) sections.push(currentSection);
                currentSection = {
                    originalTitle: line,
                    title: stripEmojiAndMarkdown(line),
                    items: []
                };
            } else {
                if (inIntro) {
                    introParagraphs.push(stripEmojiAndMarkdown(line) || line);
                } else if (currentSection) {
                    currentSection.items.push(stripEmojiAndMarkdown(line) || line);
                }
            }
        }
        if (currentSection) sections.push(currentSection);

        return { intro: introParagraphs, sections };
    }

    window.renderProductDescription = function (rawText, productName, productCategory) {
        const container = document.createElement("div");
        container.className = "structured-description";

        if (!rawText || typeof rawText !== "string" || !rawText.trim()) {
            const p = document.createElement("p");
            p.className = "sd-empty";
            p.textContent = "Tidak ada deskripsi.";
            container.appendChild(p);
            return container;
        }

        const parsed = parseDescription(rawText);

        // Render Intro
        if (parsed.intro.length > 0) {
            const introDiv = document.createElement("div");
            introDiv.className = "sd-section sd-intro-section";
            
            // Add product title as the first header with a semantic icon if applicable
            const introHeader = document.createElement("div");
            introHeader.className = "sd-intro-header";
            const icon = document.createElement("i");
            icon.className = (productCategory && productCategory.toLowerCase().includes("game")) ? "fa-solid fa-gamepad" : "fa-solid fa-box";
            icon.setAttribute("aria-hidden", "true");
            
            const titleSpan = document.createElement("span");
            titleSpan.className = "sd-intro-title";
            titleSpan.textContent = productName || "Produk";
            
            introHeader.appendChild(icon);
            introHeader.appendChild(titleSpan);
            introDiv.appendChild(introHeader);

            parsed.intro.forEach((text, index) => {
                const p = document.createElement("p");
                p.className = index === 0 ? "sd-p sd-p-lead" : "sd-p";
                p.textContent = text;
                introDiv.appendChild(p);
            });
            container.appendChild(introDiv);
        }

        // Render Sections
        parsed.sections.forEach(section => {
            if (section.items.length === 0) return; // Skip empty sections

            const meta = detectSectionType(section.title);
            const secDiv = document.createElement("div");
            secDiv.className = `sd-section ${meta.className}`;

            const header = document.createElement("h4");
            header.className = "sd-title";
            const hIcon = document.createElement("i");
            hIcon.className = meta.icon;
            hIcon.setAttribute("aria-hidden", "true");
            
            const hText = document.createElement("span");
            hText.textContent = section.title || "Informasi";

            header.appendChild(hIcon);
            header.appendChild(hText);
            secDiv.appendChild(header);

            // Determine if we should render as a list or paragraphs
            // If most items are short, it's a list. If it has long texts, paragraphs.
            const isList = section.items.every(item => item.length < 150) && section.items.length > 1;

            if (isList) {
                const ul = document.createElement("ul");
                ul.className = "sd-list";
                section.items.forEach(item => {
                    const li = document.createElement("li");
                    const bulletIcon = document.createElement("i");
                    bulletIcon.className = meta.type === "benefits" ? "fa-solid fa-check" : "fa-solid fa-circle-dot";
                    bulletIcon.setAttribute("aria-hidden", "true");
                    
                    const span = document.createElement("span");
                    span.textContent = item;
                    
                    li.appendChild(bulletIcon);
                    li.appendChild(span);
                    ul.appendChild(li);
                });
                secDiv.appendChild(ul);
            } else {
                section.items.forEach(text => {
                    const p = document.createElement("p");
                    p.className = "sd-p";
                    p.textContent = text;
                    secDiv.appendChild(p);
                });
            }

            container.appendChild(secDiv);
        });

        return container;
    };
})();
