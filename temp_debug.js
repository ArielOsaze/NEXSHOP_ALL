    const grid = document.getElementById("oneStopOperatorGrid");
    if (!grid) return;
    
    // Skeletons while loading
    grid.innerHTML = Array(12).fill(`
        <div class="glass-panel p-4 rounded-2xl flex flex-col items-center justify-center animate-pulse gap-3 border border-white/5">
            <div class="w-16 h-16 sm:w-20 sm:h-20 bg-gray-200 dark:bg-white/10 rounded-full"></div>
            <div class="w-3/4 h-4 bg-gray-200 dark:bg-white/10 rounded"></div>
            <div class="w-1/2 h-3 bg-gray-200 dark:bg-white/10 rounded mt-1"></div>
        </div>
    `).join("");

    try {
        const response = await fetch(`${API_BASE}/topup/public-catalog`);
        if (!response.ok) throw new Error("Gagal mengambil katalog.");