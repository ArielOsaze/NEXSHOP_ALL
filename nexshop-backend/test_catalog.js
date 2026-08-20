const supabase = require("./config/db");
const { isTopupGameCategory } = require("./utils/topupHelpers");

async function run() {
    const { data, error } = await supabase.from("topup_products")
        .select("id, nama, kode_produk, kategori, source_category_name, source_operator_id, source_operator_name, harga_jual, butuh_server_id, source_status, operator_logo, item_icon, manual_category_override, manual_name_override")
        .eq("is_active", true)
        .order("kategori")
        .order("harga_jual");
        
    const { data: mapData } = await supabase.from("topup_category_map").select("*");
    const categoryMap = new Map();
    if (mapData) {
        mapData.forEach(m => categoryMap.set(m.tokovoucher_category_name, m.nexshop_category_name));
    }
    
    const catalogMap = new Map();
    data.forEach(p => {
        if (p.source_status && p.source_status !== 'active') return;
        
        let displayCategory = "Lainnya";
        if (p.manual_category_override) {
            displayCategory = p.kategori || "Lainnya";
        } else if (p.source_category_name && categoryMap.has(p.source_category_name)) {
            displayCategory = categoryMap.get(p.source_category_name);
        } else if (categoryMap.has(p.kategori)) {
            displayCategory = categoryMap.get(p.kategori);
        }
        
        if (displayCategory === 'Gaming') {
            console.log("Found Gaming product! Operator:", p.source_operator_name, "Kategori:", p.kategori);
        }
    });
}
run();
