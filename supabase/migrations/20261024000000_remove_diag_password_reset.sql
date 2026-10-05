-- Removes the temporary diagnostic function used to identify the undefined
-- variable in issue_password_reset_code. It was executable by anon and must not
-- remain in the schema.
drop function if exists public.diag_issue_password_reset_code(text);

notify pgrst, 'reload schema';