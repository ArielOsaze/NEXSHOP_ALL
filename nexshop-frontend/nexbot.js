// ===========================================================
// NEXBOT — WIDGET CHAT ASISTEN NEXSHOP
//
// File ini BERDIRI SENDIRI dan dipakai bareng oleh halaman utama
// (index.html) maupun Marketplace (marketplace.html). Dulu semua kode
// NexBot nempel di script.js yang khusus halaman utama, jadi halaman lain
// gak bisa ikut pakai tanpa nyalin-nempel.
//
// Yang dijaga di sini:
//   - Gak bikin variabel global yang namanya bentrok dengan script.js
//     (API_BASE, escapeHtml, rupiah, dsb tetap milik script.js).
//   - Kalau halamannya belum punya markup widget, markup-nya disuntik
//     sendiri -- jadi halaman baru cukup memuat file ini.
//   - Gaya visualnya ikut style.css (kelas .nexbot-*), yang sudah dimuat
//     di semua halaman.
// ===========================================================

function nexbotApiBase() {
    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1") {
        return window.location.port === "3000" ? "/api" : "http://localhost:3000/api";
    }
    return window.location.protocol.startsWith("http") ? "/api" : "https://nexshop.cloud/api";
}

// script.js menyimpan fetch asli di window.nativeFetch (karena fetch global
// di halaman utama dibungkus loader). Di halaman lain, fetch biasa.
function nexbotFetch(url, options) {
    const f = window.nativeFetch || window.fetch;
    return f(url, options);
}

const NEXBOT_QUICK_TOPICS = [
    { icon: "fa-shield-halved", topic: "Apakah NexShop aman?" },
    { icon: "fa-scale-balanced", topic: "Apakah NexShop legal?" },
    { icon: "fa-wallet", topic: "Pembayaran pakai apa?" },
    { icon: "fa-cart-shopping", topic: "Cara membeli produk?" },
    { icon: "fa-bolt", topic: "Cara top up?" },
    { icon: "fa-shop", topic: "Apa itu Marketplace NexShop?" },
    { icon: "fa-handshake", topic: "Cara daftar reseller?" },
    { icon: "fa-rotate-left", topic: "Kebijakan refund?" },
    { icon: "fa-brands fa-whatsapp", topic: "Hubungi Customer Service" }
];

const NEXBOT_MASCOT_SRC = "/images/nexbot-mascot.webp";
const NEXBOT_PET_IDLE_LINES = [
    "Butuh cek harga? Panggil aku ya!",
    "Aku bisa bantu cek pesananmu.",
    "Mau cari top up atau tagihan?",
    "Aku masih di sini kalau kamu butuh bantuan."
];

const nexbotPetState = {
    bubbleTimer: null,
    greetingTimer: null,
    moodTimer: null,
    idleTimer: null,
    idleIndex: 0
};

function nexbotMascotMarkup(extraClass = "") {
    const className = ["nexbot-mascot-image", extraClass].filter(Boolean).join(" ");
    return `<img src="${NEXBOT_MASCOT_SRC}" class="${className}" alt="" aria-hidden="true" draggable="false">`;
}

// Markup widget cuma disuntik kalau halamannya belum menyediakan sendiri
// (index.html sudah punya versinya di HTML).
function ensureNexBotWidget() {
    if (document.getElementById("nexbotWidget")) return;

    const pills = NEXBOT_QUICK_TOPICS.map((q) => {
        const kelasIkon = q.icon.startsWith("fa-brands") ? q.icon : `fa-solid ${q.icon}`;
        return `<button type="button" class="nexbot-pill nexbot-quick-btn" data-topic="${q.topic}"><i class="${kelasIkon}"></i> ${q.topic}</button>`;
    }).join("");

    const wrap = document.createElement("div");
    wrap.className = "nexbot-widget";
    wrap.id = "nexbotWidget";
    // Mulai tersembunyi -- persis kayak markup bawaan index.html -- biar
    // halaman yang injeksi widget ini (mis. marketplace.html) yang
    // mengendalikan kapan dia layak muncul, bukan langsung nongol full
    // begitu script ini jalan.
    wrap.style.opacity = "0";
    wrap.style.pointerEvents = "none";
    wrap.style.transition = "opacity 0.5s ease-in-out";
    wrap.innerHTML = `
        <button type="button" class="nexbot-speech-bubble is-hidden" id="nexbotSpeechBubble" aria-label="Buka percakapan dengan NexBot" aria-live="polite">
            <span id="nexbotSpeechText">Hii, NexBot di sini!</span>
        </button>
        <button type="button" class="nexbot-float-btn group" id="nexbotFloatBtn" aria-label="Buka NexBot">
            <span class="nexbot-pet-sparks" aria-hidden="true"></span>
            <span class="nexbot-float-btn-icon">${nexbotMascotMarkup("nexbot-mascot-image--float")}</span>
        </button>
        <div class="nexbot-window hidden" id="nexbotWindow">
            <div class="nexbot-header">
                <div class="nexbot-header-info">
                    <div class="nexbot-avatar">${nexbotMascotMarkup()}</div>
                    <div>
                        <strong>NexBot <span class="nexbot-badge">Official</span></strong>
                        <div class="nexbot-status"><span class="nexbot-status-dot"></span> Online 24/7</div>
                    </div>
                </div>
                <button type="button" class="nexbot-close-btn" id="nexbotCloseBtn" aria-label="Tutup NexBot"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="nexbot-body" id="nexbotBody">
                <div class="nexbot-msg nexbot-msg--bot">
                    <div class="nexbot-msg-meta">
                        <span class="nexbot-msg-avatar" aria-hidden="true">${nexbotMascotMarkup()}</span>
                        <span class="nexbot-msg-name">NexBot</span>
                        <span class="nexbot-msg-time">Online</span>
                    </div>
                    <div class="nexbot-msg-content" id="nexbotWelcomeContent"></div>
                </div>
                <div class="nexbot-quick-pills">${pills}</div>
            </div>
            <div class="nexbot-footer">
                <form id="nexbotForm" class="nexbot-input-row">
                    <input type="text" id="nexbotInput" placeholder="Tanyakan apa saja kepada NexBot..." autocomplete="off">
                    <button type="submit" id="nexbotSendBtn" aria-label="Kirim"><i class="fa-solid fa-paper-plane"></i></button>
                </form>
            </div>
        </div>
    `;
    document.body.appendChild(wrap);
}

// ===========================================================
// RENDERER JAWABAN NEXBOT
//
// Jawaban dari AI itu teks markdown-ish. Versi lama cuma mecah baris terus
// nempel <br>, jadi judul, daftar, dan baris "Status: Sukses" kelihatan
// sama rata tanpa hierarki -- itu yang bikin balasan kelihatan berantakan.
//
// Renderer ini mecah jawaban jadi BLOK bermakna dulu (heading, paragraf,
// bullet/numbered list + sub-poin, baris "Label: nilai", kutipan, kode,
// garis pemisah, baris beremoji), baru dirender jadi elemen HTML yang
// masing-masing udah punya spacing sendiri di CSS.
//
// Semua teks di-escape DULU sebelum format inline ditempel, dan link cuma
// boleh http(s) -- respons AI gak pernah dipercaya sebagai HTML mentah.
// ===========================================================

// Frasa meta yang gak perlu dilihat customer. SENGAJA frasa utuh, bukan kata
// lepas -- versi lama nge-hapus kata "Database"/"FAQ:" di mana pun dia
// muncul, jadi kalimat normal ikut kepotong di tengah.
const NEXBOT_META_PATTERNS = [
    /^Berikut informasi resmi dari Knowledge Base NexShop[^\n]*\n?/gim,
    /\bKnowledge Base NexShop\b/gi,
    /\bKnowledge Base\b/gi,
    /\bAI Reference\b/gi
];

// Penanda internal buat "nitip" potongan HTML yang udah jadi (link/kode)
// supaya isinya gak keubek lagi sama regex bold/italic/autolink.
const NEXBOT_SLOT = "\u0000";

function nexbotEscape(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Peta menu/aksi yang NAMANYA disebut NexBot tapi TIDAK punya halaman
// sendiri (mis. "Cek Transaksi" itu modal di index.html, bukan URL). Key di
// sini dipakai sebagai nilai `data-nexbot-action`, dan hrefnya cuma
// fallback: kalau user lagi di halaman lain (mis. marketplace.html) yang
// gak muat fungsi JS-nya, dia diarahkan balik ke beranda dan aksi yang
// sama otomatis dijalankan lewat openNexBotActionFromQuery() di script.js.
const NEXBOT_ACTION_LINKS = [
    { pattern: /\bmenu Cek Transaksi\b|\bCek Transaksi\b/g, action: "track", href: "/?nexbot_action=track" }
];

// Fungsi JS di index.html yang dipanggil kalau usernya SUDAH di halaman
// itu (biar gak perlu reload sama sekali). Dicek pakai typeof supaya aman
// dipanggil dari halaman mana pun -- kalau fungsinya gak ada, klik jatuh
// balik ke href biasa di atas.
const NEXBOT_ACTION_FUNCTIONS = { track: "openTrackModal" };

function nexbotInline(raw) {
    const slots = [];
    const stash = (html) => {
        slots.push(html);
        return `${NEXBOT_SLOT}${slots.length - 1}${NEXBOT_SLOT}`;
    };

    let s = nexbotEscape(String(raw ?? "").replace(new RegExp(NEXBOT_SLOT, "g"), ""));

    // `kode`
    s = s.replace(/`([^`]+)`/g, (m, code) => stash(`<code>${code}</code>`));

    // [teks](https://...)
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, label, url) =>
        stash(`<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`)
    );

    // URL telanjang -> ikut jadi link, teksnya dipendekin (tanpa skema)
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (m, pre, url) =>
        pre + stash(`<a href="${url}" target="_blank" rel="noopener noreferrer">${url.replace(/^https?:\/\//, "")}</a>`)
    );

    // nexshop.cloud/xxx TANPA skema (gaya penulisan yang dipakai knowledge
    // base, mis. "halaman Marketplace di nexshop.cloud/marketplace") --
    // diubah jadi link RELATIF yang bisa langsung diklik. Sengaja relatif
    // (bukan https://nexshop.cloud/xxx) dan TANPA target="_blank" karena
    // ini navigasi pindah halaman di web yang sama, bukan link keluar.
    s = s.replace(/\bnexshop\.cloud((?:\/[a-zA-Z0-9\-_]+(?:\.[a-zA-Z0-9]+)?)*\/?)/gi, (m, path) =>
        stash(`<a href="${path && path !== "/" ? path : "/"}" class="nexbot-inline-link">${m}</a>`)
    );

    // Menu/aksi internal yang gak punya URL sendiri (lihat NEXBOT_ACTION_LINKS).
    NEXBOT_ACTION_LINKS.forEach(({ pattern, action, href }) => {
        s = s.replace(pattern, (m) => stash(`<a href="${href}" class="nexbot-inline-link" data-nexbot-action="${action}">${m}</a>`));
    });

    s = s
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");

    return s.replace(new RegExp(`${NEXBOT_SLOT}(\\d+)${NEXBOT_SLOT}`, "g"), (m, i) => slots[Number(i)]);
}

// Link `data-nexbot-action` di dalam balasan yang baru dirender: kalau
// fungsi JS-nya ADA di halaman ini, jalanin langsung (chat ditutup dulu
// biar modalnya kelihatan) dan batalkan navigasi hrefnya. Kalau gak ada
// (usernya lagi di halaman lain), biarin browser ikutin href fallback-nya.
function attachNexBotInlineActions(scopeEl) {
    scopeEl.querySelectorAll("[data-nexbot-action]").forEach((el) => {
        el.addEventListener("click", (e) => {
            const fnName = NEXBOT_ACTION_FUNCTIONS[el.dataset.nexbotAction];
            if (fnName && typeof window[fnName] === "function") {
                e.preventDefault();
                closeNexBotWidget();
                window[fnName]();
            }
        });
    });
}

// Baris yang dimulai emoji, mis. "💳 Pembayaran"
const NEXBOT_EMOJI_LINE = /^([‼-㊙\u{1F000}-\u{1FAFF}☀-➿][️⃣]?)\s+(.{2,})$/u;
// Baris "Label: nilai" (mis. "Status: Sukses"). Panjang & karakter label
// dibatasin biar kalimat biasa yang kebetulan ada titik duanya gak ikut.
const NEXBOT_KV_LINE = /^\*{0,2}([A-Za-z0-9][A-Za-z0-9 ()\/&.'’-]{1,26})\*{0,2}\s*:\s*(?!\/\/)(\S.*)$/;
// Label baris rincian itu SELALU pendek ("Status", "Nomor Order"). Kalimat
// biasa yang kebetulan ada titik duanya -- paling sering karena ada URL,
// mis. "Detail lengkap ada di https://..." -- gak boleh ikut ketangkep,
// makanya jumlah katanya dibatasi (dan value yang mulai "//" ditolak di
// regex atas).
const NEXBOT_KV_MAX_WORDS = 3;

function nexbotTokenize(text) {
    const lines = text.split("\n");
    const blocks = [];
    let paragraphBreak = false;

    const pushInto = (type, item) => {
        const prev = blocks[blocks.length - 1];
        if (!paragraphBreak && prev && prev.type === type) prev.items.push(item);
        else blocks.push({ type, items: [item] });
        paragraphBreak = false;
    };

    for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i].replace(/\s+$/, "");
        const line = rawLine.trim();

        if (!line) {
            paragraphBreak = true;
            continue;
        }

        // ``` blok kode ```
        if (/^```/.test(line)) {
            const body = [];
            i++;
            while (i < lines.length && !/^```/.test(lines[i].trim())) {
                body.push(lines[i]);
                i++;
            }
            blocks.push({ type: "code", text: body.join("\n") });
            paragraphBreak = false;
            continue;
        }

        // Garis pemisah (---, ***, ___)
        if (/^([-*_])\1{2,}$/.test(line)) {
            blocks.push({ type: "hr" });
            paragraphBreak = false;
            continue;
        }

        const heading = line.match(/^(#{1,6})\s+(.*)$/);
        if (heading) {
            blocks.push({ type: "heading", level: Math.min(heading[1].length, 3), text: heading[2] });
            paragraphBreak = false;
            continue;
        }

        const quote = line.match(/^>\s?(.*)$/);
        if (quote) {
            pushInto("quote", quote[1]);
            continue;
        }

        const bullet = rawLine.match(/^(\s*)[-*•‣]\s+(.*)$/);
        if (bullet) {
            const depth = Math.min(Math.floor(bullet[1].replace(/\t/g, "    ").length / 2), 2);
            pushInto("ul", { depth, text: bullet[2] });
            continue;
        }

        const numbered = rawLine.match(/^(\s*)(\d+)[.)]\s+(.*)$/);
        if (numbered) {
            const depth = Math.min(Math.floor(numbered[1].replace(/\t/g, "    ").length / 2), 2);
            pushInto("ol", { depth, text: numbered[3] });
            continue;
        }

        const emoji = line.match(NEXBOT_EMOJI_LINE);
        if (emoji) {
            pushInto("emoji", { icon: emoji[1], text: emoji[2] });
            continue;
        }

        const kv = line.match(NEXBOT_KV_LINE);
        if (kv && kv[1].trim().split(/\s+/).length <= NEXBOT_KV_MAX_WORDS) {
            pushInto("kv", { label: kv[1].trim(), value: kv[2].trim() });
            continue;
        }

        pushInto("p", line);
    }

    return blocks;
}

// Susun <ul>/<ol> bertingkat: item ber-depth dibikin pohon dulu supaya
// sub-list-nya berada DI DALAM <li> induknya (HTML yang valid).
function nexbotRenderList(tag, items) {
    const root = [];
    const stack = [{ depth: -1, children: root }];

    items.forEach((item) => {
        const depth = item.depth || 0;
        const node = { text: item.text, children: [] };
        while (stack.length > 1 && stack[stack.length - 1].depth >= depth) stack.pop();
        stack[stack.length - 1].children.push(node);
        stack.push({ depth, children: node.children });
    });

    const render = (nodes) =>
        `<${tag}>` +
        nodes.map((n) => `<li>${nexbotInline(n.text)}${n.children.length ? render(n.children) : ""}</li>`).join("") +
        `</${tag}>`;

    return render(root);
}

function parseMarkdownToHtml(text) {
    if (!text) return "";

    let clean = String(text).replace(/\r\n/g, "\n");
    NEXBOT_META_PATTERNS.forEach((re) => {
        clean = clean.replace(re, "");
    });
    clean = clean.replace(/\n{3,}/g, "\n\n").trim();
    if (!clean) return "";

    let html = "";
    for (const block of nexbotTokenize(clean)) {
        switch (block.type) {
            case "heading":
                html += `<div class="nexbot-heading nexbot-heading--${block.level}">${nexbotInline(block.text)}</div>`;
                break;
            case "hr":
                html += `<hr class="nexbot-divider">`;
                break;
            case "code":
                html += `<pre class="nexbot-code"><code>${nexbotEscape(block.text)}</code></pre>`;
                break;
            case "quote":
                html += `<blockquote class="nexbot-quote">${block.items.map((t) => nexbotInline(t)).join("<br>")}</blockquote>`;
                break;
            case "ul":
                html += nexbotRenderList("ul", block.items);
                break;
            case "ol":
                html += nexbotRenderList("ol", block.items);
                break;
            case "emoji":
                // Satu baris emoji + teks tebal = judul jawaban
                // (mis. "💎 **Detail Topup TP...**"), bukan daftar 1 item.
                if (block.items.length === 1 && /^\*\*.+\*\*$/.test(block.items[0].text.trim())) {
                    html += `<div class="nexbot-heading nexbot-heading--1"><span class="nexbot-emoji-icon" aria-hidden="true">${nexbotEscape(
                        block.items[0].icon
                    )}</span>${nexbotInline(block.items[0].text.trim().replace(/^\*\*|\*\*$/g, ""))}</div>`;
                    break;
                }
                html += `<ul class="nexbot-emoji-list">${block.items
                    .map(
                        (i) =>
                            `<li><span class="nexbot-emoji-icon" aria-hidden="true">${nexbotEscape(i.icon)}</span><span>${nexbotInline(i.text)}</span></li>`
                    )
                    .join("")}</ul>`;
                break;
            case "kv":
                // Cuma dirender sebagai kartu rincian kalau beneran ada
                // BEBERAPA baris label. Satu baris "Label: nilai" nyempil di
                // tengah kalimat biasa lebih pas tetap jadi paragraf.
                if (block.items.length < 2) {
                    html += `<p>${nexbotInline(`${block.items[0].label}: ${block.items[0].value}`)}</p>`;
                    break;
                }
                html += `<div class="nexbot-kv">${block.items
                    .map(
                        (i) =>
                            `<div class="nexbot-kv-row"><span class="nexbot-kv-label">${nexbotInline(i.label)}</span><span class="nexbot-kv-value">${nexbotInline(
                                i.value
                            )}</span></div>`
                    )
                    .join("")}</div>`;
                break;
            default:
                html += `<p>${block.items.map((l) => nexbotInline(l)).join(" ")}</p>`;
        }
    }

    return html.trim();
}

function updateNexBotGreeting() {
    const welcomeEl = document.getElementById("nexbotWelcomeContent");
    if (!welcomeEl) return;

    let userName = "";
    if (typeof currentUser !== "undefined" && currentUser && (currentUser.name || currentUser.fullname)) {
        userName = currentUser.name || currentUser.fullname;
    } else {
        const storedUser = localStorage.getItem("user");
        if (storedUser) {
            try {
                const parsed = JSON.parse(storedUser);
                userName = parsed.name || parsed.fullname || "";
            } catch (e) { }
        }
    }

    const nameClean = userName.trim().split(" ")[0];

    // Sapaan disusun sebagai markdown lalu dirender lewat renderer yang sama
    // dengan jawaban NexBot -- jadi spacing, daftar, dan tipografinya persis
    // sama, bukan tumpukan <br> yang nempel.
    // Bullet markdown biasa, bukan emoji berjejer. Renderer NexBot
    // mengubahnya jadi <ul> yang bisa ditata lewat CSS -- tampilannya
    // konsisten di semua perangkat, dan pembaca layar membacakannya
    // sebagai daftar, bukan merapal nama-nama emoji.
    const topik = [
        "- Produk Game",
        "- Topup Diamond",
        "- Marketplace (E-Wallet, Pulsa, Tagihan)",
        "- Voucher & Diskon",
        "- Pembayaran",
        "- Status Pesanan",
        "- Program Reseller",
        "- Bantuan & Kebijakan"
    ].join("\n");

    const greetingMarkdown = nameClean
        ? `Halo ${nameClean}, selamat datang kembali di **NexShop**.

Saya **NexBot**, asisten virtual kamu. Ada yang bisa dibantu hari ini?

${topik}`
        : `Halo, saya **NexBot**, asisten virtual resmi NexShop.

Saya bisa bantu soal:

${topik}`;

    welcomeEl.innerHTML = parseMarkdownToHtml(greetingMarkdown);
}

/* NexBot Local State Management (Isolated from Global App State) */
const nexbotState = {
    loading: false,
    history: []
};

// Dipisah dari closeBtn listener supaya bisa dipanggil juga dari link aksi
// di dalam balasan (mis. pas ngarahin ke modal Cek Transaksi -- chat
// ditutup dulu biar modalnya gak ketutupan jendela NexBot).
function closeNexBotWidget() {
    const windowEl = document.getElementById("nexbotWindow");
    const floatBtn = document.getElementById("nexbotFloatBtn");
    if (!windowEl || !floatBtn || windowEl.classList.contains("hidden")) return;
    windowEl.classList.remove("is-listening", "is-thinking");
    windowEl.classList.add("closing");
    setTimeout(() => {
        windowEl.classList.add("hidden");
        windowEl.classList.remove("closing");
        floatBtn.classList.remove("hidden");
        showNexBotPetBubble("Aku tetap di sini ya!", 4200, "happy");
        scheduleNexBotPetIdle();
    }, 200);
}

function setNexBotPetMood(mood = "idle", duration = 0) {
    const widget = document.getElementById("nexbotWidget");
    if (!widget) return;
    widget.dataset.petMood = mood;
    clearTimeout(nexbotPetState.moodTimer);
    if (duration > 0) {
        nexbotPetState.moodTimer = setTimeout(() => {
            widget.dataset.petMood = "idle";
        }, duration);
    }
}

function hideNexBotPetBubble() {
    const bubble = document.getElementById("nexbotSpeechBubble");
    const floatBtn = document.getElementById("nexbotFloatBtn");
    if (!bubble) return;
    bubble.classList.add("is-hidden");
    bubble.setAttribute("aria-hidden", "true");
    clearTimeout(nexbotPetState.greetingTimer);
    floatBtn?.classList.remove("is-bubble-greeting");
}

function triggerNexBotPetGreeting() {
    const floatBtn = document.getElementById("nexbotFloatBtn");
    if (!floatBtn || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    clearTimeout(nexbotPetState.greetingTimer);
    floatBtn.classList.remove("is-bubble-greeting");
    // Memaksa restart keyframe agar setiap bubble baru selalu punya sapaan,
    // termasuk ketika teks sebelumnya belum sempat selesai menghilang.
    void floatBtn.offsetWidth;
    floatBtn.classList.add("is-bubble-greeting");
    nexbotPetState.greetingTimer = setTimeout(() => {
        floatBtn.classList.remove("is-bubble-greeting");
    }, 1450);
}

function showNexBotPetBubble(text, duration = 5200, mood = "curious") {
    const bubble = document.getElementById("nexbotSpeechBubble");
    const textEl = document.getElementById("nexbotSpeechText");
    const windowEl = document.getElementById("nexbotWindow");
    if (!bubble || !textEl || !windowEl?.classList.contains("hidden")) return;

    textEl.textContent = text;
    bubble.classList.remove("is-hidden");
    bubble.setAttribute("aria-hidden", "false");
    setNexBotPetMood(mood, duration);
    triggerNexBotPetGreeting();
    clearTimeout(nexbotPetState.bubbleTimer);
    if (duration > 0) {
        nexbotPetState.bubbleTimer = setTimeout(hideNexBotPetBubble, duration);
    }
}

function emitNexBotPetSparks(floatBtn, count = 6) {
    const layer = floatBtn?.querySelector(".nexbot-pet-sparks");
    if (!layer || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    for (let index = 0; index < count; index += 1) {
        const spark = document.createElement("span");
        const angle = ((Math.PI * 2) / count) * index + (Math.random() * 0.35);
        const distance = 28 + Math.random() * 18;
        spark.style.setProperty("--pet-spark-x", `${Math.cos(angle) * distance}px`);
        spark.style.setProperty("--pet-spark-y", `${Math.sin(angle) * distance}px`);
        spark.style.setProperty("--pet-spark-delay", `${index * 35}ms`);
        layer.appendChild(spark);
        setTimeout(() => spark.remove(), 900);
    }
}

function scheduleNexBotPetIdle() {
    clearTimeout(nexbotPetState.idleTimer);
    const delay = 18000 + Math.round(Math.random() * 12000);
    nexbotPetState.idleTimer = setTimeout(() => {
        const windowEl = document.getElementById("nexbotWindow");
        if (document.visibilityState === "visible" && windowEl?.classList.contains("hidden")) {
            const line = NEXBOT_PET_IDLE_LINES[nexbotPetState.idleIndex % NEXBOT_PET_IDLE_LINES.length];
            nexbotPetState.idleIndex += 1;
            showNexBotPetBubble(line, 5200, nexbotPetState.idleIndex % 3 === 0 ? "sleepy" : "curious");
        }
        scheduleNexBotPetIdle();
    }, delay);
}

// Maskot bukan sekadar gambar dekoratif: ia mengikuti pointer pada tombol,
// menyapa saat menerima fokus, dan bereaksi terhadap aktivitas input. Status
// berpikir/menjawab diatur dari alur chat di bawah agar gerakannya bermakna.
function initNexBotMascotInteractions(floatBtn, windowEl, input) {
    if (!floatBtn || floatBtn.dataset.mascotReady === "true") return;
    floatBtn.dataset.mascotReady = "true";

    const icon = floatBtn.querySelector(".nexbot-float-btn-icon");
    const bubble = document.getElementById("nexbotSpeechBubble");
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let lastPointer = null;
    let petTravel = 0;
    let lastPetReaction = 0;

    const resetPointerReaction = () => {
        if (!icon) return;
        icon.style.setProperty("--nexbot-look-x", "0px");
        icon.style.setProperty("--nexbot-look-y", "0px");
    };

    if (!reduceMotion && icon) {
        floatBtn.addEventListener("pointermove", (event) => {
            const rect = floatBtn.getBoundingClientRect();
            const x = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width - 0.5) * 2));
            const y = Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height - 0.5) * 2));
            icon.style.setProperty("--nexbot-look-x", `${(x * 4).toFixed(2)}px`);
            icon.style.setProperty("--nexbot-look-y", `${(y * 3).toFixed(2)}px`);

            if (lastPointer) {
                petTravel += Math.hypot(event.clientX - lastPointer.x, event.clientY - lastPointer.y);
            }
            lastPointer = { x: event.clientX, y: event.clientY };
            if (petTravel >= 85 && Date.now() - lastPetReaction > 1200) {
                petTravel = 0;
                lastPetReaction = Date.now();
                floatBtn.classList.add("is-petted");
                showNexBotPetBubble("Hehe, geli! Senang ketemu kamu ✨", 3600, "happy");
                emitNexBotPetSparks(floatBtn, 7);
                setTimeout(() => floatBtn.classList.remove("is-petted"), 760);
            }
        });
        floatBtn.addEventListener("pointerleave", () => {
            lastPointer = null;
            petTravel = 0;
            resetPointerReaction();
            scheduleNexBotPetIdle();
        });
    }

    floatBtn.addEventListener("pointerenter", () => {
        clearTimeout(nexbotPetState.idleTimer);
        showNexBotPetBubble("Hii! Mau aku bantu apa?", 3200, "curious");
    });
    floatBtn.addEventListener("focus", () => {
        floatBtn.classList.add("is-greeting");
        showNexBotPetBubble("Hii! Mau aku bantu apa?", 3200, "curious");
    });
    floatBtn.addEventListener("blur", () => {
        floatBtn.classList.remove("is-greeting");
        resetPointerReaction();
        scheduleNexBotPetIdle();
    });

    bubble?.addEventListener("click", () => floatBtn.click());
    setTimeout(() => showNexBotPetBubble("Hii, NexBot di sini!", 6800, "happy"), 2100);
    scheduleNexBotPetIdle();

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") scheduleNexBotPetIdle();
        else clearTimeout(nexbotPetState.idleTimer);
    });

    if (input) {
        const syncListeningState = () => {
            const active = document.activeElement === input || Boolean(input.value.trim());
            windowEl.classList.toggle("is-listening", active && !nexbotState.loading);
        };
        input.addEventListener("focus", syncListeningState);
        input.addEventListener("input", syncListeningState);
        input.addEventListener("blur", syncListeningState);
    }
}

function initNexBotChat() {
    const floatBtn = document.getElementById("nexbotFloatBtn");
    const closeBtn = document.getElementById("nexbotCloseBtn");
    const windowEl = document.getElementById("nexbotWindow");
    const form = document.getElementById("nexbotForm");
    const input = document.getElementById("nexbotInput");
    const body = document.getElementById("nexbotBody");
    const sendBtn = document.getElementById("nexbotSendBtn");

    if (!floatBtn || !windowEl || !form) return;

    initNexBotMascotInteractions(floatBtn, windowEl, input);

    floatBtn.addEventListener("click", () => {
        if (windowEl.classList.contains("hidden")) {
            floatBtn.classList.add("expanding", "is-reacting");
            setNexBotPetMood("excited", 700);
            emitNexBotPetSparks(floatBtn, 8);
            hideNexBotPetBubble();
            clearTimeout(nexbotPetState.idleTimer);
            setTimeout(() => {
                windowEl.classList.remove("hidden");
                floatBtn.classList.add("hidden");
                floatBtn.classList.remove("expanding", "is-reacting", "is-greeting");
                updateNexBotGreeting();
                input.focus();
            }, 250);
        }
    });

    closeBtn.addEventListener("click", closeNexBotWidget);

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text || nexbotState.loading) return;

        // Activate isolated chat loading state (DO NOT TRIGGER GLOBAL WEBSITE LOADING)
        nexbotState.loading = true;
        if (sendBtn) sendBtn.disabled = true;
        windowEl.classList.remove("is-listening");
        windowEl.classList.add("is-thinking");

        appendNexBotMessage(text, "user");
        input.value = "";

        // Record user query in conversation memory
        nexbotState.history.push({ role: "user", text });

        const typingEl = appendNexBotTyping();
        body.scrollTop = body.scrollHeight;

        try {
            const token = localStorage.getItem("nexshop-public-token") || localStorage.getItem("token");
            const headers = { "Content-Type": "application/json" };
            if (token) headers["Authorization"] = `Bearer ${token}`;

            let sessionId = localStorage.getItem("nexbot_session_id");
            if (!sessionId) {
                sessionId = "sess-" + Date.now() + "-" + Math.random().toString(36).substring(2, 7);
                localStorage.setItem("nexbot_session_id", sessionId);
            }

            const res = await nexbotFetch(`${nexbotApiBase()}/ai/chat`, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    message: text,
                    session_id: sessionId,
                    history: nexbotState.history.slice(-6)
                })
            });

            const data = await res.json().catch(() => ({}));
            typingEl.remove();

            if (!res.ok) {
                appendNexBotMessage(data.message || "Maaf, terjadi kendala koneksi.", "bot");
                return;
            }

            const replyText = data.reply || "Maaf, tidak ada tanggapan.";
            appendNexBotMessage(replyText, "bot", data.cards, data.handoff);

            // Record bot response in conversation memory
            nexbotState.history.push({ role: "model", text: replyText });

        } catch (err) {
            typingEl.remove();
            appendNexBotMessage("Maaf, terjadi masalah pada jaringan.", "bot");
        } finally {
            nexbotState.loading = false;
            if (sendBtn) sendBtn.disabled = false;
            windowEl.classList.remove("is-thinking");
            if (document.activeElement === input) windowEl.classList.add("is-listening");
        }
    });
}

function sendNexBotQuick(query) {
    const input = document.getElementById("nexbotInput");
    const form = document.getElementById("nexbotForm");
    if (input && form) {
        input.value = query;
        form.dispatchEvent(new Event("submit"));
    }
}

// Jam pesan (HH.MM) — dipakai di header tiap balasan, biar percakapan
// kebaca kayak transkrip chat beneran, bukan tumpukan balon tanpa konteks.
function nexbotTimeLabel(date = new Date()) {
    return date.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

function nexbotScrollToBottom(smooth = true) {
    const body = document.getElementById("nexbotBody");
    if (!body) return;
    body.scrollTo({ top: body.scrollHeight, behavior: smooth ? "smooth" : "auto" });
}

// Tombol "Salin" di tiap jawaban NexBot — teks ASLI (markdown mentah) yang
// disalin, bukan hasil render HTML-nya.
function attachNexBotCopy(msgDiv, rawText) {
    const btn = msgDiv.querySelector(".nexbot-copy-btn");
    if (!btn) return;
    btn.addEventListener("click", async () => {
        try {
            await navigator.clipboard.writeText(rawText);
        } catch (err) {
            const helper = document.createElement("textarea");
            helper.value = rawText;
            helper.setAttribute("readonly", "");
            helper.style.position = "fixed";
            helper.style.opacity = "0";
            document.body.appendChild(helper);
            helper.select();
            try { document.execCommand("copy"); } catch (e) { /* clipboard gak tersedia */ }
            helper.remove();
        }
        btn.innerHTML = `<i class="fa-solid fa-check"></i> Tersalin`;
        btn.classList.add("is-copied");
        setTimeout(() => {
            btn.innerHTML = `<i class="fa-regular fa-copy"></i> Salin`;
            btn.classList.remove("is-copied");
        }, 1800);
    });
}

function appendNexBotMessage(text, sender, cards = [], handoff = false) {
    const body = document.getElementById("nexbotBody");
    if (!body) return;

    const isBot = sender !== "user";
    const msgDiv = document.createElement("div");
    msgDiv.className = `nexbot-msg nexbot-msg--${sender}`;
    if (isBot) msgDiv.classList.add("nexbot-msg--arriving");

    const content = isBot
        ? parseMarkdownToHtml(text)
        : `<p>${nexbotEscape(text).replace(/\n/g, "<br>")}</p>`;

    let html = "";

    if (isBot) {
        html += `<div class="nexbot-msg-meta">
            <span class="nexbot-msg-avatar" aria-hidden="true">${nexbotMascotMarkup()}</span>
            <span class="nexbot-msg-name">NexBot</span>
            <span class="nexbot-msg-time">${nexbotTimeLabel()}</span>
        </div>`;
    }

    html += `<div class="nexbot-msg-content">${content}</div>`;

    if (cards && cards.length > 0) {
        html += `<div class="nexbot-card-list">`;
        cards.forEach((c) => {
            const url = /^https?:\/\//i.test(c.url || "") || String(c.url || "").startsWith("/") ? c.url : "#";
            html += `<a class="nexbot-card-suggest" href="${nexbotEscape(url)}">
                <span class="nexbot-card-body">
                    <span class="nexbot-card-title">${nexbotEscape(c.title || "")}</span>
                    <span class="nexbot-card-sub">${nexbotEscape(c.price || c.desc || "")}</span>
                </span>
                <span class="nexbot-card-cta">Lihat <i class="fa-solid fa-arrow-right"></i></span>
            </a>`;
        });
        html += `</div>`;
    }

    if (handoff) {
        // Ambil nomor WA dari store_settings (sumber yang sama dengan halaman
        // Kontak), bukan nomor yang di-hardcode -- supaya kalau admin ganti
        // nomor CS lewat dashboard, tombol ini otomatis ikut ter-update.
        const waDigits = (window.cachedStoreSettings?.contact_whatsapp || "6287792634063").replace(/\D/g, "");
        const waHref = `https://wa.me/${waDigits}?text=${encodeURIComponent("Halo Admin NexShop, saya butuh bantuan")}`;
        html += `<a href="${waHref}" target="_blank" rel="noopener" class="nexbot-handoff-btn">
            <i class="fa-brands fa-whatsapp"></i> Hubungi CS WhatsApp
        </a>`;
    }

    if (isBot) {
        html += `<div class="nexbot-msg-actions">
            <button type="button" class="nexbot-copy-btn" title="Salin jawaban"><i class="fa-regular fa-copy"></i> Salin</button>
        </div>`;
    } else {
        html += `<div class="nexbot-msg-time nexbot-msg-time--user">${nexbotTimeLabel()}</div>`;
    }

    msgDiv.innerHTML = html;
    body.appendChild(msgDiv);
    if (isBot) {
        attachNexBotCopy(msgDiv, text);
        attachNexBotInlineActions(msgDiv);
        setTimeout(() => msgDiv.classList.remove("nexbot-msg--arriving"), 850);
    }
    nexbotScrollToBottom();
}

function appendNexBotTyping() {
    const body = document.getElementById("nexbotBody");
    const div = document.createElement("div");
    div.className = "nexbot-msg nexbot-msg--bot nexbot-msg--typing";
    div.innerHTML = `<div class="nexbot-msg-meta">
            <span class="nexbot-msg-avatar" aria-hidden="true">${nexbotMascotMarkup()}</span>
            <span class="nexbot-msg-name">NexBot</span>
            <span class="nexbot-msg-time">mengetik…</span>
        </div>
        <div class="nexbot-msg-content nexbot-typing" role="status" aria-label="NexBot sedang mengetik">
            <span></span><span></span><span></span>
        </div>`;
    body.appendChild(div);
    nexbotScrollToBottom();
    return div;
}

// ===========================================================
// Bootstrap widget
//
// index.html memanggil initNexBotChat() sendiri dari script.js (karena
// urutannya nyambung sama loader halaman). Halaman lain cukup memuat file
// ini: widget-nya disuntik dan langsung siap dipakai.
// ===========================================================
function bootNexBotWidget() {
    ensureNexBotWidget();
    updateNexBotGreeting();
    initNexBotChat();

    document.querySelectorAll(".nexbot-quick-btn").forEach((btn) => {
        btn.addEventListener("click", function () {
            sendNexBotQuick(this.dataset.topic);
        });
    });
}

window.sendNexBotQuick = sendNexBotQuick;
window.bootNexBotWidget = bootNexBotWidget;

// Halaman yang mau widget-nya jalan otomatis tinggal kasih atribut
// data-nexbot="auto" di <body> (dipakai marketplace.html). index.html
// TIDAK memakainya supaya urutan init-nya tetap dikendalikan script.js.
if (document.body && document.body.dataset.nexbot === "auto") {
    bootNexBotWidget();
} else {
    document.addEventListener("DOMContentLoaded", () => {
        if (document.body.dataset.nexbot === "auto") bootNexBotWidget();
    });
}
