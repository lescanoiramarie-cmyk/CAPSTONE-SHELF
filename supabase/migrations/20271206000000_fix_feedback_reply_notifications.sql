BEGIN;

-- The feedback trigger is the single source of reply notifications.
CREATE OR REPLACE FUNCTION public.respond_to_visitor_feedback(p_feedback_id uuid, p_reply text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_staff public.staff_profiles%ROWTYPE;
  v_feedback public.visitor_feedback%ROWTYPE;
  v_reply text := pg_catalog.btrim(COALESCE(p_reply, ''));
  v_now timestamptz := pg_catalog.now();
BEGIN
  IF v_uid IS NULL OR auth.jwt() ->> 'aal' IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'Authenticated staff session with MFA required.';
  END IF;
  SELECT staff.* INTO v_staff FROM public.staff_profiles AS staff
  WHERE staff.id = v_uid AND staff.is_active IS TRUE;
  IF NOT FOUND OR v_staff.role NOT IN ('subadmin', 'superadmin')
     OR auth.jwt() -> 'app_metadata' ->> 'role' IS DISTINCT FROM v_staff.role THEN
    RAISE EXCEPTION 'Active staff profile required.';
  END IF;
  IF pg_catalog.length(v_reply) < 3 THEN
    RAISE EXCEPTION 'Reply must be at least 3 characters long.';
  END IF;
  SELECT feedback.* INTO v_feedback FROM public.visitor_feedback AS feedback
  WHERE feedback.id = p_feedback_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Feedback record not found.'; END IF;
  IF v_staff.role = 'subadmin' AND
     (v_staff.library_id IS NULL OR v_feedback.library_id IS DISTINCT FROM v_staff.library_id) THEN
    RAISE EXCEPTION 'You can only respond to feedback submitted to your assigned library.';
  END IF;
  UPDATE public.visitor_feedback SET admin_reply = v_reply,
    replied_by = v_staff.email, replied_at = v_now, status = 'answered', updated_at = v_now
  WHERE id = p_feedback_id;
  RETURN pg_catalog.jsonb_build_object('success', true, 'feedback_id', p_feedback_id,
    'status', 'answered', 'replied_at', v_now);
END;
$function$;
ALTER FUNCTION public.respond_to_visitor_feedback(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.respond_to_visitor_feedback(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_visitor_feedback(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_notify_visitor_on_feedback_reply()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_visitor_target text;
  v_constraint text;
BEGIN
  IF NEW.admin_reply IS NULL OR OLD.admin_reply IS NOT DISTINCT FROM NEW.admin_reply THEN
    RETURN NEW;
  END IF;
  IF NEW.visitor_id IS NOT NULL THEN
    SELECT visitor.id INTO v_visitor_target FROM public.visitors AS visitor
    WHERE visitor.id = NEW.visitor_id::text OR visitor.auth_user_id::text = NEW.visitor_id::text LIMIT 1;
  END IF;
  IF v_visitor_target IS NULL AND NEW.visitor_email IS NOT NULL THEN
    SELECT visitor.id INTO v_visitor_target FROM public.visitors AS visitor
    WHERE visitor.email = NEW.visitor_email LIMIT 1;
  END IF;
  IF v_visitor_target IS NOT NULL THEN
    BEGIN
      PERFORM public.create_visitor_notification(v_visitor_target, 'feedback_reply',
        'Library Replied to Your Feedback',
        'The library has replied to your feedback regarding "' || pg_catalog.substr(COALESCE(NEW.subject, 'General Feedback'), 1, 40) || '".',
        NEW.id::text, 'visitor_feedback', pg_catalog.now() + interval '30 days');
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint IS DISTINCT FROM 'visitor_notifications_idempotency_key' THEN RAISE; END IF;
    END;
  END IF;
  RETURN NEW;
END;
$function$;
ALTER FUNCTION public.fn_notify_visitor_on_feedback_reply() OWNER TO postgres;
NOTIFY pgrst, 'reload schema';
COMMIT;
