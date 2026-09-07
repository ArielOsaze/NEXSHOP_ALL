-- Migration 025: harden reseller, wallet, and webhook data access.
--
-- The backend uses the Supabase service role. These tables contain credentials,
-- identity records, payment invoices, balances, and webhook payloads; they must
-- not be directly readable or writable through PostgREST anon/authenticated
-- roles. RLS is enabled as a second safety boundary, with no user-facing
-- policies because all access is intentionally mediated by the backend.
-- Apply manually in Supabase SQL Editor after migrations 009-024.

BEGIN;

ALTER TABLE IF EXISTS public.reseller_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.reseller_portal_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.reseller_portal_2fa ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.reseller_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.reseller_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.wallet_topups ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.webhook_deliveries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.reseller_api_keys FROM anon, authenticated;
REVOKE ALL ON TABLE public.reseller_portal_accounts FROM anon, authenticated;
REVOKE ALL ON TABLE public.reseller_portal_2fa FROM anon, authenticated;
REVOKE ALL ON TABLE public.reseller_applications FROM anon, authenticated;
REVOKE ALL ON TABLE public.reseller_tiers FROM anon, authenticated;
REVOKE ALL ON TABLE public.wallets FROM anon, authenticated;
REVOKE ALL ON TABLE public.wallet_transactions FROM anon, authenticated;
REVOKE ALL ON TABLE public.wallet_topups FROM anon, authenticated;
REVOKE ALL ON TABLE public.webhook_endpoints FROM anon, authenticated;
REVOKE ALL ON TABLE public.webhook_deliveries FROM anon, authenticated;

-- Backend RPCs remain available only to the service role. Removing PUBLIC
-- EXECUTE prevents direct balance mutation through an exposed function.
REVOKE EXECUTE ON FUNCTION public.credit_wallet_atomic(bigint, text, numeric, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.debit_wallet_atomic(bigint, text, numeric, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_wallet_atomic(bigint, text, numeric, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.debit_wallet_atomic(bigint, text, numeric, text, text, text, jsonb) TO service_role;

COMMIT;
