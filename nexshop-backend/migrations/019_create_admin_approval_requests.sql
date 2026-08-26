-- Migration 019: staff change requests with admin approval.
-- Apply manually in Supabase SQL Editor before enabling the approval panel.

CREATE TABLE IF NOT EXISTS admin_approval_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requester_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request_type TEXT NOT NULL CHECK (request_type IN ('store_settings')),
    proposed_changes JSONB NOT NULL DEFAULT '{}'::jsonb,
    request_note TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    review_note TEXT,
    reviewed_at TIMESTAMPTZ,
    applied_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_approval_one_pending_per_staff_type
    ON admin_approval_requests(requester_id, request_type)
    WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_admin_approval_status_created
    ON admin_approval_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_approval_requester_created
    ON admin_approval_requests(requester_id, created_at DESC);

ALTER TABLE admin_approval_requests ENABLE ROW LEVEL SECURITY;

-- Existing notification rows remain visible to admin/staff. New approval rows
-- can be targeted only to admin by the backend using this column.
ALTER TABLE admin_notifications
    ADD COLUMN IF NOT EXISTS recipient_role TEXT NOT NULL DEFAULT 'admin_staff';
CREATE INDEX IF NOT EXISTS idx_admin_notifications_recipient_role
    ON admin_notifications(recipient_role, created_at DESC);
