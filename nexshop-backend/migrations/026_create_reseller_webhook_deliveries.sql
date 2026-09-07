-- Migration 026: durable direct reseller webhook delivery queue.
--
-- Direct reseller callbacks must survive request completion and backend
-- restarts. The queue stores payloads, not webhook secrets; the active secret
-- is read from reseller_api_keys at send time.

CREATE TABLE IF NOT EXISTS public.reseller_webhook_deliveries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reseller_user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    order_id TEXT NOT NULL,
    event TEXT NOT NULL DEFAULT 'transaction.updated',
    dedup_key TEXT NOT NULL,
    payload JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    next_retry_at TIMESTAMPTZ,
    response_status INTEGER,
    response_body TEXT,
    last_error TEXT,
    locked_at TIMESTAMPTZ,
    lock_token TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT reseller_webhook_deliveries_status_check
        CHECK (status IN ('pending', 'sending', 'success', 'failed', 'dead')),
    CONSTRAINT reseller_webhook_deliveries_dedup_unique
        UNIQUE (reseller_user_id, dedup_key)
);

CREATE INDEX IF NOT EXISTS idx_reseller_webhook_deliveries_retry
    ON public.reseller_webhook_deliveries(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_reseller_webhook_deliveries_order
    ON public.reseller_webhook_deliveries(reseller_user_id, order_id, created_at DESC);

ALTER TABLE public.reseller_webhook_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.reseller_webhook_deliveries FROM anon, authenticated;
GRANT ALL ON TABLE public.reseller_webhook_deliveries TO service_role;
