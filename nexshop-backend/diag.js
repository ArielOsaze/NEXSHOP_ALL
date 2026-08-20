const supabase = require("./config/db");

async function runDiagnostics() {
    let allProducts = [];
    let from = 0;
    const pageSize = 1000;
    let fetchMore = true;

    while (fetchMore) {
        const { data, error } = await supabase
            .from("topup_products")
            .select("kategori, source_category_name, source_category_id, source_operator_name, source_operator_id, nama, kode_produk")
            .range(from, from + pageSize - 1);
            
        if (error) throw error;
        
        if (data && data.length > 0) {
            allProducts.push(...data);
            from += pageSize;
            if (data.length < pageSize) fetchMore = false;
        } else {
            fetchMore = false;
        }
    }

    const gamingRecords = allProducts.filter(p => 
        ["gaming", "voucher game", "mobile legends", "mobile legend kios pintar"].includes(String(p.kategori).trim().toLowerCase())
    );

    console.log(`Gaming records: ${gamingRecords.length}`);

    const operatorIds = new Set(gamingRecords.map(p => p.source_operator_id));
    console.log(`Distinct source_operator_id: ${operatorIds.size}`);

    const operatorNames = new Set(gamingRecords.map(p => p.source_operator_name));
    console.log(`Distinct source_operator_name: ${operatorNames.size}`);

    const categoryIds = new Set(gamingRecords.map(p => p.source_category_id));
    console.log(`Distinct source_category_id: ${categoryIds.size}`);

    const groups = {};
    gamingRecords.forEach(p => {
        const key = p.source_operator_name || "Unknown";
        if (!groups[key]) groups[key] = [];
        groups[key].push(p);
    });

    console.log("\nExample groups (source_operator_name):");
    const sortedGroups = Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length);
    for (let i = 0; i < Math.min(10, sortedGroups.length); i++) {
        console.log(`- ${sortedGroups[i]}: ${groups[sortedGroups[i]].length} products. Example: ${groups[sortedGroups[i]][0].nama}`);
    }
}

runDiagnostics().then(() => process.exit(0));
