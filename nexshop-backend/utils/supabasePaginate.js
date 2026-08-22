// ===========================================================
// PAGINASI SUPABASE — PostgREST (yang dipakai Supabase) DIAM-DIAM
// motong hasil SELECT di 1000 baris. Query kayak
// `supabase.from("topup_products").select("*")` KELIHATANNYA ngambil
// semua, padahal cuma balikin 1000 baris pertama tanpa error apa pun.
//
// Ini bikin bug senyap yang parah: dashboard admin cuma "lihat" 1000 dari
// 11.000+ produk (jadi filter kategori/operator kelihatan kosong), dan
// statistik omzet salah begitu jumlah order lewat 1000.
//
// Pakai fetchAllRows() di SEMUA tempat yang beneran butuh seluruh tabel.
// ===========================================================

const DEFAULT_PAGE_SIZE = 1000;

// buildQuery: (from, to) => PostgrestFilterBuilder yang UDAH di-.range(from, to)
// dipanggil berulang sampai halaman terakhir (jumlah baris < pageSize).
async function fetchAllRows(buildQuery, { pageSize = DEFAULT_PAGE_SIZE, maxRows = 200000 } = {}) {
    const rows = [];
    let from = 0;

    while (from < maxRows) {
        const { data, error } = await buildQuery(from, from + pageSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;

        rows.push(...data);
        if (data.length < pageSize) break;
        from += pageSize;
    }

    return rows;
}

module.exports = { fetchAllRows, DEFAULT_PAGE_SIZE };
