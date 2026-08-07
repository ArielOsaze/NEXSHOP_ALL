-- NexBot Multi-AI Provider System (Gemini, Groq, OpenRouter)
-- Migration 23: Provider Settings & Multi-Provider Logs tables.
-- Safe to execute multiple times in Supabase SQL Editor.

create table if not exists public.ai_provider_settings (
    id text primary key,
    provider text not null,
    api_key text default '',
    model text not null,
    enabled boolean not null default true,
    priority integer not null default 1,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- Initial seed for the 3 supported AI providers
insert into public.ai_provider_settings (id, provider, api_key, model, enabled, priority)
values 
    ('gemini', 'Google Gemini', '', 'gemini-flash-latest', true, 1),
    ('groq', 'Groq AI', '', 'llama-3.3-70b-versatile', true, 2),
    ('openrouter', 'OpenRouter', '', 'meta-llama/llama-3.3-70b-instruct', true, 3)
on conflict (id) do nothing;

create table if not exists public.ai_provider_logs (
    id bigint generated always as identity primary key,
    provider text not null,
    model text not null,
    user_prompt text,
    response_text text,
    latency_ms integer not null default 0,
    http_status integer not null default 200,
    token_usage jsonb,
    is_success boolean not null default false,
    error_message text,
    user_id text,
    session_id text,
    created_at timestamptz not null default now()
);

create index if not exists ai_provider_logs_created_idx on public.ai_provider_logs (created_at desc);
create index if not exists ai_provider_logs_provider_idx on public.ai_provider_logs (provider, created_at desc);
create index if not exists ai_provider_logs_success_idx on public.ai_provider_logs (is_success, created_at desc);

alter table public.ai_provider_settings enable row level security;
alter table public.ai_provider_logs enable row level security;

revoke all on table public.ai_provider_settings from anon, authenticated;
revoke all on table public.ai_provider_logs from anon, authenticated;

grant select, insert, update, delete on table public.ai_provider_settings to service_role;
grant select, insert, update, delete on table public.ai_provider_logs to service_role;
grant usage, select on all sequences in schema public to service_role;
