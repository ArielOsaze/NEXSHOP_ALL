-- NexShop Gaming News detail experience.
-- Jalankan setelah migrations-17 dan aman ditempel ulang di Supabase SQL Editor.

alter table public.gaming_news
    add column if not exists tags text[] not null default '{}'::text[];

-- Versi awal News Manager membatasi teaser 80–150 kata. Detail NexShop kini
-- membutuhkan ringkasan editorial 300–600 kata. NOT VALID menjaga arsip lama
-- tetap terbaca sambil semua artikel baru mengikuti standar baru.
alter table public.gaming_news
    drop constraint if exists gaming_news_summary_word_count;

alter table public.gaming_news
    add constraint gaming_news_summary_word_count
    check (cardinality(regexp_split_to_array(btrim(summary), '\s+')) between 300 and 600) not valid;

create index if not exists gaming_news_tags_idx
    on public.gaming_news using gin (tags);
