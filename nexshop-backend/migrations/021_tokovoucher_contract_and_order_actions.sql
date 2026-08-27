-- TokoVoucher product contract + auditable admin order actions.
-- Apply this migration before deploying the code that reads these columns.

ALTER TABLE topup_products ADD COLUMN IF NOT EXISTS source_format_form TEXT;
ALTER TABLE topup_products ADD COLUMN IF NOT EXISTS source_requires_server_id BOOLEAN;
ALTER TABLE topup_orders ADD COLUMN IF NOT EXISTS target_kind TEXT;
ALTER TABLE topup_orders ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS order_admin_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_type TEXT NOT NULL CHECK (order_type IN ('regular', 'topup')),
    order_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('cancel', 'refund')),
    status TEXT NOT NULL CHECK (status IN ('started', 'succeeded', 'failed')),
    admin_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
    reason TEXT,
    amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (order_type, order_id, action)
);

CREATE INDEX IF NOT EXISTS idx_order_admin_actions_order
    ON order_admin_actions(order_type, order_id, created_at DESC);
