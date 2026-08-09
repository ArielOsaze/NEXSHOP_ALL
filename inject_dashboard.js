const fs = require('fs');
const path = require('path');
const targetPath = path.join(__dirname, 'nexshop-frontend', 'admin', 'dashboard.html');
let content = fs.readFileSync(targetPath, 'utf8');

// Add menu item
const promoMenuStr = `<a href="#" class="flex items-center gap-3 px-4 py-3 rounded-xl text-gray-400 hover:text-white hover:bg-white/5 transition-all group" data-menu="promo">`;
const topSpendersMenu = `<a href="#" class="flex items-center gap-3 px-4 py-3 rounded-xl text-gray-400 hover:text-white hover:bg-white/5 transition-all group" data-menu="topSpenders">
                    <div class="w-8 h-8 rounded-lg bg-gray-800/50 flex items-center justify-center group-hover:bg-brand-indigo/20 group-hover:text-brand-cyan transition-colors">
                        <i class="fa-solid fa-trophy text-sm"></i>
                    </div>
                    <span class="font-medium">Top Spenders</span>
                </a>\n                `;

if (!content.includes('data-menu="topSpenders"')) {
    content = content.replace(promoMenuStr, topSpendersMenu + promoMenuStr);
}

// Add Section
const sectionEndStr = `</main>`;
const topSpendersSection = `
            <!-- Top Spenders Section -->
            <section id="topSpendersSection" class="hidden animate-fade-in">
                <div class="flex justify-between items-center mb-8">
                    <div>
                        <h2 class="text-3xl font-bold text-white mb-1">Top Spenders</h2>
                        <p class="text-gray-400">Kelola Leaderboard / Hall of Fame</p>
                    </div>
                    <button onclick="openTopSpenderModal()" class="px-5 py-2.5 bg-brand-indigo hover:bg-brand-cyan text-white rounded-xl font-medium transition-colors flex items-center gap-2 shadow-lg shadow-brand-indigo/20">
                        <i class="fa-solid fa-plus"></i> Tambah Entry
                    </button>
                </div>
                
                <div class="glass-panel p-6">
                    <div class="overflow-x-auto">
                        <table class="w-full text-left border-collapse">
                            <thead>
                                <tr class="border-b border-white/10 text-gray-400 text-sm">
                                    <th class="pb-4 font-medium px-4">Rank</th>
                                    <th class="pb-4 font-medium px-4">User</th>
                                    <th class="pb-4 font-medium px-4">Total Spending</th>
                                    <th class="pb-4 font-medium px-4">Badge</th>
                                    <th class="pb-4 font-medium px-4">Status</th>
                                    <th class="pb-4 font-medium px-4 text-right">Aksi</th>
                                </tr>
                            </thead>
                            <tbody id="topSpendersTableBody" class="text-sm text-gray-300">
                                <!-- Data injected by JS -->
                            </tbody>
                        </table>
                    </div>
                </div>
            </section>
`;
if (!content.includes('id="topSpendersSection"')) {
    content = content.replace(sectionEndStr, topSpendersSection + sectionEndStr);
}

// Add Modal
const modalsEnd = `    <!-- Modals Container -->`;
const topSpendersModal = `
    <!-- Modal Top Spender -->
    <div id="topSpenderModal" class="fixed inset-0 z-[100] hidden flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-black/60 backdrop-blur-sm modal-backdrop" onclick="closeTopSpenderModal()"></div>
        <div class="glass-panel w-full max-w-lg p-6 relative z-10 scale-95 opacity-0 transition-all duration-300" id="topSpenderModalContent">
            <h3 class="text-xl font-bold text-white mb-6" id="topSpenderModalTitle">Tambah Top Spender</h3>
            <form id="topSpenderForm" onsubmit="handleTopSpenderSubmit(event)" class="space-y-4">
                <input type="hidden" id="tsId">
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="block text-sm text-gray-400 mb-1">Display Name *</label>
                        <input type="text" id="tsName" required class="w-full bg-gray-900/50 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:border-brand-cyan focus:outline-none focus:ring-1 focus:ring-brand-cyan transition-colors">
                    </div>
                    <div>
                        <label class="block text-sm text-gray-400 mb-1">Rank (Posisi) *</label>
                        <input type="number" id="tsRank" required min="1" value="99" class="w-full bg-gray-900/50 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:border-brand-cyan focus:outline-none transition-colors">
                    </div>
                </div>
                <div>
                    <label class="block text-sm text-gray-400 mb-1">Total Spending (Rp) *</label>
                    <input type="number" id="tsTotal" required min="0" class="w-full bg-gray-900/50 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:border-brand-cyan focus:outline-none transition-colors">
                </div>
                <div>
                    <label class="block text-sm text-gray-400 mb-1">Avatar URL (Opsional)</label>
                    <input type="url" id="tsAvatar" class="w-full bg-gray-900/50 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:border-brand-cyan focus:outline-none transition-colors" placeholder="https://...">
                </div>
                <div>
                    <label class="block text-sm text-gray-400 mb-1">Badge (Opsional, ex: VIP, SULTAN)</label>
                    <input type="text" id="tsBadge" class="w-full bg-gray-900/50 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:border-brand-cyan focus:outline-none transition-colors">
                </div>
                <div class="flex items-center gap-3">
                    <input type="checkbox" id="tsActive" checked class="w-5 h-5 rounded border-white/10 bg-gray-900/50 text-brand-cyan focus:ring-brand-cyan focus:ring-offset-gray-900">
                    <label class="text-sm text-gray-300">Tampilkan di Leaderboard (Active)</label>
                </div>
                <div class="flex gap-3 pt-4 border-t border-white/10">
                    <button type="button" onclick="closeTopSpenderModal()" class="flex-1 px-4 py-2.5 rounded-xl text-gray-400 hover:text-white hover:bg-white/5 transition-colors font-medium">Batal</button>
                    <button type="submit" class="flex-1 px-4 py-2.5 rounded-xl bg-brand-indigo hover:bg-brand-cyan text-white transition-colors font-medium">Simpan</button>
                </div>
            </form>
        </div>
    </div>
`;

if (!content.includes('id="topSpenderModal"')) {
    content = content.replace(modalsEnd, topSpendersModal + modalsEnd);
}

fs.writeFileSync(targetPath, content);
console.log("Replaced dashboard.html");
