-- NexBot Gemini AI live request logging & performance monitoring table.
-- Run this in Supabase SQL Editor. Safe to run multiple times.

create table if not exists public.ai_gemini_logs (
    id bigint generated always as identity primary key,
    user_message text,
    model_used text not null,
    response_time_ms integer not null default 0,
    token_usage jsonb,
    http_status integer not null default 200,
    is_success boolean not null default false,
    error_message text,
    user_id text,
    session_id text,
    created_at timestamptz not null default now()
);

create index if not exists ai_gemini_logs_created_idx on public.ai_gemini_logs (created_at desc);
create index if not exists ai_gemini_logs_success_idx on public.ai_gemini_logs (is_success, created_at desc);

alter table public.ai_gemini_logs enable row level security;
revoke all on table public.ai_gemini_logs from anon, authenticated;
grant select, insert, update, delete on table public.ai_gemini_logs to service_role;
grant usage, select on all sequences in schema public to service_role;
