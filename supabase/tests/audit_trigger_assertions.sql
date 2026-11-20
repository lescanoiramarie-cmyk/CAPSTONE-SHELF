CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
BEGIN;
SELECT extensions.plan(1);

-- Read-only catalog assertions for the audit event contract. Runtime DML
-- regression coverage is exercised through the isolated Auth/PostgREST suite.
SELECT extensions.lives_ok($tap$DO $tests$
DECLARE
  v_definition text;
  v_acl_count integer;
BEGIN
  IF pg_catalog.to_regprocedure('public.capture_shelf_audit_event()') IS NULL THEN
    RAISE EXCEPTION 'FAIL: public.capture_shelf_audit_event() is missing.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
    WHERE procedure.oid = 'public.capture_shelf_audit_event()'::regprocedure
      AND procedure.proowner = 'postgres'::regrole::oid
      AND procedure.prokind = 'f'
      AND procedure.pronargs = 0
      AND procedure.prorettype = 'trigger'::regtype::oid
      AND procedure.proretset IS FALSE
      AND procedure.prosecdef IS TRUE
      AND procedure.provolatile = 'v'::"char"
      AND procedure.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog, public, pg_temp']::text[]
      AND language.lanname = 'plpgsql'
  ) THEN
    RAISE EXCEPTION 'FAIL: audit trigger owner, signature, language, security, volatility, or fixed search_path changed.';
  END IF;

  SELECT pg_catalog.pg_get_functiondef('public.capture_shelf_audit_event()'::regprocedure)
    INTO v_definition;

  IF pg_catalog.strpos(v_definition, 'visitor.registration.created') = 0
     OR pg_catalog.strpos(v_definition, 'visitor.registration.verified') = 0
     OR pg_catalog.strpos(v_definition, 'visitor.registration.verification_revoked') = 0
     OR pg_catalog.strpos(v_definition, 'visitor.account.enabled') = 0
     OR pg_catalog.strpos(v_definition, 'visitor.account.disabled') = 0
     OR pg_catalog.strpos(v_definition, 'visitor.registration.deleted') = 0
     OR pg_catalog.strpos(v_definition, 'Audit mapping produced an incomplete event') = 0
     OR pg_catalog.strpos(v_definition, 'No audit mapping exists') = 0 THEN
    RAISE EXCEPTION 'FAIL: visitor action mapping or fail-closed audit validation is incomplete.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.audit_logs'::regclass AND attname = 'action'
      AND attnotnull AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.audit_logs'::regclass AND attname = 'details'
      AND attnotnull AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.audit_logs'::regclass AND conname = 'audit_logs_pkey'
      AND contype = 'p' AND convalidated
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.audit_logs'::regclass AND conname = 'audit_logs_actor_id_fkey'
      AND contype = 'f' AND confrelid = 'auth.users'::regclass AND convalidated
  ) THEN
    RAISE EXCEPTION 'FAIL: audit_logs required action/details/constraints are missing.';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM (VALUES
      ('visitors'::text, 'audit_visitor_registration_insert'::text, 4),
      ('visitors', 'audit_visitor_verification', 16),
      ('visitors', 'audit_visitor_active', 16),
      ('visitors', 'audit_visitor_registration_delete', 8),
      ('borrow_requests', 'audit_borrow_request_insert_delete', 12),
      ('borrow_requests', 'audit_borrow_request_status', 16),
      ('attendance_logs', 'audit_attendance_insert', 4),
      ('attendance_logs', 'audit_attendance_checkout', 16),
      ('books', 'audit_inventory_insert_delete', 12),
      ('books', 'audit_inventory_update', 16),
      ('visitor_feedback', 'audit_feedback_insert_delete', 12),
      ('visitor_feedback', 'audit_feedback_update', 16),
      ('announcements', 'audit_announcement_changes', 28)
    ) AS expected(table_name, trigger_name, event_bits)
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_trigger AS trigger
      JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger.tgrelid
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relname = expected.table_name
        AND trigger.tgname = expected.trigger_name
        AND trigger.tgfoid = 'public.capture_shelf_audit_event()'::regprocedure
        AND trigger.tgenabled = 'O'
        AND (trigger.tgtype & 1) = 1
        AND (trigger.tgtype & 2) = 0
        AND (trigger.tgtype & 60) = expected.event_bits
    )
  ) <> 0 THEN
    RAISE EXCEPTION 'FAIL: expected audit trigger coverage is missing or altered.';
  END IF;

  SELECT pg_catalog.count(*)
    INTO v_acl_count
  FROM pg_catalog.pg_proc AS procedure
  CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl) AS acl
  WHERE procedure.oid = 'public.capture_shelf_audit_event()'::regprocedure;

  IF v_acl_count <> 2
     OR pg_catalog.has_function_privilege('anon', 'public.capture_shelf_audit_event()', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.capture_shelf_audit_event()', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', 'public.capture_shelf_audit_event()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: audit trigger function privileges differ from the reviewed contract.';
  END IF;
END;
$tests$;$tap$, 'audit trigger assertions contract block 1');
SELECT * FROM extensions.finish();
ROLLBACK;
