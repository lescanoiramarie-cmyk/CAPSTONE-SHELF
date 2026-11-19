-- Version: 20270120000000. Release Reconciliation and Catalog Alignment.
-- Forward-only migration addressing remaining runtime and ledger reconciliation issues:
-- 1. Ensure no custom workaround functions exist in pg_catalog (all migrations use native btrim)
-- 2. visitor_notifications.reference_id text polymorphism (supporting REQ-xxx borrow IDs and UUIDs)
-- 3. visitor_notifications_idempotency_key non-deferrable constraint for ON CONFLICT support
-- 4. Unified create_visitor_notification signature with p_reference_id text
-- 5. Category B migration ledger synchronization into supabase_migrations.schema_migrations

BEGIN;

-- 1. Ensure no custom workaround functions exist in pg_catalog
DROP FUNCTION IF EXISTS pg_catalog.trim(text);

-- 2. Reconcile visitor_notifications table structure
DO $$
BEGIN
  -- Alter reference_id to text if currently uuid
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'visitor_notifications'
      AND column_name = 'reference_id'
      AND data_type <> 'text'
  ) THEN
    ALTER TABLE public.visitor_notifications ALTER COLUMN reference_id TYPE text;
  END IF;

  -- Recreate idempotency key as non-deferrable unique constraint for ON CONFLICT support
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'visitor_notifications_idempotency_key'
      AND (condeferrable IS TRUE OR contype <> 'u')
  ) THEN
    ALTER TABLE public.visitor_notifications DROP CONSTRAINT visitor_notifications_idempotency_key;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'visitor_notifications_idempotency_key'
      AND contype = 'u'
      AND condeferrable IS FALSE
  ) THEN
    ALTER TABLE public.visitor_notifications
      ADD CONSTRAINT visitor_notifications_idempotency_key
      UNIQUE (visitor_id, notification_type, reference_id, reference_type);
  END IF;
END $$;

-- 3. Unified create_visitor_notification RPC signature
DROP FUNCTION IF EXISTS public.create_visitor_notification(text, text, text, text, uuid, text, timestamptz);
DROP FUNCTION IF EXISTS public.create_visitor_notification(text, text, text, text, text, text, timestamptz);

CREATE OR REPLACE FUNCTION public.create_visitor_notification(
    p_visitor_id text,
    p_notification_type text,
    p_title text,
    p_message text,
    p_reference_id text DEFAULT NULL,
    p_reference_type text DEFAULT NULL,
    p_expires_at timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_notification_id uuid;
    v_caller text;
BEGIN
    v_caller := current_user;
    IF v_caller NOT IN ('service_role', 'postgres') THEN
        RAISE EXCEPTION 'Insufficient privilege: create_visitor_notification can only be called by internal functions or service_role.';
    END IF;

    IF p_notification_type NOT IN (
        'borrow_request_created', 'borrow_request_queued', 'borrow_ready_for_pickup',
        'borrow_pickup_confirmed', 'borrow_due_soon', 'borrow_due_today', 'borrow_overdue',
        'borrow_return_confirmed', 'borrow_auto_cancelled', 'borrow_cancelled',
        'community_request_pending', 'community_request_approved', 'community_request_rejected',
        'community_pickup_confirmed', 'community_return_confirmed', 'community_due_soon',
        'community_due_today', 'community_overdue', 'community_cancelled',
        'announcement', 'fine_reminder'
    ) THEN
        RAISE EXCEPTION 'Invalid notification_type: %', p_notification_type;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.visitors WHERE id = p_visitor_id) THEN
        RAISE EXCEPTION 'Visitor not found: %', p_visitor_id;
    END IF;

    INSERT INTO public.visitor_notifications (
        visitor_id,
        notification_type,
        title,
        message,
        reference_id,
        reference_type,
        expires_at
    ) VALUES (
        p_visitor_id,
        p_notification_type,
        p_title,
        COALESCE(p_message, p_title, 'Notification'),
        p_reference_id,
        p_reference_type,
        p_expires_at
    )
    ON CONFLICT (visitor_id, notification_type, reference_id, reference_type) DO NOTHING
    RETURNING id INTO v_notification_id;

    RETURN v_notification_id;
END;
$function$;

ALTER FUNCTION public.create_visitor_notification(text, text, text, text, text, text, timestamptz) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_visitor_notification(text, text, text, text, text, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_visitor_notification(text, text, text, text, text, text, timestamptz) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_visitor_notification(
    p_visitor_id text,
    p_notification_type text,
    p_title text,
    p_message text,
    p_reference_id uuid,
    p_reference_type text DEFAULT NULL,
    p_expires_at timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT public.create_visitor_notification(
    p_visitor_id,
    p_notification_type,
    p_title,
    p_message,
    p_reference_id::text,
    p_reference_type,
    p_expires_at
  );
$function$;

ALTER FUNCTION public.create_visitor_notification(text, text, text, text, uuid, text, timestamptz) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_visitor_notification(text, text, text, text, uuid, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_visitor_notification(text, text, text, text, uuid, text, timestamptz) TO authenticated, service_role;

-- 4. Verified Category B Migration Ledger Synchronization
-- Validates every required schema/catalog effect before idempotently stamping the ledger.
-- Fails closed if any required effect is missing.
-- Atomic all-or-nothing: All 6 checks must succeed before inserting any ledger stamp.
DO $category_b_stamps$
DECLARE
  v_has_schema_migrations boolean;
  v_b1_ok boolean := false;
  v_b2_ok boolean := false;
  v_b3_ok boolean := false;
  v_b4_ok boolean := false;
  v_b5_ok boolean := false;
  v_b6_ok boolean := false;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'supabase_migrations' AND table_name = 'schema_migrations'
  ) INTO v_has_schema_migrations;

  IF NOT v_has_schema_migrations THEN
    RAISE NOTICE 'supabase_migrations.schema_migrations table does not exist; skipping ledger synchronization.';
    RETURN;
  END IF;

  -- 1. Verify 20261108160959 (fine_schema_prerequisite)
  -- Requires: public.fine_payments table with all 9 columns, exact types, constraints, RLS, indexes, privileges, and borrow_requests columns/checks
  IF pg_catalog.to_regclass('public.fine_payments') IS NOT NULL
     AND (
       SELECT c.relkind = 'r' AND c.relrowsecurity IS TRUE AND c.relowner = 'postgres'::regrole::oid
       FROM pg_catalog.pg_class c WHERE c.oid = 'public.fine_payments'::regclass
     )
     AND (
       SELECT pg_catalog.count(*)
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'fine_payments'
         AND (
           (column_name = 'id' AND data_type = 'uuid' AND is_nullable = 'NO')
           OR (column_name = 'borrow_request_id' AND data_type = 'text' AND is_nullable = 'NO')
           OR (column_name = 'amount' AND data_type = 'numeric' AND is_nullable = 'NO')
           OR (column_name = 'payment_method' AND data_type = 'text' AND is_nullable = 'NO')
           OR (column_name = 'reference_number' AND data_type = 'text' AND is_nullable = 'YES')
           OR (column_name = 'note' AND data_type = 'text' AND is_nullable = 'YES')
           OR (column_name = 'received_by' AND data_type = 'uuid' AND is_nullable = 'NO')
           OR (column_name = 'received_by_name' AND data_type = 'text' AND is_nullable = 'NO')
           OR (column_name = 'received_at' AND data_type = 'timestamp with time zone' AND is_nullable = 'NO')
         )
     ) = 9
     AND EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conrelid = 'public.fine_payments'::regclass AND conname = 'fine_payments_pkey' AND contype = 'p'
     )
     AND EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conrelid = 'public.fine_payments'::regclass AND conname = 'fine_payments_received_by_fkey' AND contype = 'f'
     )
     AND EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conrelid = 'public.fine_payments'::regclass AND conname = 'fine_payments_amount_check' AND contype = 'c' AND convalidated IS TRUE
     )
     AND EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conrelid = 'public.fine_payments'::regclass AND conname = 'fine_payments_payment_method_check' AND contype = 'c' AND convalidated IS TRUE
     )
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'borrow_requests'
         AND column_name = 'fine_paid_amount' AND data_type = 'numeric' AND is_nullable = 'NO'
     )
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'borrow_requests'
         AND column_name = 'fine_review_required' AND data_type = 'boolean' AND is_nullable = 'NO'
     )
     AND EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conrelid = 'public.borrow_requests'::regclass AND conname = 'borrow_requests_fine_paid_amount_check' AND contype = 'c' AND convalidated IS TRUE
     )
     AND EXISTS (
       SELECT 1 FROM pg_index i
       JOIN pg_class c ON c.oid = i.indexrelid
       WHERE i.indrelid = 'public.fine_payments'::regclass
         AND c.relname = 'fine_payments_request_received_idx'
         AND i.indisvalid IS TRUE
     )
     AND NOT pg_catalog.has_table_privilege('anon', 'public.fine_payments'::regclass, 'SELECT')
     AND NOT pg_catalog.has_table_privilege('authenticated', 'public.fine_payments'::regclass, 'SELECT')
     AND NOT pg_catalog.has_table_privilege('anon', 'public.fine_payments'::regclass, 'INSERT')
     AND NOT pg_catalog.has_table_privilege('authenticated', 'public.fine_payments'::regclass, 'INSERT') THEN
    v_b1_ok := true;
  ELSE
    RAISE EXCEPTION 'Category B verification failed: 20261108160959 (fine_payments table, columns, constraints, index, privileges, or borrow_requests prerequisites missing/invalid)';
  END IF;

  -- 2. Verify 20261109130133 (trigger_function_prerequisites)
  -- Requires: set_borrow_request_library_id() and maintain_book_rating_aggregates() functions, security mode, search_path, active triggers, and restricted privileges
  IF pg_catalog.to_regprocedure('public.set_borrow_request_library_id()') IS NOT NULL
     AND (
       SELECT p.prosecdef IS TRUE
          AND p.proowner = 'postgres'::regrole::oid
          AND p.prorettype = 'trigger'::regtype::oid
          AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
          AND (p.proconfig @> ARRAY['search_path=public, pg_temp']::text[] OR p.proconfig @> ARRAY['search_path=""']::text[])
       FROM pg_proc p WHERE p.oid = 'public.set_borrow_request_library_id()'::regprocedure
     )
     AND pg_catalog.to_regprocedure('public.maintain_book_rating_aggregates()') IS NOT NULL
     AND (
       SELECT p.prosecdef IS TRUE
          AND p.proowner = 'postgres'::regrole::oid
          AND p.prorettype = 'trigger'::regtype::oid
          AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
          AND (p.proconfig @> ARRAY['search_path=public, pg_temp']::text[] OR p.proconfig @> ARRAY['search_path=""']::text[])
       FROM pg_proc p WHERE p.oid = 'public.maintain_book_rating_aggregates()'::regprocedure
     )
     AND EXISTS (
       SELECT 1 FROM pg_trigger t
       WHERE t.tgname = 'set_borrow_request_library_id'
         AND t.tgrelid = 'public.borrow_requests'::regclass
         AND t.tgenabled = 'O'
     )
     AND EXISTS (
       SELECT 1 FROM pg_trigger t
       WHERE t.tgname = 'maintain_book_rating_aggregates'
         AND t.tgrelid = 'public.book_reviews'::regclass
         AND t.tgenabled = 'O'
     )
     AND NOT pg_catalog.has_function_privilege('anon', 'public.set_borrow_request_library_id()'::regprocedure, 'EXECUTE')
     AND NOT pg_catalog.has_function_privilege('authenticated', 'public.set_borrow_request_library_id()'::regprocedure, 'EXECUTE')
     AND NOT pg_catalog.has_function_privilege('anon', 'public.maintain_book_rating_aggregates()'::regprocedure, 'EXECUTE')
     AND NOT pg_catalog.has_function_privilege('authenticated', 'public.maintain_book_rating_aggregates()'::regprocedure, 'EXECUTE') THEN
    v_b2_ok := true;
  ELSE
    RAISE EXCEPTION 'Category B verification failed: 20261109130133 (trigger functions metadata, security mode, language, privileges, or triggers missing/invalid)';
  END IF;

  -- 3. Verify 20261129999998 (community_fine_review_prerequisite)
  -- Requires: public.community_book_requests.fine_review_required boolean NOT NULL DEFAULT false
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'community_book_requests'
      AND column_name = 'fine_review_required'
      AND data_type = 'boolean'
      AND is_nullable = 'NO'
      AND column_default = 'false'
  ) THEN
    v_b3_ok := true;
  ELSE
    RAISE EXCEPTION 'Category B verification failed: 20261129999998 (community_book_requests.fine_review_required boolean NOT NULL DEFAULT false missing)';
  END IF;

  -- 4. Verify 20261129999999 (community_pickup_return_contract_prerequisite)
  -- Requires: 20261130000000 recorded in ledger AND confirm_community_book_pickup(uuid,text) returns void, prosecdef true, owner postgres, proper grants
  IF NOT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = '20261130000000'
  ) THEN
    RAISE EXCEPTION 'Category B verification failed: 20261129999999 (prerequisite migration 20261130000000 not recorded in ledger)';
  ELSIF pg_catalog.to_regprocedure('public.confirm_community_book_pickup(uuid,text)') IS NOT NULL
     AND (
       SELECT p.prosecdef IS TRUE
          AND p.proowner = 'postgres'::regrole::oid
          AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
          AND pg_catalog.pg_get_function_result(p.oid) = 'void'
       FROM pg_proc p WHERE p.oid = 'public.confirm_community_book_pickup(uuid,text)'::regprocedure
     )
     AND pg_catalog.has_function_privilege('authenticated', 'public.confirm_community_book_pickup(uuid,text)'::regprocedure, 'EXECUTE') IS TRUE
     AND pg_catalog.has_function_privilege('service_role', 'public.confirm_community_book_pickup(uuid,text)'::regprocedure, 'EXECUTE') IS TRUE
     AND pg_catalog.has_function_privilege('anon', 'public.confirm_community_book_pickup(uuid,text)'::regprocedure, 'EXECUTE') IS FALSE THEN
    v_b4_ok := true;
  ELSE
    RAISE EXCEPTION 'Category B verification failed: 20261129999999 (confirm_community_book_pickup(uuid,text) missing, invalid return type, not security definer, or improper execute grants)';
  END IF;

  -- 5. Verify 20261226999999 (fine_alert_target_prerequisite)
  -- Requires: 20261227000000 recorded in ledger AND get_fine_payment_alert_targets(text) exists, prosecdef true, owner postgres
  IF NOT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = '20261227000000'
  ) THEN
    RAISE EXCEPTION 'Category B verification failed: 20261226999999 (prerequisite migration 20261227000000 not recorded in ledger)';
  ELSIF pg_catalog.to_regprocedure('public.get_fine_payment_alert_targets(text)') IS NOT NULL
     AND (
       SELECT p.prosecdef IS TRUE
          AND p.proowner = 'postgres'::regrole::oid
          AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
       FROM pg_proc p WHERE p.oid = 'public.get_fine_payment_alert_targets(text)'::regprocedure
     ) THEN
    v_b5_ok := true;
  ELSE
    RAISE EXCEPTION 'Category B verification failed: 20261226999999 (get_fine_payment_alert_targets(text) missing or not security definer)';
  END IF;

  -- 6. Verify 20261227000001 (restore_fine_alert_status_result)
  -- Requires: public.get_fine_payment_alert_targets(text) with 3-column return type including alerted_today boolean, prosecdef true, owner postgres, proper grants
  IF pg_catalog.to_regprocedure('public.get_fine_payment_alert_targets(text)') IS NOT NULL
     AND (
       SELECT p.prosecdef IS TRUE
          AND p.proowner = 'postgres'::regrole::oid
          AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
          AND (p.proconfig @> ARRAY['search_path=public, pg_temp']::text[] OR p.proconfig @> ARRAY['search_path=""']::text[])
          AND pg_catalog.pg_get_function_result(p.oid) LIKE '%alerted_today boolean%'
       FROM pg_proc p WHERE p.oid = 'public.get_fine_payment_alert_targets(text)'::regprocedure
     )
     AND pg_catalog.has_function_privilege('authenticated', 'public.get_fine_payment_alert_targets(text)'::regprocedure, 'EXECUTE') IS TRUE
     AND pg_catalog.has_function_privilege('anon', 'public.get_fine_payment_alert_targets(text)'::regprocedure, 'EXECUTE') IS FALSE THEN
    v_b6_ok := true;
  ELSE
    RAISE EXCEPTION 'Category B verification failed: 20261227000001 (get_fine_payment_alert_targets alerted_today signature, security mode, search_path, or grants missing/invalid)';
  END IF;

  -- Atomic ledger insertion: only execute when all 6 Category B preflights are affirmative
  IF v_b1_ok AND v_b2_ok AND v_b3_ok AND v_b4_ok AND v_b5_ok AND v_b6_ok THEN
    INSERT INTO supabase_migrations.schema_migrations (version, name)
    VALUES
      ('20261108160959', 'fine_schema_prerequisite'),
      ('20261109130133', 'trigger_function_prerequisites'),
      ('20261129999998', 'community_fine_review_prerequisite'),
      ('20261129999999', 'community_pickup_return_contract_prerequisite'),
      ('20261226999999', 'fine_alert_target_prerequisite'),
      ('20261227000001', 'restore_fine_alert_status_result')
    ON CONFLICT (version) DO NOTHING;
  ELSE
    RAISE EXCEPTION 'Category B verification failed: Atomic preflight gate not satisfied';
  END IF;
END;
$category_b_stamps$;

-- 5. Explicit Postflight Assertions for Release Reconciliation
DO $postflight_assertions$
DECLARE
  v_b_count integer;
BEGIN
  -- Verify no custom pg_catalog.trim exists
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'pg_catalog' AND p.proname = 'trim' AND p.pronargs = 1
  ) THEN
    RAISE EXCEPTION 'Postflight Assertion Failed: custom pg_catalog.trim function still exists';
  END IF;

  -- Verify visitor_notifications.reference_id is text
  IF (
    SELECT data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'visitor_notifications' AND column_name = 'reference_id'
  ) IS DISTINCT FROM 'text' THEN
    RAISE EXCEPTION 'Postflight Assertion Failed: visitor_notifications.reference_id is not text';
  END IF;

  -- Verify non-deferrable unique constraint on visitor_notifications
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.visitor_notifications'::regclass
      AND conname = 'visitor_notifications_idempotency_key'
      AND contype = 'u'
      AND condeferrable IS FALSE
  ) THEN
    RAISE EXCEPTION 'Postflight Assertion Failed: visitor_notifications_idempotency_key non-deferrable constraint missing';
  END IF;

  -- Verify create_visitor_notification signature and permissions
  IF pg_catalog.to_regprocedure('public.create_visitor_notification(text,text,text,text,text,text,timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'Postflight Assertion Failed: public.create_visitor_notification with text reference_id missing';
  END IF;

  -- If supabase_migrations exists, verify all 6 Category B migrations are stamped
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'supabase_migrations' AND table_name = 'schema_migrations'
  ) THEN
    SELECT count(*) INTO v_b_count
    FROM supabase_migrations.schema_migrations
    WHERE version IN (
      '20261108160959', '20261109130133', '20261129999998',
      '20261129999999', '20261226999999', '20261227000001'
    );
    IF v_b_count <> 6 THEN
      RAISE EXCEPTION 'Postflight Assertion Failed: Expected all 6 Category B migrations in ledger, found %', v_b_count;
    END IF;
  END IF;
END;
$postflight_assertions$;

COMMIT;
