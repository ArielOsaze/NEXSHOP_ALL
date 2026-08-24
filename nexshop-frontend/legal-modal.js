// Modal legalitas bersama untuk halaman publik selain beranda.
// Tautan /legalitas tetap menjadi fallback yang bisa dibagikan, tetapi klik
// dari halaman aktif tidak boleh membawa pengunjung kembali ke beranda.
(function initSharedLegalModal() {
    const LEGAL_SELECTOR = 'a[href="/legalitas"], [data-legal-modal]';
    let lastTrigger = null;

    function ensureModal() {
        let overlay = document.getElementById("sharedLegalOverlay");
        if (overlay) return overlay;

        overlay = document.createElement("div");
        overlay.className = "overlay shared-legal-overlay";
        overlay.id = "sharedLegalOverlay";
        overlay.setAttribute("aria-hidden", "true");
        overlay.innerHTML = `
            <div class="modal policy-modal shared-legal-modal" role="dialog" aria-modal="true" aria-labelledby="sharedLegalTitle">
                <button type="button" class="modal-close" data-legal-close aria-label="Tutup informasi legalitas">
                    <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                </button>
                <div class="shared-legal-heading">
                    <span class="shared-legal-mark" aria-hidden="true"><i class="fa-solid fa-scale-balanced"></i></span>
                    <div>
                        <p>Informasi resmi NexShop</p>
                        <h2 id="sharedLegalTitle">Informasi Legalitas</h2>
                    </div>
                </div>
                <p class="shared-legal-intro">NexShop adalah platform layanan marketplace produk digital dan top up game yang terdaftar secara resmi di Indonesia melalui sistem <strong>Online Single Submission (OSS)</strong> Kementerian Investasi/BKPM.</p>
                <dl class="shared-legal-details">
                    <div><dt>Nama Usaha</dt><dd>NexShop</dd></div>
                    <div><dt>NIB</dt><dd><code>1408260072494</code></dd></div>
                    <div><dt>Skala Usaha</dt><dd>Usaha Mikro</dd></div>
                    <div><dt>KBLI</dt><dd>60390 (Aktivitas Situs Jejaring Sosial dan Distribusi Konten Lainnya)</dd></div>
                    <div><dt>Status</dt><dd class="shared-legal-status"><i class="fa-solid fa-circle-check" aria-hidden="true"></i> Aktif &amp; Terverifikasi</dd></div>
                </dl>
                <p class="shared-legal-note">Seluruh kegiatan transaksi dan operasional NexShop tunduk pada hukum yang berlaku di Republik Indonesia. Kami berkomitmen memberikan layanan yang aman, legal, dan mematuhi standar perundang-undangan.</p>
            </div>`;
        document.body.appendChild(overlay);

        overlay.addEventListener("click", (event) => {
            if (event.target === overlay || event.target.closest("[data-legal-close]")) {
                closeModal();
            }
        });
        return overlay;
    }

    function openModal(trigger) {
        const overlay = ensureModal();
        lastTrigger = trigger || document.activeElement;
        overlay.classList.add("active");
        overlay.setAttribute("aria-hidden", "false");
        document.body.classList.add("modal-open");
        overlay.querySelector("[data-legal-close]")?.focus();
    }

    function closeModal() {
        const overlay = document.getElementById("sharedLegalOverlay");
        if (!overlay || !overlay.classList.contains("active")) return;
        overlay.classList.remove("active");
        overlay.setAttribute("aria-hidden", "true");
        document.body.classList.remove("modal-open");
        if (lastTrigger instanceof HTMLElement) lastTrigger.focus();
    }

    document.addEventListener("click", (event) => {
        const trigger = event.target.closest(LEGAL_SELECTOR);
        if (!trigger) return;
        event.preventDefault();
        openModal(trigger);
    });

    document.addEventListener("keydown", (event) => {
        const overlay = document.getElementById("sharedLegalOverlay");
        if (!overlay?.classList.contains("active")) return;
        if (event.key === "Escape") closeModal();
        if (event.key === "Tab") {
            const focusable = [...overlay.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
                .filter((element) => !element.disabled);
            if (!focusable.length) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        }
    });
})();
