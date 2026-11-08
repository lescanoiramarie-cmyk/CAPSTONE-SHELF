BEGIN;

CREATE OR REPLACE FUNCTION public.terminate_library_subscription(
  p_library_id uuid,
  p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_staff public.staff_profiles%ROWTYPE;
  v_before jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authenticated super-admin account required.'; END IF;
  SELECT * INTO v_staff
  FROM public.staff_profiles
  WHERE id = auth.uid() AND is_active IS TRUE;
  IF NOT FOUND OR lower(v_staff.role) <> 'superadmin' THEN
    RAISE EXCEPTION 'Only an active super-admin can terminate subscriptions.';
  END IF;
  IF auth.jwt() -> 'app_metadata' ->> 'role' IS NOT NULL
     AND auth.jwt() -> 'app_metadata' ->> 'role' <> 'superadmin' THEN
    RAISE EXCEPTION 'Unauthorized staff role.';
  END IF;

  SELECT to_jsonb(s) INTO v_before
  FROM public.library_subscriptions s
  WHERE s.library_id = p_library_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Library subscription not found.'; END IF;

  DELETE FROM public.subscription_renewal_follows
  WHERE library_id = p_library_id;
  DELETE FROM public.library_subscriptions
  WHERE library_id = p_library_id;

  INSERT INTO public.library_subscription_events (library_id, event_type, details, changed_by, changed_by_name)
  VALUES (
    p_library_id,
    'subscription_terminated',
    jsonb_build_object('before', v_before, 'note', NULLIF(btrim(p_note), '')),
    v_staff.id,
    COALESCE(NULLIF(btrim(v_staff.full_name), ''), v_staff.email)
  );
END;
$function$;

ALTER FUNCTION public.terminate_library_subscription(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.terminate_library_subscription(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.terminate_library_subscription(uuid, text) TO authenticated, service_role;

COMMIT;
