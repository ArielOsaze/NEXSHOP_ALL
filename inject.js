const fs = require('fs');

let code = fs.readFileSync('nexshop-frontend/script.js', 'utf8');

// 1. Modifikasi openGameDetail
let oldOpen1 = 'function openGameDetail(kategori) {';
let newOpen1 = `function openGameDetail(kategori, overrideGame = null, returnView = 'grid', preselectProductId = null) {`;
code = code.replace(oldOpen1, newOpen1);

let oldOpen2 = 'const game = TOPUP_GAMES.find(g => g.kategori === kategori);';
let newOpen2 = `const game = overrideGame || TOPUP_GAMES.find(g => g.kategori === kategori);`;
code = code.replace(oldOpen2, newOpen2);

let oldOpen3 = 'promo: null\r\n    };';
let oldOpen3Lf = 'promo: null\n    };';
let newOpen3 = `promo: null,\n        returnView: returnView\n    };`;
if (code.includes(oldOpen3)) code = code.replace(oldOpen3, newOpen3);
else code = code.replace(oldOpen3Lf, newOpen3);

let oldOpen4 = 'goToTwStep(1);\r\n    document.getElementById("topupGameGrid").classList.add("hidden");';
let oldOpen4Lf = 'goToTwStep(1);\n    document.getElementById("topupGameGrid").classList.add("hidden");';
let newOpen4 = `
    if (preselectProductId) {
        const product = game.products.find(p => p.kode_produk === preselectProductId);
        if (product) selectTwProduct(product);
    }
    goToTwStep(1);
    
    document.getElementById("topupGameGrid").classList.add("hidden");
    document.getElementById("topupSearchFilter").classList.add("hidden");
    
    const oneStopView = document.getElementById("view-onestop");
    if (oneStopView) oneStopView.classList.add("hidden");
`;
if (code.includes(oldOpen4)) code = code.replace(oldOpen4, newOpen4);
else code = code.replace(oldOpen4Lf, newOpen4);


// 2. Modifikasi closeGameDetail
let oldClose1 = `function closeGameDetail() {
    document.getElementById("topupDetail").classList.add("hidden");
    document.getElementById("topupGameGrid").classList.remove("hidden");
    document.getElementById("topupSearchFilter").classList.remove("hidden");
    document.getElementById("topupSearchInput").value = "";
    topupSearchQuery = "";
    renderTopupGameGrid();
    window.scrollTo({ top: document.getElementById("topupGameGrid").offsetTop - 100, behavior: "smooth" });
}`;
let oldClose1Lf = oldClose1.replace(/\r\n/g, '\n');

let newClose1 = `function closeGameDetail() {
    document.getElementById("topupDetail").classList.add("hidden");
    
    if (twState.returnView === 'onestop') {
        const oneStopView = document.getElementById("view-onestop");
        if (oneStopView) oneStopView.classList.remove("hidden");
        window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
        document.getElementById("topupGameGrid").classList.remove("hidden");
        document.getElementById("topupSearchFilter").classList.remove("hidden");
        document.getElementById("topupSearchInput").value = "";
        topupSearchQuery = "";
        renderTopupGameGrid();
        window.scrollTo({ top: document.getElementById("topupGameGrid").offsetTop - 100, behavior: "smooth" });
    }
}`;

if (code.includes(oldClose1)) code = code.replace(oldClose1, newClose1);
else code = code.replace(oldClose1Lf, newClose1);

// 3. Tambahkan OneStopCatalog Code ke Bawah

const oneStopCode = `

// ==========================================
// ONE STOP SOLUTION
// ==========================================

let oneStopCatalog = [];
let oneStopActiveCategory = "Semua";
let oneStopSearchQuery = "";

async function loadOneStopCatalog() {
    const grid = document.getElementById("oneStopOperatorGrid");
    if (!grid) return;
    
    grid.innerHTML = Array(12).fill(\`
        <div class="glass-panel p-4 rounded-2xl flex flex-col items-center justify-center animate-pulse gap-3 border border-white/5">
            <div class="w-16 h-16 sm:w-20 sm:h-20 bg-gray-200 dark:bg-white/10 rounded-full"></div>
            <div class="w-3/4 h-4 bg-gray-200 dark:bg-white/10 rounded"></div>
            <div class="w-1/2 h-3 bg-gray-200 dark:bg-white/10 rounded mt-1"></div>
        </div>
    \`).join("");

    try {
        const response = await fetch(\`\${API_BASE}/topup/public-catalog\`);
        if (!response.ok) throw new Error("Gagal mengambil katalog.");
        const data = await response.json();
        
        if (Array.isArray(data)) {
            oneStopCatalog = data;
        } else {
            console.error("Invalid catalog format:", data);
            oneStopCatalog = [];
        }

        renderOneStopCategories();
        renderOneStopOperators();

    } catch (err) {
        console.error("Error loading one-stop catalog:", err);
        grid.innerHTML = \`
            <div class="col-span-full text-center py-12">
                <div class="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mx-auto mb-4 text-red-500">
                    <span class="material-symbols-outlined text-3xl">error</span>
                </div>
                <h3 class="text-xl font-bold text-gray-900 dark:text-white mb-2">Gagal Memuat Katalog</h3>
                <p class="text-gray-500 dark:text-gray-400">Silakan periksa koneksi internet atau refresh halaman.</p>
            </div>
        \`;
    }
}

function renderOneStopCategories() {
    const nav = document.getElementById("oneStopCategoryNav");
    if (!nav) return;

    const categories = ["Semua", ...oneStopCatalog.map(c => c.category)];

    nav.innerHTML = categories.map(cat => {
        const isActive = cat === oneStopActiveCategory;
        const baseClass = "px-5 py-2.5 rounded-full font-bold text-sm transition-all whitespace-nowrap cursor-pointer";
        const activeClass = "bg-brand-indigo text-white shadow-lg shadow-brand-indigo/30";
        const inactiveClass = "bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10";
        
        return \`<div class="\${baseClass} \${isActive ? activeClass : inactiveClass}" data-category="\${cat}">\${cat}</div>\`;
    }).join("");

    nav.querySelectorAll("div[data-category]").forEach(el => {
        el.addEventListener("click", () => {
            oneStopActiveCategory = el.dataset.category;
            renderOneStopCategories();
            renderOneStopOperators();
        });
    });
}

function renderOneStopOperators() {
    const grid = document.getElementById("oneStopOperatorGrid");
    if (!grid) return;

    let html = "";
    let matchCount = 0;
    const queryTokens = oneStopSearchQuery.toLowerCase().trim().split(/\\s+/).filter(t => t);

    function matchesQuery(text) {
        if (!queryTokens.length) return true;
        if (!text) return false;
        const lowerText = text.toLowerCase();
        return queryTokens.every(token => lowerText.includes(token));
    }

    oneStopCatalog.forEach(categoryObj => {
        if (oneStopActiveCategory !== "Semua" && categoryObj.category !== oneStopActiveCategory) return;

        let categoryHtml = "";

        categoryObj.operators.forEach(op => {
            const matchCategory = matchesQuery(categoryObj.category);
            const matchOperator = matchesQuery(op.operator);
            
            const fallbackIcon = \`<span class="material-symbols-outlined text-4xl text-gray-400">sports_esports</span>\`;
            const imgHtml = op.operator_logo 
                ? \`<img src="\${safeUrl(op.operator_logo)}" alt="\${op.operator}" onerror="this.outerHTML='\${fallbackIcon}'" class="w-full h-full object-contain drop-shadow-lg" loading="lazy">\`
                : fallbackIcon;

            const opData = JSON.stringify({
                operator: op.operator,
                operator_logo: op.operator_logo,
                products: op.products
            }).replace(/'/g, "&#39;");

            if (matchCategory || matchOperator) {
                matchCount++;
                let minPrice = null;
                op.products.forEach(p => {
                    if (p.harga_jual !== undefined && p.harga_jual !== null) {
                        if (minPrice === null || p.harga_jual < minPrice) minPrice = p.harga_jual;
                    }
                });
                const priceHtml = minPrice !== null 
                    ? \`<div class="font-bold text-transparent bg-clip-text bg-gradient-to-r from-brand-indigo to-brand-cyan text-[clamp(0.65rem,2vw,0.85rem)]">Mulai \${rupiah(minPrice)}</div>\`
                    : \`<div></div>\`;

                categoryHtml += \`
                    <div class="one-stop-card group glass-panel rounded-2xl p-4 flex flex-col items-center text-center cursor-pointer hover:-translate-y-1 transition-all hover:shadow-xl hover:border-brand-indigo/30 relative overflow-hidden" data-operator='\${opData}'>
                        <div class="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-white dark:bg-[#0a0a0c] p-2 flex items-center justify-center mb-3 shadow-md border border-gray-100 dark:border-white/5 relative z-10 group-hover:scale-110 transition-transform">
                            \${imgHtml}
                        </div>
                        <h4 class="font-bold text-gray-900 dark:text-white text-[clamp(0.75rem,2.5vw,0.95rem)] leading-tight mb-1 relative z-10 line-clamp-2">\${op.operator}</h4>
                        <div class="text-[clamp(0.65rem,2vw,0.75rem)] text-gray-500 font-semibold mb-2 relative z-10">\${op.products.length} Produk</div>
                        <div class="mt-auto w-full pt-3 border-t border-gray-200 dark:border-white/10 flex justify-between items-center relative z-10">
                            \${priceHtml}
                            <div class="w-6 h-6 rounded-full bg-gray-100 dark:bg-white/5 flex items-center justify-center text-gray-600 dark:text-gray-300 group-hover:bg-brand-indigo group-hover:text-white transition-colors shrink-0">
                                <span class="material-symbols-outlined text-sm">arrow_forward</span>
                            </div>
                        </div>
                    </div>
                \`;
            } else if (queryTokens.length > 0) {
                const matchedProducts = op.products.filter(p => matchesQuery(p.nama));
                if (matchedProducts.length > 0) {
                    matchedProducts.forEach(p => {
                        matchCount++;
                        categoryHtml += \`
                            <div class="one-stop-card group glass-panel rounded-2xl p-4 flex flex-col cursor-pointer hover:-translate-y-1 transition-all hover:shadow-xl hover:border-brand-indigo/30 relative overflow-hidden text-left" data-operator='\${opData}' data-product='\${escapeHtml(p.kode_produk)}'>
                                <div class="flex items-center gap-3 mb-3 relative z-10">
                                    <div class="w-10 h-10 rounded-xl bg-white dark:bg-[#0a0a0c] p-1.5 shadow-sm border border-gray-100 dark:border-white/5 shrink-0">
                                        \${imgHtml}
                                    </div>
                                    <div>
                                        <div class="text-[10px] text-brand-indigo dark:text-brand-cyan font-bold uppercase tracking-wider mb-0.5">\${op.operator}</div>
                                        <h4 class="font-bold text-gray-900 dark:text-white text-sm leading-tight line-clamp-2">\${p.nama}</h4>
                                    </div>
                                </div>
                                <div class="mt-auto w-full pt-3 border-t border-gray-200 dark:border-white/10 flex justify-between items-center relative z-10">
                                    <div class="font-bold text-gray-900 dark:text-white">\${rupiah(p.harga_jual)}</div>
                                    <div class="w-6 h-6 rounded-full bg-gray-100 dark:bg-white/5 flex items-center justify-center text-gray-600 dark:text-gray-300 group-hover:bg-brand-indigo group-hover:text-white transition-colors shrink-0">
                                        <span class="material-symbols-outlined text-sm">arrow_forward</span>
                                    </div>
                                </div>
                            </div>
                        \`;
                    });
                }
            }
        });

        if (categoryHtml) {
            if (oneStopActiveCategory === "Semua" && queryTokens.length === 0) {
                html += \`
                    <div class="col-span-full mt-6 mb-2">
                        <h3 class="text-xl font-black text-gray-900 dark:text-white uppercase tracking-widest">\${categoryObj.category}</h3>
                        <div class="w-12 h-1 bg-brand-cyan mt-1"></div>
                    </div>
                \`;
            }
            html += categoryHtml;
        }
    });

    if (matchCount === 0) {
        html = \`
            <div class="col-span-full flex flex-col items-center justify-center py-16 text-center">
                <div class="w-20 h-20 bg-gray-100 dark:bg-white/5 rounded-full flex items-center justify-center mb-4">
                    <span class="material-symbols-outlined text-4xl text-gray-400">search_off</span>
                </div>
                <h3 class="text-xl font-bold text-gray-900 dark:text-white mb-2">Yah, layanan yang kamu cari belum ditemukan.</h3>
                <p class="text-gray-500 dark:text-gray-400 max-w-md">Coba cari dengan kata kunci lain atau pilih kategori yang tersedia.</p>
            </div>
        \`;
    }

    grid.innerHTML = html;

    grid.querySelectorAll('.one-stop-card').forEach(card => {
        card.addEventListener('click', () => {
            try {
                const operatorData = JSON.parse(card.dataset.operator);
                const productId = card.dataset.product || null;
                
                const fakeGame = {
                    kategori: operatorData.operator,
                    logo: operatorData.operator_logo,
                    products: operatorData.products
                };

                openGameDetail(operatorData.operator, fakeGame, 'onestop', productId);
            } catch (err) {
                console.error("Error parsing operator data:", err);
            }
        });
    });
}

document.addEventListener("DOMContentLoaded", () => {
    const searchInput = document.getElementById("oneStopSearchInput");
    if (searchInput) {
        searchInput.addEventListener("input", (e) => {
            oneStopSearchQuery = e.target.value;
            renderOneStopOperators();
        });
    }
});
`;

code += oneStopCode;

// Finally, make sure loadOneStopCatalog is added to the initialRequests array
let oldBoot = 'loadLeaderboard(),\n        checkPaymentReturn(),\n        initMusicPlayer()';
let oldBootCrLf = 'loadLeaderboard(),\r\n        checkPaymentReturn(),\r\n        initMusicPlayer()';
let newBoot = 'loadLeaderboard(),\n        checkPaymentReturn(),\n        initMusicPlayer(),\n        loadOneStopCatalog()';

if (code.includes(oldBoot)) code = code.replace(oldBoot, newBoot);
else if (code.includes(oldBootCrLf)) code = code.replace(oldBootCrLf, newBoot);

fs.writeFileSync('nexshop-frontend/script.js', code);
console.log("Injected One Stop Solution Code successfully");
