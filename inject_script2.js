const fs = require('fs');
const path = require('path');
const targetPath = path.join(__dirname, 'nexshop-frontend', 'script.js');
let content = fs.readFileSync(targetPath, 'utf8');

const newLeaderboardCode = `
async function loadLeaderboard() {
    try {
        const res = await fetch(\`\${API_BASE}/stats/leaderboard\`);
        if (!res.ok) throw new Error("Gagal load leaderboard");
        const data = await res.json();
        renderLeaderboard(data);
    } catch (err) {
        console.warn("Leaderboard error:", err);
        const container = document.getElementById("leaderboardContent");
        if (container) container.innerHTML = \`<div class="text-center text-red-400 py-10 glass-panel">Gagal memuat leaderboard</div>\`;
    }
}

function renderLeaderboard(data) {
    const container = document.getElementById('leaderboardContent');
    if (!container) return;

    if (!data || data.length === 0) {
        container.innerHTML = \`<div class="text-center text-gray-500 py-10 glass-panel rounded-2xl">Belum ada Top Spender</div>\`;
        return;
    }

    // Podium: Top 3
    const top3 = data.slice(0, 3);
    const rest = data.slice(3, 10);
    
    let podiumHtml = \`<div class="flex flex-col md:flex-row items-end justify-center gap-4 md:gap-6 lg:gap-10 mb-12 min-h-[300px]"> \`;
    
    // Helper untuk avatar
    const getAvatar = (user) => {
        if (user.avatar_url) return \`<img src="\${user.avatar_url}" class="w-full h-full object-cover">\`;
        return \`<div class="w-full h-full bg-gray-800 flex items-center justify-center text-2xl font-bold text-gray-500"><i class="fa-solid fa-user"></i></div>\`;
    };
    
    // Helper untuk rank badge
    const getRankBadge = (rank) => {
        if (rank === 1) return '<div class="absolute -bottom-4 left-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-gradient-to-br from-amber-300 to-amber-500 border-2 border-gray-900 flex items-center justify-center text-gray-900 font-bold text-sm shadow-[0_0_15px_rgba(251,191,36,0.5)] z-20">1</div>';
        if (rank === 2) return '<div class="absolute -bottom-3 left-1/2 -translate-x-1/2 w-7 h-7 rounded-full bg-gradient-to-br from-slate-300 to-slate-500 border-2 border-gray-900 flex items-center justify-center text-gray-900 font-bold text-xs shadow-lg z-20">2</div>';
        if (rank === 3) return '<div class="absolute -bottom-3 left-1/2 -translate-x-1/2 w-7 h-7 rounded-full bg-gradient-to-br from-orange-400 to-orange-700 border-2 border-gray-900 flex items-center justify-center text-gray-900 font-bold text-xs shadow-lg z-20">3</div>';
        return '';
    };

    // Render Rank 2 (Left)
    if (top3[1]) {
        podiumHtml += \`
        <div class="flex flex-col items-center order-2 md:order-1 w-full md:w-1/3 transform hover:-translate-y-2 transition-transform duration-300">
            <div class="relative w-20 h-20 md:w-24 md:h-24 rounded-full p-1 bg-gradient-to-b from-slate-400 to-gray-800 mb-4 shadow-[0_0_20px_rgba(148,163,184,0.3)]">
                <div class="w-full h-full rounded-full overflow-hidden border-2 border-gray-900 relative z-10 bg-gray-900 aspect-square">
                    \${getAvatar(top3[1])}
                </div>
                \${getRankBadge(2)}
            </div>
            <div class="glass-panel w-full p-4 md:p-6 text-center border-t-4 border-slate-400 relative overflow-hidden group">
                <div class="absolute inset-0 bg-slate-400/5 translate-y-full group-hover:translate-y-0 transition-transform duration-300"></div>
                <div class="font-bold text-white text-lg md:text-xl mb-1 truncate relative z-10">\${escapeHtml(top3[1].name)}</div>
                \${top3[1].badge ? \`<div class="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-brand-indigo/20 text-brand-indigo mb-2 border border-brand-indigo/30 uppercase tracking-wider relative z-10">\${escapeHtml(top3[1].badge)}</div>\` : ''}
                <div class="text-slate-300 font-medium text-sm mt-1 relative z-10">\${rupiah(top3[1].total_spent)}</div>
            </div>
        </div>\`;
    }

    // Render Rank 1 (Center)
    if (top3[0]) {
        podiumHtml += \`
        <div class="flex flex-col items-center order-1 md:order-2 w-full md:w-1/3 transform hover:-translate-y-2 transition-transform duration-300 md:-translate-y-8 z-10">
            <div class="relative w-28 h-28 md:w-36 md:h-36 rounded-full p-1.5 bg-gradient-to-b from-amber-400 via-amber-500 to-gray-800 mb-5 shadow-[0_0_30px_rgba(251,191,36,0.4)]">
                <div class="w-full h-full rounded-full overflow-hidden border-4 border-gray-900 relative z-10 bg-gray-900 aspect-square">
                    \${getAvatar(top3[0])}
                </div>
                \${getRankBadge(1)}
                <div class="absolute -top-6 left-1/2 -translate-x-1/2 text-amber-400 text-3xl animate-bounce">
                    <i class="fa-solid fa-crown drop-shadow-[0_0_10px_rgba(251,191,36,0.8)]"></i>
                </div>
            </div>
            <div class="glass-panel w-full p-5 md:p-8 text-center border-t-4 border-amber-400 relative overflow-hidden group shadow-[0_0_30px_rgba(139,92,246,0.1)]">
                <div class="absolute inset-0 bg-gradient-to-t from-amber-400/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                <div class="font-bold text-white text-xl md:text-2xl mb-1 truncate relative z-10">\${escapeHtml(top3[0].name)}</div>
                \${top3[0].badge ? \`<div class="inline-block px-2.5 py-1 rounded text-xs font-bold bg-amber-400/20 text-amber-400 mb-2 border border-amber-400/30 uppercase tracking-wider relative z-10">\${escapeHtml(top3[0].badge)}</div>\` : ''}
                <div class="text-amber-400 font-bold text-base md:text-lg mt-1 relative z-10">\${rupiah(top3[0].total_spent)}</div>
            </div>
        </div>\`;
    }

    // Render Rank 3 (Right)
    if (top3[2]) {
        podiumHtml += \`
        <div class="flex flex-col items-center order-3 md:order-3 w-full md:w-1/3 transform hover:-translate-y-2 transition-transform duration-300">
            <div class="relative w-20 h-20 md:w-24 md:h-24 rounded-full p-1 bg-gradient-to-b from-orange-600 to-gray-800 mb-4 shadow-[0_0_20px_rgba(234,88,12,0.3)]">
                <div class="w-full h-full rounded-full overflow-hidden border-2 border-gray-900 relative z-10 bg-gray-900 aspect-square">
                    \${getAvatar(top3[2])}
                </div>
                \${getRankBadge(3)}
            </div>
            <div class="glass-panel w-full p-4 md:p-6 text-center border-t-4 border-orange-600 relative overflow-hidden group">
                <div class="absolute inset-0 bg-orange-600/5 translate-y-full group-hover:translate-y-0 transition-transform duration-300"></div>
                <div class="font-bold text-white text-lg md:text-xl mb-1 truncate relative z-10">\${escapeHtml(top3[2].name)}</div>
                \${top3[2].badge ? \`<div class="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-brand-indigo/20 text-brand-indigo mb-2 border border-brand-indigo/30 uppercase tracking-wider relative z-10">\${escapeHtml(top3[2].badge)}</div>\` : ''}
                <div class="text-orange-400 font-medium text-sm mt-1 relative z-10">\${rupiah(top3[2].total_spent)}</div>
            </div>
        </div>\`;
    }
    podiumHtml += \`</div>\`;

    // Render List 4-10
    let listHtml = '';
    if (rest.length > 0) {
        listHtml = \`
        <div class="glass-panel p-4 md:p-6 overflow-hidden max-w-3xl mx-auto">
            <h3 class="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <i class="fa-solid fa-ranking-star text-brand-indigo"></i> Top 10 Spenders
            </h3>
            <div class="space-y-3">
        \`;
        rest.forEach((user, idx) => {
            const rank = idx + 4;
            listHtml += \`
            <div class="flex items-center gap-4 p-3 rounded-xl hover:bg-white/5 transition-colors border border-transparent hover:border-white/5 group">
                <div class="w-8 text-center font-bold text-gray-500 group-hover:text-white transition-colors">#\${rank}</div>
                <div class="w-10 h-10 rounded-full overflow-hidden bg-gray-800 border border-gray-700 aspect-square shrink-0">
                    \${getAvatar(user)}
                </div>
                <div class="flex-1 min-w-0">
                    <div class="font-bold text-white truncate text-sm">\${escapeHtml(user.name)}</div>
                    \${user.badge ? \`<div class="text-[10px] text-brand-cyan uppercase tracking-wide mt-0.5">\${escapeHtml(user.badge)}</div>\` : ''}
                </div>
                <div class="text-right shrink-0">
                    <div class="text-gray-300 font-medium text-sm">\${rupiah(user.total_spent)}</div>
                </div>
            </div>
            \`;
        });
        listHtml += \`</div></div>\`;
    }

    container.innerHTML = podiumHtml + listHtml;
}
`;

const startIndex = content.indexOf('async function loadLeaderboard() {');
const endIndex = content.indexOf('function initNavScroll() {');

if (startIndex !== -1 && endIndex !== -1) {
    const toReplace = content.substring(startIndex, endIndex);
    content = content.replace(toReplace, newLeaderboardCode + '\n');
    fs.writeFileSync(targetPath, content);
    console.log("Replaced script.js loadLeaderboard logic");
} else {
    console.log("Could not find loadLeaderboard in script.js");
}
