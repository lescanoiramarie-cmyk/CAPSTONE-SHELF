-- Removes the temporary diagnostic functions created while testing the password
-- reset flow. They were executable by anon and must not remain in the schema.
--
-- public.diag_recover_reset_code was the most serious of these: because a reset
-- code is only 6 digits, it brute-forced the stored SHA-256 hash to hand back a
-- working code. That is only acceptable as a disposable test helper.
--
-- The password reset flow itself needs none of these:
--   * password_reset_codes has RLS enabled with no policies, so it is already
--     reachable only by service_role, and
--   * verify_password_reset_code locks an address after 5 failed attempts, so a
--     code cannot be probed through the API.
drop function if exists public.diag_recover_reset_code(text, text);
drop function if exists public.diag_read_reset_code(text);
drop function if exists public.diag_issue_reason(text);
drop function if exists public.diag_reset_rows(text);

notify pgrst, 'reload schema';