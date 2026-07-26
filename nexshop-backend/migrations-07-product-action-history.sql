-- Riwayat aksi bulk di produk topup (markup, status, server id, kategori,
-- icon, hapus) buat fitur Undo/Redo di dashboard admin.
--
-- Cara kerja (model stack standar undo/redo):
-- - Tiap bulk action nyimpen 1 baris di sini: snapshot SEBELUM (before_rows)
--   dan SESUDAH (after_rows) aksi dijalankan.
-- - status='active'  -> aksi ini "berlaku" (bagian dari riwayat masa lalu)
-- - status='undone'  -> aksi ini udah di-undo (jadi bagian "masa depan"/redo)
-- - Undo  = ambil entri 'active' paling baru -> terapkan before_rows -> tandai 'undone'
-- - Redo  = ambil entri 'undone' paling LAMA -> terapkan after_rows  -> tandai 'active'
-- - Begitu ada aksi BARU (bukan undo/redo), semua entri 'undone' dihapus dulu
--   (itu representasi cabang "masa depan" yang jadi gak valid lagi begitu
--   riwayat bercabang -- sama kayak Ctrl+Z lalu ngetik hal baru di editor).
create table if not exists product_action_history (
    id bigserial primary key,
    action text not null,           -- 'markup' | 'auto_markup' | 'status' | 'server_id' | 'kategori' | 'icon' | 'delete'
    label text not null,            -- deskripsi singkat buat ditampilin di tombol/toast undo-redo
    product_ids jsonb not null,     -- array id produk yang kena aksi ini
    before_rows jsonb not null,     -- snapshot sebelum aksi (dipakai pas undo)
    after_rows jsonb,               -- snapshot sesudah aksi (dipakai pas redo); null khusus aksi 'delete'
    status text not null default 'active',
    admin_email text,
    created_at timestamptz not null default now()
);

create index if not exists idx_product_action_history_status_created
    on product_action_history (status, created_at);
