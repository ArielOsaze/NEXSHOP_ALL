-- NexBot production retrieval, memory, and analytics.
-- Run this once in Supabase SQL Editor after migrations-20. It is safe to run again.

create extension if not exists pg_trgm;

create table if not exists public.knowledge_base (
    id uuid primary key default gen_random_uuid(),
    title text not null,
    category text not null default 'Umum',
    keywords text not null default '',
    content text not null,
    status text not null default 'draft' check (status in ('active', 'inactive', 'draft')),
    priority integer not null default 0 check (priority between 0 and 100),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.knowledge_base
    add column if not exists category text not null default 'Umum',
    add column if not exists keywords text not null default '',
    add column if not exists status text not null default 'draft',
    add column if not exists priority integer not null default 0,
    add column if not exists created_at timestamptz not null default now(),
    add column if not exists updated_at timestamptz not null default now();

create unique index if not exists knowledge_base_title_unique on public.knowledge_base (title);
create index if not exists knowledge_base_active_priority_idx on public.knowledge_base (priority desc) where status = 'active';
create index if not exists knowledge_base_title_trgm_idx on public.knowledge_base using gin (title gin_trgm_ops);
create index if not exists knowledge_base_keywords_trgm_idx on public.knowledge_base using gin (keywords gin_trgm_ops);
create index if not exists knowledge_base_content_trgm_idx on public.knowledge_base using gin (content gin_trgm_ops);
create index if not exists knowledge_base_search_idx on public.knowledge_base using gin (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(keywords, '') || ' ' || coalesce(content, '')));

create table if not exists public.ai_conversations (
    id bigint generated always as identity primary key,
    user_id text,
    session_id text not null,
    role text not null check (role in ('user', 'assistant')),
    message text not null check (char_length(message) <= 2000),
    intent text not null default 'GeneralQuestion',
    knowledge_ids text[] not null default '{}',
    created_at timestamptz not null default now()
);
create index if not exists ai_conversations_session_created_idx on public.ai_conversations (session_id, created_at desc);
create index if not exists ai_conversations_user_created_idx on public.ai_conversations (user_id, created_at desc) where user_id is not null;

create table if not exists public.ai_user_memories (
    user_id text primary key,
    favorite_game text,
    custom_preferences jsonb not null default '{}'::jsonb,
    last_seen_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.ai_query_analytics (
    id bigint generated always as identity primary key,
    normalized_query text not null check (char_length(normalized_query) <= 2000),
    intent text not null,
    entities text[] not null default '{}',
    knowledge_ids text[] not null default '{}',
    response_source text not null check (response_source in ('knowledge', 'handoff')),
    is_failed boolean not null default false,
    user_id text,
    session_id text not null,
    created_at timestamptz not null default now()
);
create index if not exists ai_query_analytics_created_idx on public.ai_query_analytics (created_at desc);
create index if not exists ai_query_analytics_failed_idx on public.ai_query_analytics (created_at desc) where is_failed;

-- Candidate generation only. The Node ranker makes the final intent/entity,
-- semantic (trigram), title, keyword, and priority decision deterministically.
create or replace function public.search_nexbot_knowledge(search_query text, result_limit integer default 80)
returns table (id uuid, title text, category text, keywords text, content text, status text, priority integer, updated_at timestamptz)
language sql stable as $$
    select kb.id, kb.title, kb.category, kb.keywords, kb.content, kb.status, kb.priority, kb.updated_at
    from public.knowledge_base kb
    where kb.status = 'active'
      and (
          to_tsvector('simple', coalesce(kb.title, '') || ' ' || coalesce(kb.keywords, '') || ' ' || coalesce(kb.content, '')) @@ websearch_to_tsquery('simple', search_query)
          or similarity(lower(kb.title || ' ' || kb.keywords), lower(search_query)) > 0.08
      )
    order by greatest(
        ts_rank(to_tsvector('simple', coalesce(kb.title, '') || ' ' || coalesce(kb.keywords, '') || ' ' || coalesce(kb.content, '')), websearch_to_tsquery('simple', search_query)),
        similarity(lower(kb.title || ' ' || kb.keywords), lower(search_query))
    ) desc, kb.priority desc
    limit greatest(1, least(coalesce(result_limit, 80), 250));
$$;

alter table public.knowledge_base enable row level security;
alter table public.ai_conversations enable row level security;
alter table public.ai_user_memories enable row level security;
alter table public.ai_query_analytics enable row level security;
revoke all on table public.knowledge_base, public.ai_conversations, public.ai_user_memories, public.ai_query_analytics from anon, authenticated;
grant select, insert, update, delete on table public.knowledge_base, public.ai_conversations, public.ai_user_memories, public.ai_query_analytics to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on function public.search_nexbot_knowledge(text, integer) to service_role;
