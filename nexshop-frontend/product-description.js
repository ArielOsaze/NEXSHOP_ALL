(function () {
    "use strict";

    const SECTION_MAPPINGS = [
        {
            type: "benefits",
            keywords: ["keunggulan", "keuntungan", "benefit", "fitur"],
            icon: "fa-solid fa-circle-check",
            className: "sd-benefits",
            itemIcon: "fa-solid fa-check"
        },
        {
            type: "important",
            keywords: ["catatan penting", "perhatian", "penting"],
            icon: "fa-solid fa-triangle-exclamation",
            className: "sd-important",
            itemIcon: "fa-solid fa-circle-exclamation"
        },
        {
            type: "terms",
            keywords: ["ketentuan", "syarat"],
            icon: "fa-solid fa-clipboard-list",
            className: "sd-terms",
            itemIcon: "fa-solid fa-chevron-right"
        },
        {
            type: "usage",
            keywords: ["cara penggunaan", "cara aktivasi", "cara topup", "cara pakai", "cara"],
            icon: "fa-solid fa-bolt",
            className: "sd-usage",
            itemIcon: "fa-solid fa-chevron-right"
        },
        {
            type: "compatibility",
            keywords: ["kompatibilitas", "device", "perangkat"],
            icon: "fa-solid fa-desktop",
            className: "sd-compatibility",
            itemIcon: "fa-solid fa-chevron-right"
        },
        {
            type: "warranty",
            keywords: ["garansi", "keamanan", "safety"],
            icon: "fa-solid fa-shield-halved",
            className: "sd-warranty",
            itemIcon: "fa-solid fa-chevron-right"
        },
        {
            type: "delivery",
            keywords: ["pengiriman", "proses", "waktu"],
            icon: "fa-solid fa-box",
            className: "sd-delivery",
            itemIcon: "fa-solid fa-chevron-right"
        },
        {
            type: "general",
            keywords: ["tentang produk", "deskripsi", "informasi", "info", "faq", "detail"],
            icon: "fa-solid fa-circle-info",
            className: "sd-general",
            itemIcon: "fa-solid fa-circle-dot"
        }
    ];

    function stripEmojiAndMarkdown(text) {
        let cleaned = text;
        cleaned = cleaned.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D✓•\-\*✅📌🎮🔥⭐⚠️💡📦🛡️💳🚀\s]+/gu, '');
        cleaned = cleaned.replace(/:$/, '');
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
            className: "sd-general",
            itemIcon: "fa-solid fa-circle-dot"
        };
    }

    function isHeadingCandidate(line) {
        if (line.length > 50) return false;
        const stripped = stripEmojiAndMarkdown(line);
        if (stripped.length < 3) return false;
        
        const lower = stripped.toLowerCase();
        const allKeywords = SECTION_MAPPINGS.flatMap(m => m.keywords);
        if (allKeywords.some(k => lower === k)) return true;
        
        if (line.trim().endsWith(':')) return true;
        
        const startsWithEmoji = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D✅📌🎮🔥⭐⚠️💡📦🛡️💳🚀]/u.test(line.trim());
        if (startsWithEmoji && line.length < 30) return true;

        return false;
    }

    function parseDescription(rawText) {
        // Split text by lines, preserving empty lines to detect paragraphs
        const lines = rawText.replace(/\r\n/g, '\n').split('\n');
        const sections = [];
        let currentSection = null;
        let introParagraphs = [];
        let inIntro = true;
        let currentParagraphBuffer = [];

        function flushParagraph(target) {
            if (currentParagraphBuffer.length > 0) {
                target.push(currentParagraphBuffer.join(" "));
                currentParagraphBuffer = [];
            }
        }

        for (let i = 0; i < lines.length; i++) {
            const originalLine = lines[i];
            const line = originalLine.trim();

            if (!line) {
                if (inIntro) flushParagraph(introParagraphs);
                else if (currentSection && currentSection.type !== "list") {
                    flushParagraph(currentSection.items);
                }
                continue;
            }

            if (isHeadingCandidate(line)) {
                if (inIntro) flushParagraph(introParagraphs);
                else if (currentSection) flushParagraph(currentSection.items);
                
                inIntro = false;
                if (currentSection) sections.push(currentSection);
                currentSection = {
                    title: stripEmojiAndMarkdown(line),
                    items: [],
                    type: "unknown" // Will be evaluated to list or paragraph later
                };
            } else {
                const cleanedLine = stripEmojiAndMarkdown(line);
                if (!cleanedLine) continue;

                if (inIntro) {
                    currentParagraphBuffer.push(cleanedLine);
                } else if (currentSection) {
                    // Check if it's a list item (starts with a bullet or emoji)
                    const isListItem = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D✓•\-\*✅📌🎮🔥⭐⚠️💡📦🛡️💳🚀]/u.test(originalLine.trim()) || originalLine.startsWith("-") || originalLine.startsWith("*") || originalLine.startsWith("•");
                    
                    if (isListItem) {
                        flushParagraph(currentSection.items);
                        currentSection.items.push(cleanedLine);
                        currentSection.type = "list";
                    } else {
                        // Just regular text, buffer it
                        if (currentSection.type === "list") {
                            // If we were building a list, this line is just another list item (without a bullet)
                            currentSection.items.push(cleanedLine);
                        } else {
                            currentParagraphBuffer.push(cleanedLine);
                        }
                    }
                }
            }
        }
        
        if (inIntro) flushParagraph(introParagraphs);
        else if (currentSection) {
            flushParagraph(currentSection.items);
            sections.push(currentSection);
        }

        // Post-process sections to ensure type is correct
        sections.forEach(sec => {
            if (sec.type === "unknown") {
                sec.type = (sec.items.every(item => item.length < 150) && sec.items.length > 1) ? "list" : "paragraph";
            }
        });

        return { intro: introParagraphs, sections };
    }

    window.renderProductDescription = function (rawText, productName) {
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
            introDiv.className = "sd-intro";
            
            const firstLine = parsed.intro[0];
            const isRedundant = firstLine.toLowerCase() === (productName || "").toLowerCase();
            
            if (!isRedundant && firstLine.length < 50 && parsed.intro.length > 1) {
                // If it's short, not exactly the product name, and there is more text, treat it as a subtitle
                const subtitle = document.createElement("div");
                subtitle.className = "sd-subtitle";
                subtitle.textContent = firstLine;
                introDiv.appendChild(subtitle);
                
                parsed.intro.slice(1).forEach((text) => {
                    const p = document.createElement("p");
                    p.className = "sd-p";
                    p.textContent = text;
                    introDiv.appendChild(p);
                });
            } else {
                parsed.intro.forEach((text, index) => {
                    // Skip redundant title completely
                    if (index === 0 && isRedundant) return;
                    
                    const p = document.createElement("p");
                    p.className = "sd-p";
                    p.textContent = text;
                    introDiv.appendChild(p);
                });
            }
            container.appendChild(introDiv);
        }

        // Render Sections
        parsed.sections.forEach((section, index) => {
            if (section.items.length === 0) return;

            // Optional Divider (only if it's not the first thing after intro, or spacing is preferred)
            // Using spacing in CSS is better, but we can add a divider if it's "Catatan Penting" to isolate it.
            if (index > 0 && section.title.toLowerCase().includes("penting")) {
                const divider = document.createElement("hr");
                divider.className = "sd-divider";
                container.appendChild(divider);
            }

            const meta = detectSectionType(section.title);
            const secDiv = document.createElement("div");
            secDiv.className = `sd-section ${meta.className}`;

            const header = document.createElement("div");
            header.className = "sd-section-header";
            const hIcon = document.createElement("i");
            hIcon.className = meta.icon;
            hIcon.setAttribute("aria-hidden", "true");
            
            const hText = document.createElement("h4");
            hText.className = "sd-section-title";
            hText.textContent = section.title || "Informasi";

            header.appendChild(hIcon);
            header.appendChild(hText);
            secDiv.appendChild(header);

            if (section.type === "list") {
                const ul = document.createElement("ul");
                ul.className = "sd-list";
                section.items.forEach(item => {
                    const li = document.createElement("li");
                    li.className = "sd-list-item";
                    
                    const bulletIcon = document.createElement("i");
                    bulletIcon.className = `${meta.itemIcon} sd-list-icon`;
                    bulletIcon.setAttribute("aria-hidden", "true");
                    
                    const span = document.createElement("span");
                    span.className = "sd-list-text";
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
