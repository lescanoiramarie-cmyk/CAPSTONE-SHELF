-- Restore visitor audit handling lost when the shared trigger function was
-- replaced in 20261229000000/20261231000000. Keep the existing trigger
-- attachments and event contracts; fail the source write if an event cannot
-- be represented completely.
BEGIN;

DO $preflight$
DECLARE
  v_acl_count integer;
BEGIN
  IF pg_catalog.to_regprocedure('public.capture_shelf_audit_event()') IS NULL THEN
    RAISE EXCEPTION 'Required public.capture_shelf_audit_event() function is missing.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
    WHERE procedure.oid = 'public.capture_shelf_audit_event()'::regprocedure
      AND procedure.proowner = 'postgres'::regrole
      AND language.lanname = 'plpgsql'
      AND procedure.prorettype = 'trigger'::regtype
      AND procedure.pronargs = 0
      AND procedure.prosecdef
      AND procedure.provolatile = 'v'
      AND procedure.proconfig = ARRAY['search_path=public']::text[]
  ) THEN
    RAISE EXCEPTION 'Audit trigger function metadata differs from the reviewed baseline.';
  END IF;

  SELECT pg_catalog.count(*)
    INTO v_acl_count
  FROM pg_catalog.pg_proc AS procedure
  CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl) AS acl
  WHERE procedure.oid = 'public.capture_shelf_audit_event()'::regprocedure;

  IF v_acl_count <> 2
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_proc AS procedure
       CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl) AS acl
       WHERE procedure.oid = 'public.capture_shelf_audit_event()'::regprocedure
         AND acl.grantee = 'postgres'::regrole
         AND acl.grantor = 'postgres'::regrole
         AND acl.privilege_type = 'EXECUTE'
         AND NOT acl.is_grantable
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_proc AS procedure
       CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl) AS acl
       WHERE procedure.oid = 'public.capture_shelf_audit_event()'::regprocedure
         AND acl.grantee = 'service_role'::regrole
         AND acl.grantor = 'postgres'::regrole
         AND acl.privilege_type = 'EXECUTE'
         AND NOT acl.is_grantable
     ) THEN
    RAISE EXCEPTION 'Audit trigger function direct ACL differs from the reviewed owner/service_role grants.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.audit_logs'::regclass
      AND attribute.attname = 'action'
      AND attribute.attnotnull
      AND NOT attribute.attisdropped
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.audit_logs'::regclass
      AND attribute.attname = 'details'
      AND attribute.attnotnull
      AND NOT attribute.attisdropped
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    JOIN pg_catalog.pg_attrdef AS default_value
      ON default_value.adrelid = attribute.attrelid
     AND default_value.adnum = attribute.attnum
    WHERE attribute.attrelid = 'public.audit_logs'::regclass
      AND attribute.attname = 'details'
      AND pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid) = '''{}''::jsonb'
      AND NOT attribute.attisdropped
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    JOIN pg_catalog.pg_attrdef AS default_value
      ON default_value.adrelid = attribute.attrelid
     AND default_value.adnum = attribute.attnum
    WHERE attribute.attrelid = 'public.audit_logs'::regclass
      AND attribute.attname = 'created_at'
      AND attribute.attnotnull
      AND pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid) = 'now()'
      AND NOT attribute.attisdropped
  ) THEN
    RAISE EXCEPTION 'audit_logs action/details/timestamp requirements differ from the reviewed schema.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.audit_logs'::regclass
      AND conname = 'audit_logs_pkey'
      AND contype = 'p'
      AND convalidated
      AND NOT condeferrable
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.audit_logs'::regclass
      AND conname = 'audit_logs_actor_id_fkey'
      AND contype = 'f'
      AND confrelid = 'auth.users'::regclass
      AND convalidated
  ) THEN
    RAISE EXCEPTION 'audit_logs primary key or actor foreign key differs from the reviewed schema.';
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
    RAISE EXCEPTION 'Expected audit trigger coverage is incomplete or differs from the reviewed operations.';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.capture_shelf_audit_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  branch_value text;
  event_action text;
  event_details jsonb;
  request_row public.borrow_requests%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'borrow_requests' THEN
    -- Preserve the explicit synthetic-seed cleanup exception from the
    -- established audit contract. Normal borrow-request deletions are logged.
    IF TG_OP = 'DELETE'
       AND OLD.confirmed_by = 'Test data seed'
       AND OLD.return_confirmed_by = 'Test data seed' THEN
      RETURN OLD;
    END IF;

    IF TG_OP = 'DELETE' THEN
      request_row := OLD;
    ELSIF TG_OP IN ('INSERT', 'UPDATE') THEN
      request_row := NEW;
    ELSE
      RAISE EXCEPTION 'Unsupported audit operation % on %.', TG_OP, TG_TABLE_NAME;
    END IF;

    SELECT book.library_id::text INTO branch_value
    FROM public.books AS book
    WHERE book.id::text = request_row.book_id::text;
    event_action := 'circulation.borrow_request.' || pg_catalog.lower(TG_OP);
    event_details := pg_catalog.jsonb_build_object(
      'requestId', request_row.id,
      'bookId', request_row.book_id,
      'status', request_row.status,
      'fineAmount', request_row.fine_amount
    );
  ELSIF TG_TABLE_NAME = 'attendance_logs' THEN
    IF TG_OP = 'DELETE' THEN
      branch_value := OLD.library_id::text;
      event_details := pg_catalog.jsonb_build_object('attendanceId', OLD.id, 'visitorId', OLD.visitor_id);
    ELSIF TG_OP IN ('INSERT', 'UPDATE') THEN
      branch_value := NEW.library_id::text;
      event_details := pg_catalog.jsonb_build_object('attendanceId', NEW.id, 'visitorId', NEW.visitor_id);
    ELSE
      RAISE EXCEPTION 'Unsupported audit operation % on %.', TG_OP, TG_TABLE_NAME;
    END IF;
    event_action := CASE
      WHEN TG_OP = 'INSERT' THEN 'circulation.visitor.checked_in'
      ELSE 'circulation.visitor.checked_out'
    END;
  ELSIF TG_TABLE_NAME = 'books' THEN
    IF TG_OP = 'DELETE' THEN
      branch_value := OLD.library_id::text;
      event_details := pg_catalog.jsonb_build_object('bookId', OLD.id, 'title', OLD.title, 'isbn', OLD.isbn);
    ELSIF TG_OP IN ('INSERT', 'UPDATE') THEN
      branch_value := NEW.library_id::text;
      event_details := pg_catalog.jsonb_build_object('bookId', NEW.id, 'title', NEW.title, 'isbn', NEW.isbn);
    ELSE
      RAISE EXCEPTION 'Unsupported audit operation % on %.', TG_OP, TG_TABLE_NAME;
    END IF;
    event_action := 'inventory.book.' || pg_catalog.lower(TG_OP);
  ELSIF TG_TABLE_NAME = 'visitor_feedback' THEN
    IF TG_OP = 'DELETE' THEN
      branch_value := OLD.library_id::text;
      event_details := pg_catalog.jsonb_build_object('feedbackId', OLD.id, 'status', OLD.status, 'category', OLD.category);
    ELSIF TG_OP IN ('INSERT', 'UPDATE') THEN
      branch_value := NEW.library_id::text;
      event_details := pg_catalog.jsonb_build_object('feedbackId', NEW.id, 'status', NEW.status, 'category', NEW.category);
    ELSE
      RAISE EXCEPTION 'Unsupported audit operation % on %.', TG_OP, TG_TABLE_NAME;
    END IF;
    event_action := 'visitor_feedback.' || pg_catalog.lower(TG_OP);
  ELSIF TG_TABLE_NAME = 'announcements' THEN
    IF TG_OP = 'DELETE' THEN
      event_details := pg_catalog.jsonb_build_object('announcementId', OLD.id, 'title', OLD.title, 'published', OLD.published);
    ELSIF TG_OP IN ('INSERT', 'UPDATE') THEN
      event_details := pg_catalog.jsonb_build_object('announcementId', NEW.id, 'title', NEW.title, 'published', NEW.published);
    ELSE
      RAISE EXCEPTION 'Unsupported audit operation % on %.', TG_OP, TG_TABLE_NAME;
    END IF;
    event_action := 'announcement.' || pg_catalog.lower(TG_OP);
  ELSIF TG_TABLE_NAME = 'visitors' THEN
    branch_value := NULL;
    IF TG_OP = 'INSERT' THEN
      event_action := 'visitor.registration.created';
      event_details := pg_catalog.jsonb_build_object(
        'visitorId', NEW.id,
        'fullName', NEW.full_name,
        'email', NEW.email,
        'otpVerified', coalesce(NEW.otp_verified, false)
      );
    ELSIF TG_OP = 'UPDATE' AND TG_NAME = 'audit_visitor_verification' THEN
      IF coalesce(OLD.otp_verified, false) IS NOT DISTINCT FROM
         coalesce(NEW.otp_verified, false) THEN
        RAISE EXCEPTION 'Visitor verification audit trigger fired without a state change.';
      END IF;
      event_action := CASE
        WHEN coalesce(NEW.otp_verified, false)
          THEN 'visitor.registration.verified'
        ELSE 'visitor.registration.verification_revoked'
      END;
      event_details := pg_catalog.jsonb_build_object(
        'visitorId', NEW.id, 'fullName', NEW.full_name, 'email', NEW.email
      );
    ELSIF TG_OP = 'UPDATE' AND TG_NAME = 'audit_visitor_active' THEN
      IF coalesce(OLD.is_active, true) IS NOT DISTINCT FROM
         coalesce(NEW.is_active, true) THEN
        RAISE EXCEPTION 'Visitor active-state audit trigger fired without a state change.';
      END IF;
      event_action := CASE
        WHEN coalesce(NEW.is_active, true)
          THEN 'visitor.account.enabled'
        ELSE 'visitor.account.disabled'
      END;
      event_details := pg_catalog.jsonb_build_object(
        'visitorId', NEW.id, 'fullName', NEW.full_name, 'email', NEW.email
      );
    ELSIF TG_OP = 'DELETE' THEN
      event_action := 'visitor.registration.deleted';
      event_details := pg_catalog.jsonb_build_object(
        'visitorId', OLD.id, 'fullName', OLD.full_name, 'email', OLD.email
      );
    ELSE
      RAISE EXCEPTION 'Unsupported visitor audit trigger operation % (%).', TG_OP, TG_NAME;
    END IF;
  ELSE
    RAISE EXCEPTION 'No audit mapping exists for table % and operation %.', TG_TABLE_NAME, TG_OP;
  END IF;

  IF event_action IS NULL OR pg_catalog.btrim(event_action) = ''
     OR event_details IS NULL
     OR pg_catalog.jsonb_typeof(event_details) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Audit mapping produced an incomplete event for table % operation %.', TG_TABLE_NAME, TG_OP;
  END IF;

  IF event_action NOT IN (
    'visitor.registration.created',
    'visitor.registration.verified',
    'visitor.registration.verification_revoked',
    'visitor.account.enabled',
    'visitor.account.disabled',
    'visitor.registration.deleted',
    'circulation.borrow_request.insert',
    'circulation.borrow_request.update',
    'circulation.borrow_request.delete',
    'circulation.visitor.checked_in',
    'circulation.visitor.checked_out',
    'inventory.book.insert',
    'inventory.book.update',
    'inventory.book.delete',
    'visitor_feedback.insert',
    'visitor_feedback.update',
    'visitor_feedback.delete',
    'announcement.insert',
    'announcement.update',
    'announcement.delete'
  ) THEN
    RAISE EXCEPTION 'Audit mapping produced an unsupported action for table % operation %.', TG_TABLE_NAME, TG_OP;
  END IF;

  INSERT INTO public.audit_logs(actor_id, action, branch_id, details)
  VALUES (auth.uid(), event_action, branch_value, event_details);

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

DO $postflight$
DECLARE
  v_acl_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
    WHERE procedure.oid = 'public.capture_shelf_audit_event()'::regprocedure
      AND procedure.proowner = 'postgres'::regrole
      AND language.lanname = 'plpgsql'
      AND procedure.prorettype = 'trigger'::regtype
      AND procedure.prosecdef
      AND procedure.provolatile = 'v'
      AND procedure.proconfig = ARRAY['search_path=pg_catalog, public, pg_temp']::text[]
  ) THEN
    RAISE EXCEPTION 'Audit trigger function did not retain its owner/security contract or fixed secure search_path.';
  END IF;

  SELECT pg_catalog.count(*)
    INTO v_acl_count
  FROM pg_catalog.pg_proc AS procedure
  CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl) AS acl
  WHERE procedure.oid = 'public.capture_shelf_audit_event()'::regprocedure;

  IF v_acl_count <> 2
     OR NOT pg_catalog.has_function_privilege('postgres', 'public.capture_shelf_audit_event()', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', 'public.capture_shelf_audit_event()', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'public.capture_shelf_audit_event()', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.capture_shelf_audit_event()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Audit trigger function effective EXECUTE privileges changed unexpectedly.';
  END IF;
END;
$postflight$;

COMMIT;