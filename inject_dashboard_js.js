const fs = require('fs');
const path = require('path');
const targetPath = path.join(__dirname, 'nexshop-frontend', 'admin', 'js', 'dashboard.js');
let content = fs.readFileSync(targetPath, 'utf8');

// 1. Add logic to show topSpendersSection
content = content.replace(
    'document.getElementById("promoSection").classList.add("hidden");',
    `document.getElementById("promoSection").classList.add("hidden");
    document.getElementById("topSpendersSection").classList.add("hidden");`
);

content = content.replace(
    'if (menuId === "promo") document.getElementById("promoSection").classList.remove("hidden");',
    `if (menuId === "promo") document.getElementById("promoSection").classList.remove("hidden");
    if (menuId === "topSpenders") {
        document.getElementById("topSpendersSection").classList.remove("hidden");
        loadAdminTopSpenders();
    }`
);

// 2. Append Top Spenders functions
const tsLogic = `
// ==========================================
// TOP SPENDERS (HALL OF FAME)
// ==========================================

let adminTopSpenders = [];

async function loadAdminTopSpenders() {
    try {
        const res = await fetch(\`\${API_BASE}/stats/admin/leaderboard\`, {
            headers: { "Authorization": \`Bearer \${token}\` }
        });
        if (!res.ok) throw new Error("Gagal mengambil data top spenders");
        adminTopSpenders = await res.json();
        renderTopSpendersTable();
    } catch (err) {
        console.error(err);
        Swal.fire("Error", "Gagal mengambil data Top Spenders", "error");
    }
}

function renderTopSpendersTable() {
    const tbody = document.getElementById("topSpendersTableBody");
    if (!tbody) return;
    
    if (adminTopSpenders.length === 0) {
        tbody.innerHTML = \`<tr><td colspan="6" class="text-center py-8 text-gray-500">Belum ada Top Spender manual</td></tr>\`;
        return;
    }

    tbody.innerHTML = adminTopSpenders.map(ts => \`
        <tr class="border-b border-white/5 hover:bg-white/5 transition-colors">
            <td class="py-3 px-4">
                <span class="inline-flex items-center justify-center w-6 h-6 rounded-full bg-gray-800 text-xs font-bold \${ts.rank <= 3 ? 'text-brand-cyan' : 'text-gray-400'}">\${ts.rank}</span>
            </td>
            <td class="py-3 px-4 flex items-center gap-3">
                \${ts.avatar_url ? \`<img src="\${ts.avatar_url}" class="w-8 h-8 rounded-full object-cover">\` : \`<div class="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center"><i class="fa-solid fa-user text-xs text-gray-500"></i></div>\`}
                <div>
                    <div class="font-medium text-white">\${escapeHtml(ts.display_name)}</div>
                </div>
            </td>
            <td class="py-3 px-4">Rp \${Number(ts.total_spending).toLocaleString('id-ID')}</td>
            <td class="py-3 px-4">
                \${ts.badge ? \`<span class="px-2.5 py-1 bg-brand-indigo/20 text-brand-indigo text-xs font-semibold rounded-full border border-brand-indigo/30">\${escapeHtml(ts.badge)}</span>\` : '-'}
            </td>
            <td class="py-3 px-4">
                <span class="px-2 py-1 rounded text-xs font-medium \${ts.is_active ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}">
                    \${ts.is_active ? 'Active' : 'Inactive'}
                </span>
            </td>
            <td class="py-3 px-4 text-right">
                <button onclick="editTopSpender(\${ts.id})" class="text-gray-400 hover:text-brand-cyan transition-colors p-2" title="Edit">
                    <i class="fa-solid fa-pen"></i>
                </button>
                <button onclick="deleteTopSpender(\${ts.id})" class="text-gray-400 hover:text-red-500 transition-colors p-2" title="Hapus">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </td>
        </tr>
    \`).join("");
}

function openTopSpenderModal(id = null) {
    const modal = document.getElementById("topSpenderModal");
    const content = document.getElementById("topSpenderModalContent");
    const title = document.getElementById("topSpenderModalTitle");
    const form = document.getElementById("topSpenderForm");
    
    form.reset();
    document.getElementById("tsId").value = "";
    document.getElementById("tsActive").checked = true;
    document.getElementById("tsRank").value = "99";

    if (id) {
        title.textContent = "Edit Top Spender";
        const ts = adminTopSpenders.find(t => t.id === id);
        if (ts) {
            document.getElementById("tsId").value = ts.id;
            document.getElementById("tsName").value = ts.display_name;
            document.getElementById("tsTotal").value = ts.total_spending;
            document.getElementById("tsAvatar").value = ts.avatar_url || "";
            document.getElementById("tsBadge").value = ts.badge || "";
            document.getElementById("tsRank").value = ts.rank || 99;
            document.getElementById("tsActive").checked = ts.is_active;
        }
    } else {
        title.textContent = "Tambah Top Spender";
    }
    
    modal.classList.remove("hidden");
    setTimeout(() => {
        content.classList.remove("scale-95", "opacity-0");
    }, 10);
}

function closeTopSpenderModal() {
    const modal = document.getElementById("topSpenderModal");
    const content = document.getElementById("topSpenderModalContent");
    content.classList.add("scale-95", "opacity-0");
    setTimeout(() => {
        modal.classList.add("hidden");
    }, 300);
}

async function handleTopSpenderSubmit(e) {
    e.preventDefault();
    const id = document.getElementById("tsId").value;
    const payload = {
        display_name: document.getElementById("tsName").value.trim(),
        total_spending: parseFloat(document.getElementById("tsTotal").value),
        avatar_url: document.getElementById("tsAvatar").value.trim(),
        badge: document.getElementById("tsBadge").value.trim(),
        rank: parseInt(document.getElementById("tsRank").value) || 99,
        is_active: document.getElementById("tsActive").checked
    };

    try {
        const url = id ? \`\${API_BASE}/stats/admin/leaderboard/\${id}\` : \`\${API_BASE}/stats/admin/leaderboard\`;
        const method = id ? "PUT" : "POST";
        
        const res = await fetch(url, {
            method,
            headers: { 
                "Content-Type": "application/json",
                "Authorization": \`Bearer \${token}\`
            },
            body: JSON.stringify(payload)
        });
        
        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.message || "Gagal menyimpan");
        }
        
        Swal.fire({
            icon: "success",
            title: "Berhasil",
            text: "Top Spender berhasil disimpan",
            background: '#0f172a',
            color: '#fff',
            confirmButtonColor: '#8b5cf6'
        });
        
        closeTopSpenderModal();
        loadAdminTopSpenders();
    } catch (err) {
        Swal.fire("Error", err.message, "error");
    }
}

function editTopSpender(id) {
    openTopSpenderModal(id);
}

async function deleteTopSpender(id) {
    const result = await Swal.fire({
        title: 'Hapus Top Spender?',
        text: "Data ini tidak dapat dikembalikan",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#3b82f6',
        confirmButtonText: 'Ya, Hapus!',
        cancelButtonText: 'Batal',
        background: '#0f172a',
        color: '#fff'
    });

    if (result.isConfirmed) {
        try {
            const res = await fetch(\`\${API_BASE}/stats/admin/leaderboard/\${id}\`, {
                method: "DELETE",
                headers: { "Authorization": \`Bearer \${token}\` }
            });
            if (!res.ok) throw new Error("Gagal menghapus");
            
            Swal.fire({
                icon: "success",
                title: "Terhapus",
                background: '#0f172a',
                color: '#fff',
                confirmButtonColor: '#8b5cf6'
            });
            loadAdminTopSpenders();
        } catch (err) {
            Swal.fire("Error", "Gagal menghapus Top Spender", "error");
        }
    }
}
`;

if (!content.includes('loadAdminTopSpenders')) {
    content += '\n' + tsLogic;
}

fs.writeFileSync(targetPath, content);
console.log("Replaced dashboard.js");
