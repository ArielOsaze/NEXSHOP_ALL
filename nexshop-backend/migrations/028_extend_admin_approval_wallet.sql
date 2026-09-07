-- Migration 028: allow staff wallet adjustments to use Admin approval.
-- Direct wallet mutation remains Admin/Super Admin only.

ALTER TABLE admin_approval_requests
    DROP CONSTRAINT IF EXISTS admin_approval_requests_request_type_check;

ALTER TABLE admin_approval_requests
    ADD CONSTRAINT admin_approval_requests_request_type_check
    CHECK (request_type IN ('store_settings', 'wallet_adjustment'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_approval_one_pending_per_staff_type
    ON admin_approval_requests(requester_id, request_type)
    WHERE status = 'pending';
