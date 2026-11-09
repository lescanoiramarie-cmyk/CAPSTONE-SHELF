-- Keep the local migration source aligned with the live function's daily alert
-- state so the Fine Payments UI can show "Alerted today" after a refresh.
DROP FUNCTION IF EXISTS public.get_fine_payment_alert_targets(text);

CREATE FUNCTION public.get_fine_payment_alert_targets(p_library_id text DEFAULT NULL)
RETURNS TABLE (request_id text, visitor_id text, alerted_today boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role text;
  v_library_id uuid;
  v_jwt_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated staff account required.';
  END IF;

  SELECT lower(sp.role), sp.library_id
  INTO v_role, v_library_id
  FROM public.staff_profiles sp
  WHERE sp.id = auth.uid() AND sp.is_active IS TRUE;

  IF NOT FOUND OR v_role NOT IN ('superadmin', 'subadmin') THEN
    RAISE EXCEPTION 'Active staff profile required.';
  END IF;

  v_jwt_role := auth.jwt() -> 'app_metadata' ->> 'role';
  IF v_jwt_role IS NOT NULL AND v_jwt_role <> v_role THEN
    RAISE EXCEPTION 'Unauthorized staff role.';
  END IF;

  IF v_role = 'subadmin' AND p_library_id IS NOT NULL AND p_library_id <> v_library_id::text THEN
    RAISE EXCEPTION 'You can only view fine alerts for your assigned library.';
  END IF;

  RETURN QUERY
  SELECT br.id::text, br.visitor_id::text,
    EXISTS (
      SELECT 1
      FROM public.due_date_notifications notification
      WHERE notification.borrow_request_id = br.id
        AND notification.visitor_id = br.visitor_id::text
        AND notification.notification_type = 'fine_reminder'
        AND notification.notification_date = timezone('utc', now())::date
    ) AS alerted_today
  FROM public.borrow_requests br
  JOIN public.books b ON b.id::text = br.book_id::text
  WHERE br.status IN ('borrowed', 'returned')
    AND (br.due_date IS NOT NULL OR COALESCE(br.fine_amount, 0) > 0)
    AND (v_role = 'superadmin' OR b.library_id = v_library_id)
    AND (p_library_id IS NULL OR b.library_id::text = p_library_id);
END;
$function$;

ALTER FUNCTION public.get_fine_payment_alert_targets(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_fine_payment_alert_targets(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_fine_payment_alert_targets(text) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
