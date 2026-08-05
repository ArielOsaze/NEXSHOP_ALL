-- NexShop — curated gaming-news previews.
-- Run this once in the Supabase SQL editor after the earlier migrations.
-- Only preview metadata is stored; each card links readers to the publisher.

create table if not exists gaming_news (
    id bigserial primary key,
    title varchar(255) not null,
    summary varchar(600) not null,
    source varchar(80) not null,
    source_url text not null unique,
    image_url text not null,
    published_at timestamptz not null,
    is_active boolean not null default true,
    is_hidden boolean not null default false,
    is_pinned boolean not null default false,
    is_featured boolean not null default false,
    sort_order integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_gaming_news_public
    on gaming_news (is_active, is_hidden, is_pinned desc, is_featured desc, published_at desc, sort_order asc);
