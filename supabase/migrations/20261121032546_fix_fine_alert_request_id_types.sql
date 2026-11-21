-- Align fine alert routines with the live UUID borrow_request_id column.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_fine_payment_alert_targets_detail_internal(
  p_library_id text DEFAULT NULL::text
)
RETURNS TABLE (
  request_id text,
  visitor_id text,
  alerted_today boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
#variable_conflict use_column
DECLARE
  v_today_manila date;
BEGIN
  v_today_manila := (pg_catalog.timezone('Asia/Manila', pg_catalog.now()))::date;

  RETURN QUERY
  SELECT
    br.id::text AS request_id,
    br.visitor_id::text AS visitor_id,
    EXISTS (
      SELECT 1
      FROM public.due_date_notifications AS ddn
      WHERE (
          ddn.visitor_id = br.visitor_id
          OR ddn.borrow_request_id = br.id
        )
        AND ddn.notification_type = 'fine_reminder'
        AND (pg_catalog.timezone('Asia/Manila', ddn.sent_at))::date = v_today_manila
    ) AS alerted_today
  FROM public.borrow_requests AS br
  JOIN public.books AS b ON b.id = br.book_id
  WHERE br.status IN ('borrowed', 'returned')
    AND (p_library_id IS NULL OR b.library_id::text = p_library_id);
END;
$function$;

ALTER FUNCTION public.get_fine_payment_alert_targets_detail_internal(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_fine_payment_alert_targets_detail_internal(text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.alert_visitor_fine_payment(p_borrow_request_id text)
RETURNS TABLE (success boolean, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_library_id uuid;
  v_loan record;
  v_book_library uuid;
  v_today_manila date;
  v_already_alerted boolean;
  v_now timestamptz := pg_catalog.now();
  v_fine_balance numeric;
BEGIN
  IF v_uid IS NULL THEN
    RETURN QUERY SELECT false, 'Authentication required.'::text;
    RETURN;
  END IF;

  SELECT pg_catalog.lower(pg_catalog.btrim(staff.role)), staff.library_id
    INTO v_role, v_library_id
  FROM public.staff_profiles AS staff
  WHERE staff.id = v_uid AND staff.is_active IS TRUE;

  IF NOT FOUND OR v_role NOT IN ('subadmin', 'superadmin') THEN
    RETURN QUERY SELECT false, 'Active staff permissions required.'::text;
    RETURN;
  END IF;

  SELECT br.id, br.visitor_id, br.book_id, br.status, br.due_date,
         br.fine_amount, br.fine_paid_amount
    INTO v_loan
  FROM public.borrow_requests AS br
  WHERE br.id::text = p_borrow_request_id
  LIMIT 1;

  IF v_loan.id IS NULL THEN
    RETURN QUERY SELECT false, 'Fine record not found.'::text;
    RETURN;
  END IF;

  SELECT book.library_id INTO v_book_library
  FROM public.books AS book
  WHERE book.id = v_loan.book_id
  LIMIT 1;

  IF v_role = 'subadmin'
     AND (v_library_id IS NULL OR v_book_library <> v_library_id) THEN
    RETURN QUERY SELECT false, 'You can only alert visitors with fines from your assigned library.'::text;
    RETURN;
  END IF;

  v_today_manila := (pg_catalog.timezone('Asia/Manila', v_now))::date;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(v_loan.visitor_id::text),
    pg_catalog.hashtext(v_today_manila::text)
  );

  SELECT EXISTS (
    SELECT 1
    FROM public.due_date_notifications AS ddn
    WHERE ddn.visitor_id = v_loan.visitor_id
      AND ddn.notification_type = 'fine_reminder'
      AND (pg_catalog.timezone('Asia/Manila', ddn.sent_at))::date = v_today_manila
  ) INTO v_already_alerted;

  IF v_already_alerted THEN
    RETURN QUERY SELECT false, 'A fine alert was already sent to this visitor today.'::text;
    RETURN;
  END IF;

  INSERT INTO public.due_date_notifications (
    borrow_request_id, visitor_id, notification_type, sent_at
  ) VALUES (
    v_loan.id, v_loan.visitor_id, 'fine_reminder', v_now
  );

  v_fine_balance := GREATEST(
    0,
    COALESCE(v_loan.fine_amount, 0) - COALESCE(v_loan.fine_paid_amount, 0)
  );

  PERFORM public.create_visitor_notification(
    v_loan.visitor_id::text,
    'fine_reminder',
    'Outstanding Library Fine Reminder',
    'You have an outstanding fine balance'
      || CASE WHEN v_fine_balance > 0 THEN ' of ₱' || v_fine_balance::text ELSE '' END
      || ' for overdue library items. Please settle this with library staff.',
    v_loan.id::text,
    'borrow_request',
    v_now + interval '30 days'
  );

  RETURN QUERY SELECT true, 'Fine reminder sent to visitor.'::text;
END;
$function$;

ALTER FUNCTION public.alert_visitor_fine_payment(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.alert_visitor_fine_payment(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.alert_visitor_fine_payment(text) TO authenticated, service_role;

DO $postflight$
BEGIN
  IF pg_catalog.pg_get_function_result(
       'public.get_fine_payment_alert_targets_detail_internal(text)'::regprocedure
     ) <> 'TABLE(request_id text, visitor_id text, alerted_today boolean)' THEN
    RAISE EXCEPTION 'Fine alert target helper result signature is incorrect.';
  END IF;

  IF pg_catalog.pg_get_function_result(
       'public.alert_visitor_fine_payment(text)'::regprocedure
     ) <> 'TABLE(success boolean, message text)' THEN
    RAISE EXCEPTION 'Fine alert RPC result signature is incorrect.';
  END IF;

  IF pg_catalog.has_function_privilege(
       'authenticated',
       'public.get_fine_payment_alert_targets_detail_internal(text)',
       'EXECUTE'
     ) OR pg_catalog.has_function_privilege(
       'service_role',
       'public.get_fine_payment_alert_targets_detail_internal(text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Fine alert detail helper must remain owner-only.';
  END IF;
END;
$postflight$;

NOTIFY pgrst, 'reload schema';
COMMIT;
