const supabase = require("../config/db");
const tokovoucher = require("../config/tokovoucher");
const { isForeignProduct } = require("../utils/topupHelpers");
const crypto = require("crypto");

let syncLock = false;

// Default category mapping for TokoVoucher categories -> NexShop categories
const DEFAULT_CATEGORY_MAP = {
    "Topup Game": "Topup Game",
    "Games": "Topup Game",
    "Game": "Topup Game",
    "Voucher": "Voucher Game",
    "Voucher Game": "Voucher Game",
    "Hiburan": "Hiburan",
    "Pulsa": "Pulsa",
    "Pulsa Reguler": "Pulsa",
    "Paket Data": "Paket Data",
    "Voucher Data": "Voucher Data",
    "E-Money": "E-Money",
    "E-Wallet": "E-Money",
    "PLN": "PLN",
    "Token PLN": "PLN",
    "E-Toll": "E-Toll",
    "Tagihan": "Tagihan"
};

async function getCategoryMap() {
    try {
        const { data, error } = await supabase.from("topup_category_map").select("tokovoucher_category_name, nexshop_category_name");
        if (error) throw error;
        
        const map = { ...DEFAULT_CATEGORY_MAP };
        data.forEach(row => {
            map[row.tokovoucher_category_name] = row.nexshop_category_name;
        });
        return map;
    } catch (e) {
        console.error("Error fetching category map:", e.message);
        return DEFAULT_CATEGORY_MAP;
    }
}

function normalizeProduct(raw, categoryMap) {
    // Determine the raw fields based on API structure
    const kodeProduk = raw.code || raw.kode_produk || raw.produk || "";
    const name = raw.name || raw.nama || raw.nama_produk || "";
    const rawCategoryName = raw.kategori_nama || raw.kategori || raw.category || raw.category_name || "Lainnya";
    const operatorName = raw.operator_nama || raw.operator || raw.operator_name || raw.brand || "";
    const jenisName = raw.jenis_nama || raw.jenis || raw.jenis_name || raw.type || "";
    const price = parseInt(raw.price || raw.harga || raw.harga_beli || 0, 10);
    const status = raw.status === "aktif" || raw.status === "active" || raw.status === 1 || raw.status === "1" ? "active" : "inactive";
    
    // Server ID requirement heuristic
    const butuhServerId = Boolean(
        raw.is_server_id || 
        raw.butuh_server_id || 
        /mobile legends|free fire|genshin|valorant/i.test(operatorName)
    );

    const nexshopCategory = categoryMap[rawCategoryName] || rawCategoryName;

    return {
        kode_produk: kodeProduk,
        nama: name,
        kategori: nexshopCategory, // The NexShop category or raw category
        harga_beli: price,
        is_active: false, // Default to false when first imported, admin must activate
        source: "tokovoucher",
        source_product_id: raw.id || null,
        source_category_id: raw.kategori_id || raw.category_id || raw.id_kategori || null,
        source_category_name: rawCategoryName,
        source_operator_id: raw.operator_id || raw.id_operator || null,
        source_operator_name: operatorName,
        source_jenis_id: raw.jenis_id || raw.id_jenis || null,
        source_jenis_name: jenisName,
        source_status: status,
        source_last_seen_at: new Date().toISOString(),
        source_raw_hash: crypto.createHash('md5').update(JSON.stringify(raw)).digest('hex'),
        operator_logo: raw.operator_logo || null,
        item_icon: null,
        butuh_server_id: butuhServerId,
        source_missing_count: 0
    };
}

async function fetchCatalogFull() {
    console.log("[CatalogService] Trying /member/produk/full...");
    const response = await tokovoucher.getFullCatalog();
    if (response && response.data && response.data.produk) {
        const catMap = new Map();
        if (Array.isArray(response.data.category)) {
            response.data.category.forEach(c => catMap.set(c.id, c.nama));
        }
        
        const opMap = new Map();
        if (Array.isArray(response.data.operator)) {
            response.data.operator.forEach(o => opMap.set(o.id, { nama: o.nama, logo: o.logo }));
        }

        const jenisMap = new Map();
        if (Array.isArray(response.data.jenis)) {
            response.data.jenis.forEach(j => jenisMap.set(j.id, j.nama));
        }

        const allProducts = [];
        response.data.produk.forEach(p => {
            p.kategori_nama = catMap.get(p.kategori_id) || null;
            const opInfo = opMap.get(p.operator_id);
            p.operator_nama = opInfo ? opInfo.nama : null;
            p.operator_logo = opInfo ? opInfo.logo : null;
            p.jenis_nama = jenisMap.get(p.jenis_id) || null;
            allProducts.push(p);
        });

        return allProducts;
    }
    throw new Error("Full catalog API format unexpected or unavailable.");
}

exports.syncFullCatalog = async (triggerType = 'manual') => {
    if (syncLock) {
        throw new Error("Sync is already running in the background.");
    }
    syncLock = true;
    
    let logId = null;
    try {
        const { data: logData, error: logError } = await supabase.from("catalog_sync_log").insert({
            status: "running",
            trigger_type: triggerType
        }).select().single();
        
        if (!logError && logData) {
            logId = logData.id;
        }

        const categoryMap = await getCategoryMap();
        let rawProducts = [];
        
        try {
            rawProducts = await fetchCatalogFull();
        } catch (e) {
            console.log("[CatalogService] Full API failed:", e.message);
            throw new Error("Failed to fetch full catalog. " + e.message);
        }

        if (!rawProducts || rawProducts.length === 0) {
            throw new Error("No products fetched from supplier.");
        }

        const now = new Date().toISOString();
        let stats = { added: 0, updated: 0, foreign: 0, missing: 0 };
        
        // Fetch existing codes to distinguish add vs update
        const { data: existingData } = await supabase.from("topup_products").select("kode_produk, source_raw_hash, auto_managed, manual_image_override, operator_logo");
        const existingMap = new Map();
        if (existingData) {
            existingData.forEach(p => existingMap.set(p.kode_produk, p));
        }

        const activeBatchCodes = new Set();
        
        // Process in batches
        const BATCH_SIZE = 200;
        let batch = [];
        
        for (const raw of rawProducts) {
            const normalized = normalizeProduct(raw, categoryMap);
            if (!normalized.kode_produk) continue;
            
            // Region filtering
            if (isForeignProduct(normalized.source_category_name, normalized.kode_produk, normalized.nama)) {
                stats.foreign++;
                continue;
            }

            activeBatchCodes.add(normalized.kode_produk);
            
            const existing = existingMap.get(normalized.kode_produk);
            
            // If exists and not auto-managed, we only update source tracking info
            if (existing && existing.auto_managed === false) {
                // Keep the admin overrides intact by omitting them from the update payload
                // Supabase upsert doesn't allow easily "upserting some fields conditionally"
                // Actually, we do an explicit UPDATE for existing ones instead of UPSERT to be safe.
                // Or we do UPSERT but we must fetch all current fields first?
                // For simplicity, we just won't touch the manual fields. We'll do an update.
                
                if (existing.source_raw_hash !== normalized.source_raw_hash) {
                   const updatePayload = {
                        source_product_id: normalized.source_product_id,
                        source_category_id: normalized.source_category_id,
                        source_category_name: normalized.source_category_name,
                        source_operator_id: normalized.source_operator_id,
                        source_operator_name: normalized.source_operator_name,
                        source_jenis_id: normalized.source_jenis_id,
                        source_jenis_name: normalized.source_jenis_name,
                        source_status: normalized.source_status,
                        source_last_seen_at: now,
                        source_last_synced_at: now,
                        source_raw_hash: normalized.source_raw_hash,
                        harga_beli: normalized.harga_beli, // harga beli always updates
                        source_missing_count: 0
                   };
                   
                   // Only update operator_logo if not manually overridden by admin, and if the existing is null or new logo exists
                   if (!existing.manual_image_override && normalized.operator_logo && !existing.operator_logo) {
                       updatePayload.operator_logo = normalized.operator_logo;
                   }
                   
                   await supabase.from("topup_products").update(updatePayload).eq("kode_produk", normalized.kode_produk);
                   stats.updated++;
                } else {
                   // Just update last seen
                   await supabase.from("topup_products").update({
                        source_last_seen_at: now,
                        source_last_synced_at: now,
                        source_missing_count: 0
                   }).eq("kode_produk", normalized.kode_produk);
                }
                
                continue;
            }
            
            if (existing) {
                stats.updated++;
                // If it exists but auto_managed is true, we can just upsert
            } else {
                stats.added++;
            }
            
            batch.push(normalized);
            
            if (batch.length >= BATCH_SIZE) {
                await upsertBatch(batch);
                batch = [];
            }
        }
        
        if (batch.length > 0) {
            await upsertBatch(batch);
        }

        // Handle missing products
        const missingCodes = [];
        for (const [kode] of existingMap) {
            if (!activeBatchCodes.has(kode)) {
                missingCodes.push(kode);
            }
        }
        
        if (missingCodes.length > 0) {
            stats.missing = missingCodes.length;
            // Increment missing count
            await supabase.rpc('increment_missing_count', { product_codes: missingCodes });
        }

        // Complete log
        if (logId) {
            await supabase.from("catalog_sync_log").update({
                completed_at: now,
                status: "success",
                products_found: rawProducts.length,
                products_added: stats.added,
                products_updated: stats.updated,
                products_missing: stats.missing,
                products_skipped_foreign: stats.foreign
            }).eq("id", logId);
        }

        syncLock = false;
        return { success: true, stats, total_found: rawProducts.length };
        
    } catch (error) {
        console.error("[CatalogService] Sync error:", error);
        if (logId) {
            await supabase.from("catalog_sync_log").update({
                completed_at: new Date().toISOString(),
                status: "error",
                error_message: error.message
            }).eq("id", logId);
        }
        syncLock = false;
        throw error;
    }
};

async function upsertBatch(batch) {
    const { error } = await supabase.from("topup_products").upsert(batch, { 
        onConflict: "kode_produk",
        ignoreDuplicates: false
    });
    if (error) {
        console.error("[CatalogService] Error in upsertBatch:", error.message);
    }
}

exports.getSyncStatus = () => {
    return {
        is_running: syncLock
    };
};
