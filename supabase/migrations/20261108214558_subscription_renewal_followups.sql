BEGIN;

CREATE TABLE IF NOT EXISTS public.subscription_renewal_follows (
  library_id uuid NOT NULL REFERENCES public.libraries(id) ON DELETE CASCADE,
  renewal_date date NOT NULL,
  followed_by uuid REFERENCES public.staff_profiles(id) ON DELETE SET NULL,
  followed_at timestamptz NOT NULL DEFAULT now(),
  notification_sent_at timestamptz,
  PRIMARY KEY (library_id, renewal_date)
);

CREATE TABLE IF NOT EXISTS public.staff_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_staff_id uuid NOT NULL REFERENCES public.staff_profiles(id) ON DELETE CASCADE,
  library_id uuid NOT NULL REFERENCES public.libraries(id) ON DELETE CASCADE,
  notification_type text NOT NULL CHECK (notification_type = 'subscription_renewal'),
  title text NOT NULL,
  message text NOT NULL,
  event_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  UNIQUE (recipient_staff_id, event_key)
);

CREATE INDEX IF NOT EXISTS staff_notifications_unread_idx
  ON public.staff_notifications (recipient_staff_id, created_at DESC)
  WHERE read_at IS NULL;

ALTER TABLE public.subscription_renewal_follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_notifications ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.subscription_renewal_follows, public.staff_notifications FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.subscription_renewal_follows, public.staff_notifications TO authenticated;

DROP POLICY IF EXISTS "Super admins read renewal follow settings" ON public.subscription_renewal_follows;
CREATE POLICY "Super admins read renewal follow settings"
  ON public.subscription_renewal_follows FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.staff_profiles sp
    WHERE sp.id = auth.uid() AND sp.is_active IS TRUE AND lower(sp.role) = 'superadmin'
  ));

DROP POLICY IF EXISTS "Staff read their own subscription notifications" ON public.staff_notifications;
CREATE POLICY "Staff read their own subscription notifications"
  ON public.staff_notifications FOR SELECT TO authenticated
  USING (recipient_staff_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.staff_profiles sp
    WHERE sp.id = auth.uid() AND sp.is_active IS TRUE AND lower(sp.role) = 'subadmin'
  ));

CREATE OR REPLACE FUNCTION public.deliver_subscription_renewal_followup(
  p_library_id uuid,
  p_renewal_date date
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_library_name text;
  v_sent_at timestamptz;
  v_inserted integer := 0;
  v_days integer;
BEGIN
  SELECT f.notification_sent_at, l.name
  INTO v_sent_at, v_library_name
  FROM public.subscription_renewal_follows f
  JOIN public.libraries l ON l.id = f.library_id
  JOIN public.library_subscriptions s ON s.library_id = f.library_id AND s.renews_on = f.renewal_date
  WHERE f.library_id = p_library_id AND f.renewal_date = p_renewal_date
  FOR UPDATE OF f;

  IF NOT FOUND OR v_sent_at IS NOT NULL THEN RETURN 0; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.staff_profiles sp
    WHERE sp.library_id = p_library_id AND lower(sp.role) = 'subadmin' AND sp.is_active IS TRUE
  ) THEN RETURN 0; END IF;

  v_days := GREATEST(p_renewal_date - current_date, 0);
  INSERT INTO public.staff_notifications (
    recipient_staff_id, library_id, notification_type, title, message, event_key
  )
  SELECT sp.id, p_library_id, 'subscription_renewal',
    CASE WHEN v_days = 0 THEN 'Subscription renewal due today'
      ELSE format('Subscription renewal in %s days', v_days) END,
    format('The %s subscription is due for renewal on %s. Please contact Super Admin if your library has renewed.',
      v_library_name, to_char(p_renewal_date, 'Mon FMDD, YYYY')),
    format('subscription-renewal:%s:%s', p_library_id, p_renewal_date)
  FROM public.staff_profiles sp
  WHERE sp.library_id = p_library_id AND lower(sp.role) = 'subadmin' AND sp.is_active IS TRUE
  ON CONFLICT (recipient_staff_id, event_key) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  UPDATE public.subscription_renewal_follows
  SET notification_sent_at = now()
  WHERE library_id = p_library_id AND renewal_date = p_renewal_date;

  RETURN v_inserted;
END;
$function$;

CREATE OR REPLACE FUNCTION public.follow_library_subscription_renewal(p_library_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
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
  IF NOT FOUND OR v_renewal_date IS NULL THEN RAISE EXCEPTION 'This library has no renewal date.'; END IF;
  IF v_renewal_date < current_date THEN RAISE EXCEPTION 'This subscription renewal date has already passed.'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.staff_profiles sp
    WHERE sp.library_id = p_library_id AND lower(sp.role) = 'subadmin' AND sp.is_active IS TRUE
  ) THEN RAISE EXCEPTION 'No active Sub Admin is assigned to this library.'; END IF;

  INSERT INTO public.subscription_renewal_follows (library_id, renewal_date, followed_by)
  VALUES (p_library_id, v_renewal_date, v_staff.id)
  ON CONFLICT (library_id, renewal_date) DO NOTHING;

  IF FOUND THEN
    INSERT INTO public.library_subscription_events (library_id, event_type, details, changed_by, changed_by_name)
    VALUES (p_library_id, 'renewal_reminder_followed',
      jsonb_build_object('renewalDate', v_renewal_date, 'reminderDaysBefore', 7),
      v_staff.id, COALESCE(NULLIF(btrim(v_staff.full_name), ''), v_staff.email));
  END IF;

  IF v_renewal_date <= current_date + 7 THEN
    v_inserted := public.deliver_subscription_renewal_followup(p_library_id, v_renewal_date);
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.dispatch_subscription_renewal_followups()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
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

CREATE OR REPLACE FUNCTION public.mark_subscription_renewal_notification_read(p_notification_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
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

ALTER FUNCTION public.deliver_subscription_renewal_followup(uuid, date) OWNER TO postgres;
ALTER FUNCTION public.follow_library_subscription_renewal(uuid) OWNER TO postgres;
ALTER FUNCTION public.dispatch_subscription_renewal_followups() OWNER TO postgres;
ALTER FUNCTION public.mark_subscription_renewal_notification_read(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.deliver_subscription_renewal_followup(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.follow_library_subscription_renewal(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dispatch_subscription_renewal_followups() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_subscription_renewal_notification_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.follow_library_subscription_renewal(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_subscription_renewal_notification_read(uuid) TO authenticated, service_role;

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'shelf-subscription-renewal-followups';

SELECT cron.schedule(
  'shelf-subscription-renewal-followups',
  '0 2 * * *',
  $$SELECT public.dispatch_subscription_renewal_followups();$$
);

NOTIFY pgrst, 'reload schema';
COMMIT;
