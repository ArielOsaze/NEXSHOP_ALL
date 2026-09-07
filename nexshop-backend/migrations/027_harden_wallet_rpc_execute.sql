-- Migration 027: remove explicit API-role execution grants from wallet RPCs.
-- Migration 025 closes PUBLIC, but an explicit role grant survives a PUBLIC
-- revoke and must be removed directly.
REVOKE EXECUTE ON FUNCTION public.credit_wallet_atomic(bigint, text, numeric, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.debit_wallet_atomic(bigint, text, numeric, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_wallet_atomic(bigint, text, numeric, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.debit_wallet_atomic(bigint, text, numeric, text, text, text, jsonb) TO service_role;
