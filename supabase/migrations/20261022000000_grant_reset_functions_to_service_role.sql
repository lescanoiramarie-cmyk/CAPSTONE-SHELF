-- ============================================================================
-- GRANT THE RESET FUNCTIONS TO service_role
--
-- The request-password-reset edge function calls these with the service role
-- key and failed with:
--
--   Unable to start the password reset. Please try again.
--
-- Cause:
--
-- `revoke all ... from public, anon, authenticated` removes the EXECUTE grant
-- that PostgreSQL gives to PUBLIC by default on a new function. service_role
-- receives no EXECUTE through PUBLIC once that default is revoked, and unlike
-- the anon bypass, a table-level role bypass does not grant function EXECUTE.
--
-- Every other function in this schema is reachable only because it kept its
-- PUBLIC grant or was granted explicitly to authenticated. These were granted
-- to nobody.
--
-- service_role only, never anon or authenticated: the table holds password reset
-- code hashes and the functions return auth user ids.
-- ============================================================================

grant execute on function public.issue_password_reset_code(text, text, text, timestamptz)
  to service_role;

grant execute on function public.verify_password_reset_code(text, text)
  to service_role;

grant execute on function public.consume_password_reset_code(text)
  to service_role;

grant execute on function public.purge_password_reset_codes()
  to service_role;

notify pgrst, 'reload schema';