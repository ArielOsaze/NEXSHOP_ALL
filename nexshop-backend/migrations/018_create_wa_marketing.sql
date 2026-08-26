-- Migration 018: WA API management, registered contacts, and throttled campaigns.
-- Apply manually in Supabase SQL Editor before enabling ENABLE_POLLERS=1.

CREATE TABLE IF NOT EXISTS wa_marketing_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    phone_normalized TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL DEFAULT 'Kontak WhatsApp',
    email TEXT,
    marketing_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
    opted_out_at TIMESTAMPTZ,
    last_inbound_at TIMESTAMPTZ,
    last_outbound_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wa_marketing_contacts_user ON wa_marketing_contacts(user_id);
CREATE INDEX IF NOT EXISTS idx_wa_marketing_contacts_optin ON wa_marketing_contacts(marketing_opt_in, opted_out_at);

CREATE TABLE IF NOT EXISTS wa_marketing_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id UUID REFERENCES wa_marketing_contacts(id) ON DELETE SET NULL,
    direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    message_type TEXT NOT NULL DEFAULT 'text',
    body TEXT,
    media_url TEXT,
    provider_message_id TEXT,
    status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'queued', 'sent', 'failed')),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_marketing_messages_provider_id
    ON wa_marketing_messages(provider_message_id)
    WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wa_marketing_messages_contact_time
    ON wa_marketing_messages(contact_id, created_at DESC);

CREATE TABLE IF NOT EXISTS wa_marketing_followups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    source_type TEXT NOT NULL CHECK (source_type IN ('order', 'topup_order')),
    source_id TEXT NOT NULL,
    phone_normalized TEXT NOT NULL,
    product_name TEXT NOT NULL,
    scheduled_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'cancelled')),
    attempts SMALLINT NOT NULL DEFAULT 0,
    last_error TEXT,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_wa_marketing_followups_due
    ON wa_marketing_followups(status, scheduled_at);

CREATE TABLE IF NOT EXISTS wa_marketing_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind TEXT NOT NULL CHECK (kind IN ('promo', 'voucher', 'manual')),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    media_url TEXT,
    promo_code TEXT,
    audience_mode TEXT NOT NULL DEFAULT 'opted_in' CHECK (audience_mode IN ('opted_in', 'all_registered')),
    scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'cancelled')),
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    sent_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wa_marketing_campaigns_due
    ON wa_marketing_campaigns(status, scheduled_at);

CREATE TABLE IF NOT EXISTS wa_marketing_campaign_recipients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES wa_marketing_campaigns(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES wa_marketing_contacts(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'skipped')),
    attempts SMALLINT NOT NULL DEFAULT 0,
    last_error TEXT,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(campaign_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_wa_marketing_campaign_recipients_queue
    ON wa_marketing_campaign_recipients(campaign_id, status);

ALTER TABLE wa_marketing_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_marketing_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_marketing_followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_marketing_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_marketing_campaign_recipients ENABLE ROW LEVEL SECURITY;
