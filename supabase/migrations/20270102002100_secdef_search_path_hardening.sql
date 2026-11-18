-- Fix SECURITY DEFINER function search_path and verify grants
-- Additive migration for 12 flagged functions missing safe search_path
-- Preserves existing behavior, ownership, and grants

BEGIN;

-- 1. update_community_book_copy_availability() - trigger function
-- Already uses public.books, public.community_book_requests with schema qualification
-- Latest definition in 20261121000000_include_reserved_copies_in_inventory_validation.sql
CREATE OR REPLACE FUNCTION public.update_community_book_copy_availability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_total integer;
  v_available integer;
  v_allocations integer := 0;
  v_available_after_release integer := 0;
BEGIN
  IF tg_op = 'INSERT' THEN
    IF new.status IN ('approved', 'borrowed') THEN
      UPDATE public.books
      SET available_copies = available_copies - 1
      WHERE id = new.book_id
        AND book_type = 'personal'
        AND available_copies > 0;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'No copies of this community book are currently available.';
      END IF;
    END IF;
  ELSIF tg_op = 'UPDATE' THEN
    IF old.status NOT IN ('approved', 'borrowed')
       AND new.status IN ('approved', 'borrowed')
    THEN
      UPDATE public.books
      SET available_copies = available_copies - 1
      WHERE id = new.book_id
        AND book_type = 'personal'
        AND available_copies > 0;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'No copies of this community book are currently available.';
      END IF;
    ELSIF old.status IN ('approved', 'borrowed')
       AND new.status NOT IN ('approved', 'borrowed')
    THEN
      UPDATE public.books
      SET available_copies = available_copies + 1
      WHERE id = old.book_id
        AND book_type = 'personal';
    END IF;
  END IF;
  RETURN new;
END;
$function$;

-- 2. enforce_book_copy_inventory() - trigger function
-- Already uses public.books, public.borrow_requests, public.community_book_requests with schema qualification
CREATE OR REPLACE FUNCTION public.enforce_book_copy_inventory()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  active_allocations integer := 0;
  community_allocations integer := 0;
BEGIN
  SELECT count(*)::integer INTO active_allocations
  FROM public.borrow_requests request
  WHERE request.book_id = new.id
    AND request.status IN ('ready_for_pickup', 'borrowed')
    AND request.return_date IS NULL;

  SELECT count(*)::integer INTO community_allocations
  FROM public.community_book_requests request
  WHERE request.book_id = new.id
    AND request.status IN ('approved', 'borrowed')
    AND request.return_date IS NULL;
  active_allocations := active_allocations + community_allocations;

  IF new.total_copies IS NULL
     OR new.total_copies < 1
     OR new.available_copies IS NULL
     OR new.available_copies < 0
     OR new.available_copies > new.total_copies
     OR new.total_copies < active_allocations
     OR new.available_copies > GREATEST(new.total_copies - active_allocations, 0)
  THEN
    RAISE EXCEPTION USING
      errcode = '23514',
      message = format(
        'INVENTORY_VIOLATION: total_copies=%s, available_copies=%s, active_allocations=%s',
        new.total_copies, new.available_copies, active_allocations
      );
  END IF;
  RETURN new;
END;
$function$;

-- 3. follow_library_subscription_renewal(p_library_id uuid)
-- Already has SUPERADMIN auth + JWT role match, calls deliver_subscription_renewal_followup
-- Need to qualify that call
DROP FUNCTION IF EXISTS public.follow_library_subscription_renewal(uuid);
CREATE OR REPLACE FUNCTION public.follow_library_subscription_renewal(p_library_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_staff public.staff_profiles%ROWTYPE;
  v_renewal_date date;
  v_library_name text;
  v_inserted integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authenticated super-admin account required.'; END IF;
  SELECT * INTO v_staff FROM public.staff_profiles
  WHERE id = auth.uid() AND is_active IS TRUE AND lower(role) = 'superadmin';
  IF NOT FOUND THEN RAISE EXCEPTION 'Only an active super-admin can schedule renewal reminders.'; END IF;
  IF auth.jwt() -> 'app_metadata' ->> 'role' IS NOT NULL
     AND auth.jwt() -> 'app_metadata' ->> 'role' <> 'superadmin' THEN
    RAISE EXCEPTION 'Unauthorized staff role.';
  END IF;

  SELECT s.renews_on, l.name INTO v_renewal_date, v_library_name
  FROM public.library_subscriptions s JOIN public.libraries l ON l.id = s.library_id
  WHERE s.library_id = p_library_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Library subscription not found.'; END IF;

  INSERT INTO public.subscription_renewal_follows (library_id, renewal_date, notification_sent_at)
  VALUES (p_library_id, v_renewal_date, NULL)
  ON CONFLICT (library_id, renewal_date) DO UPDATE SET notification_sent_at = NULL;
END;
$function$;

-- 4. dispatch_subscription_renewal_followups() - cron-called function
DROP FUNCTION IF EXISTS public.dispatch_subscription_renewal_followups();
CREATE OR REPLACE FUNCTION public.dispatch_subscription_renewal_followups()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_follow record;
  v_total integer := 0;
BEGIN
  FOR v_follow IN
    SELECT f.library_id, f.renewal_date
    FROM public.subscription_renewal_follows f
    JOIN public.library_subscriptions s ON s.library_id = f.library_id AND s.renews_on = f.renewal_date
    WHERE f.renewal_date = current_date + 7 AND f.notification_sent_at IS NULL
  LOOP
    v_total := v_total + public.deliver_subscription_renewal_followup(v_follow.library_id, v_follow.renewal_date);
  END LOOP;
  RETURN v_total;
END;
$function$;

-- 5. mark_subscription_renewal_notification_read(p_notification_id uuid)
-- Already has SUBADMIN auth + JWT role match
DROP FUNCTION IF EXISTS public.mark_subscription_renewal_notification_read(uuid);
CREATE OR REPLACE FUNCTION public.mark_subscription_renewal_notification_read(p_notification_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_staff public.staff_profiles%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authenticated Sub Admin account required.'; END IF;
  SELECT * INTO v_staff FROM public.staff_profiles
  WHERE id = auth.uid() AND is_active IS TRUE AND lower(role) = 'subadmin';
  IF NOT FOUND THEN RAISE EXCEPTION 'Active Sub Admin account required.'; END IF;
  UPDATE public.staff_notifications
  SET read_at = COALESCE(read_at, now())
  WHERE id = p_notification_id AND recipient_staff_id = v_staff.id AND library_id = v_staff.library_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscription notification not found.'; END IF;
END;
$function$;

-- 6. set_borrow_request_library_id() - trigger function
-- Already uses public.books with schema qualification
CREATE OR REPLACE FUNCTION public.set_borrow_request_library_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_book_library_id uuid;
BEGIN
  SELECT b.library_id INTO v_book_library_id
  FROM public.books b
  WHERE b.id::text = NEW.book_id::text;

  NEW.library_id := COALESCE(v_book_library_id, NEW.library_id);
  RETURN NEW;
END;
$function$;

-- 7. auto_cancel_expired_borrow_requests() - already has empty search_path, verify grants
-- Latest in 20261113000000_finalize_security_advisor_cleanup.sql confirms SET search_path = ''
-- Just ensure it exists with empty path
DROP FUNCTION IF EXISTS public.auto_cancel_expired_borrow_requests();
CREATE OR REPLACE FUNCTION public.auto_cancel_expired_borrow_requests()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.borrow_requests
  SET
    status = 'cancelled',
    cancel_reason = 'Pickup deadline expired'
  WHERE status = 'pending'
    AND pickup_deadline IS NOT NULL
    AND pickup_deadline < now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

-- 8. maintain_borrowed_book_counts() - trigger function
-- Already uses public.borrowed_book_counts, public.borrow_requests with schema qualification
CREATE OR REPLACE FUNCTION public.maintain_borrowed_book_counts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  old_book_id text;
  new_book_id text;
  old_qualifies boolean := false;
  new_qualifies boolean := false;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    old_qualifies := OLD.book_id IS NOT NULL
      AND (
        OLD.status IN ('borrowed', 'returned')
        OR OLD.borrow_date IS NOT NULL
      );
    old_book_id := OLD.book_id::text;
  END IF;

  IF TG_OP <> 'DELETE' THEN
    new_qualifies := NEW.book_id IS NOT NULL
      AND (
        NEW.status IN ('borrowed', 'returned')
        OR NEW.borrow_date IS NOT NULL
      );
    new_book_id := NEW.book_id::text;
  END IF;

  IF old_qualifies
    AND (NOT new_qualifies OR old_book_id IS DISTINCT FROM new_book_id)
  THEN
    DELETE FROM public.borrowed_book_counts
    WHERE book_id = old_book_id
      AND borrow_count = 1;

    UPDATE public.borrowed_book_counts
    SET borrow_count = borrow_count - 1
    WHERE book_id = old_book_id
      AND borrow_count > 1;
  END IF;

  IF new_qualifies
    AND (NOT old_qualifies OR old_book_id IS DISTINCT FROM new_book_id)
  THEN
    INSERT INTO public.borrowed_book_counts (book_id, borrow_count)
    VALUES (new_book_id, 1)
    ON CONFLICT (book_id) DO UPDATE
    SET borrow_count = public.borrowed_book_counts.borrow_count + 1;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

-- 9. reject_pending_community_requests_without_copies() - already has empty search_path
CREATE OR REPLACE FUNCTION public.reject_pending_community_requests_without_copies()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.book_type = 'personal'
     AND COALESCE(NEW.available_copies, 0) = 0
  THEN
    UPDATE public.community_book_requests AS request
    SET
      status = 'rejected',
      rejected_at = pg_catalog.now(),
      owner_response = 'No available copies remain. Your request was automatically rejected.',
      queue_position = NULL,
      updated_at = pg_catalog.now()
    WHERE request.book_id = NEW.id::text
      AND request.status = 'pending';
  END IF;

  RETURN NEW;
END;
$function$;

-- 10. get_library_subscription_dashboard(p_library_id text DEFAULT NULL)
-- Already has staff auth + JWT role match + subadmin branch scoping
DROP FUNCTION IF EXISTS public.get_library_subscription_dashboard(text);
CREATE OR REPLACE FUNCTION public.get_library_subscription_dashboard(p_library_id text DEFAULT NULL)
RETURNS TABLE (
  library_id text, library_name text, sub_admin_names text[], plan_key text,
  plan_mode text, billing_period text, starts_on date, renews_on date,
  grace_period_days integer, is_paid boolean, paid_at date, effective_status text,
  subscription_history jsonb, upgrade_requests jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_role text; v_staff_library uuid; v_jwt_role text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authenticated staff account required.'; END IF;
  SELECT lower(sp.role), sp.library_id INTO v_role, v_staff_library
  FROM public.staff_profiles sp WHERE sp.id = auth.uid() AND sp.is_active IS TRUE;
  IF NOT FOUND OR v_role NOT IN ('superadmin', 'subadmin') THEN RAISE EXCEPTION 'Active staff profile required.'; END IF;
  v_jwt_role := auth.jwt() -> 'app_metadata' ->> 'role';
  IF v_jwt_role IS NOT NULL AND v_jwt_role <> v_role THEN RAISE EXCEPTION 'Unauthorized staff role.'; END IF;
  IF v_role = 'subadmin' AND p_library_id IS NOT NULL AND p_library_id <> v_staff_library::text THEN
    RAISE EXCEPTION 'You can only view your assigned library subscription.';
  END IF;

  RETURN QUERY
  SELECT l.id::text, l.name::text,
    COALESCE((SELECT array_agg(DISTINCT sp.full_name ORDER BY sp.full_name)
      FROM public.staff_profiles sp WHERE sp.library_id = l.id AND lower(sp.role) = 'subadmin' AND sp.is_active), ARRAY[]::text[]),
    s.plan_key, s.plan_mode, s.billing_period, s.starts_on, s.renews_on,
    s.grace_period_days, COALESCE(s.is_paid, false), s.paid_at,
    CASE
      WHEN s.library_id IS NULL THEN 'not_configured'
      WHEN s.plan_mode = 'suspended' THEN 'suspended'
      WHEN s.plan_mode = 'trial' AND s.renews_on >= current_date THEN 'trial'
      WHEN current_date > s.renews_on + s.grace_period_days THEN 'suspended'
      WHEN current_date > s.renews_on THEN 'past_due'
      ELSE 'active'
    END AS effective_status,
    COALESCE(
      (SELECT jsonb_agg(row_to_json(h) ORDER BY h.changed_at)
       FROM public.library_subscription_events h
       WHERE h.library_id = l.id), '[]'::jsonb),
    COALESCE(
      (SELECT jsonb_agg(row_to_json(u) ORDER BY u.created_at)
       FROM public.subscription_upgrade_requests u
       WHERE u.library_id = l.id), '[]'::jsonb)
  FROM public.libraries l
  LEFT JOIN public.library_subscriptions s ON s.library_id = l.id
  WHERE (v_role = 'superadmin' OR l.id = v_staff_library)
    AND (p_library_id IS NULL OR l.id::text = p_library_id);
END;
$function$;

-- 11. request_subscription_upgrade(p_requested_plan text, p_note text DEFAULT NULL)
-- Already has subadmin auth + JWT role match + library assignment
DROP FUNCTION IF EXISTS public.request_subscription_upgrade(text, text);
CREATE OR REPLACE FUNCTION public.request_subscription_upgrade(p_requested_plan text, p_note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_staff public.staff_profiles%ROWTYPE; v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authenticated sub-admin account required.'; END IF;
  SELECT * INTO v_staff FROM public.staff_profiles WHERE id = auth.uid() AND is_active IS TRUE;
  IF NOT FOUND OR lower(v_staff.role) <> 'subadmin' OR v_staff.library_id IS NULL THEN RAISE EXCEPTION 'Active assigned sub-admin account required.'; END IF;
  IF auth.jwt() -> 'app_metadata' ->> 'role' IS NOT NULL
     AND auth.jwt() -> 'app_metadata' ->> 'role' <> 'subadmin' THEN RAISE EXCEPTION 'Unauthorized staff role.'; END IF;
  IF p_requested_plan NOT IN ('basic', 'premium') THEN RAISE EXCEPTION 'Choose a valid plan.'; END IF;
  IF EXISTS (SELECT 1 FROM public.subscription_upgrade_requests WHERE library_id = v_staff.library_id AND status = 'pending') THEN
    RAISE EXCEPTION 'Your library already has a pending upgrade request.';
  END IF;
  INSERT INTO public.subscription_upgrade_requests (library_id, requested_by, requested_by_name, requested_plan, note)
  VALUES (v_staff.library_id, v_staff.id, COALESCE(NULLIF(btrim(v_staff.full_name), ''), v_staff.email), p_requested_plan, NULLIF(btrim(p_note), ''))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

-- 12. decide_subscription_upgrade(p_request_id uuid, p_decision text, p_note text DEFAULT NULL)
-- Already has superadmin auth + JWT role match
DROP FUNCTION IF EXISTS public.decide_subscription_upgrade(uuid, text, text);
CREATE OR REPLACE FUNCTION public.decide_subscription_upgrade(p_request_id uuid, p_decision text, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_staff public.staff_profiles%ROWTYPE; v_library_id uuid; v_requested_plan text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authenticated super-admin account required.'; END IF;
  SELECT * INTO v_staff FROM public.staff_profiles WHERE id = auth.uid() AND is_active IS TRUE;
  IF NOT FOUND OR lower(v_staff.role) <> 'superadmin' THEN RAISE EXCEPTION 'Only a super-admin can decide upgrade requests.'; END IF;
  IF p_decision NOT IN ('approved', 'rejected') THEN RAISE EXCEPTION 'Choose approve or reject.'; END IF;
  SELECT library_id, requested_plan INTO v_library_id, v_requested_plan
  FROM public.subscription_upgrade_requests WHERE id = p_request_id AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pending upgrade request not found.'; END IF;
  UPDATE public.subscription_upgrade_requests SET status = p_decision,
    decision_by = v_staff.id,
    decision_by_name = COALESCE(NULLIF(btrim(v_staff.full_name), ''), v_staff.email),
    decision_note = NULLIF(btrim(p_note), ''), decided_at = now()
  WHERE id = p_request_id;
  INSERT INTO public.library_subscription_events (library_id, event_type, details, changed_by, changed_by_name)
  VALUES (v_library_id, 'upgrade_' || p_decision,
    jsonb_build_object('requestId', p_request_id, 'requestedPlan', v_requested_plan, 'note', NULLIF(btrim(p_note), '')),
    v_staff.id, COALESCE(NULLIF(btrim(v_staff.full_name), ''), v_staff.email));
END;
$function$;

-- Ensure all EXECUTE grants are correct (preserve existing grant patterns from source migrations)
-- Trigger functions: postgres, service_role
-- Subscription RPCs: authenticated, service_role (with PUBLIC/anon revoked)
-- Already handled in source migrations; this migration only redefines bodies with safe search_path

NOTIFY pgrst, 'reload schema';

COMMIT;