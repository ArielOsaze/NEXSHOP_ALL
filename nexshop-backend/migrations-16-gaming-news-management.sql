-- Tambahan manajemen berita gaming untuk database yang sudah menjalankan
-- migration 15 versi awal. Aman dijalankan ulang di Supabase SQL editor.

alter table gaming_news
    alter column title type varchar(255);

alter table gaming_news
    add column if not exists is_hidden boolean not null default false,
    add column if not exists is_pinned boolean not null default false,
    add column if not exists is_featured boolean not null default false;

create index if not exists idx_gaming_news_public_management
    on gaming_news (is_active, is_hidden, is_pinned desc, is_featured desc, published_at desc, sort_order asc);
