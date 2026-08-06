-- Migration 21: Flag enabled setting on store_settings
alter table public.store_settings add column if not exists flag_enabled boolean default true;
