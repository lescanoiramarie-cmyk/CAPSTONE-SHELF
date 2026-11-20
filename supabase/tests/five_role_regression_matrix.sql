-- Executable contract smoke checks for app authorization states. Real signed
-- Auth sessions for each role are exercised by the opt-in PostgREST suite;
-- catalog existence here is not reported as an authorization behavior pass.
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
BEGIN;
SELECT extensions.plan(5);

SELECT extensions.ok(
  to_regprocedure('public.get_current_user_role()') IS NOT NULL,
  'Current-user role resolver is present'
);
SELECT extensions.ok(
  to_regprocedure('public.get_visitor_profile()') IS NOT NULL,
  'Visitor identity/profile RPC is present'
);
SELECT extensions.ok(
  to_regprocedure('public.approve_community_visitor(text)') IS NOT NULL,
  'Community approval workflow RPC is present'
);
SELECT extensions.ok(
  to_regprocedure('public.is_active_staff_for_branch(text)') IS NOT NULL,
  'Branch-scoped staff authorization helper is present'
);
SELECT extensions.ok(
  to_regprocedure('public.is_shelf_superadmin()') IS NOT NULL,
  'Global super-admin authorization helper is present'
);

SELECT * FROM extensions.finish();
ROLLBACK;
