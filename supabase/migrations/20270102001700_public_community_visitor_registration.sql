BEGIN;

-- Existing visitor records retain their current access: the column defaults
-- classify them as institutional and already approved. No business rows are
-- deleted or rewritten by this migration.
ALTER TABLE public.visitors
  ADD COLUMN IF NOT EXISTS registration_type text NOT NULL DEFAULT 'institutional',
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'approved';

DO $constraints$
DECLARE
  v_definition text;
  v_type "char";
  v_validated boolean;
BEGIN
  SELECT pg_catalog.pg_get_constraintdef(oid), contype, convalidated
    INTO v_definition, v_type, v_validated
  FROM pg_catalog.pg_constraint
  WHERE conrelid = 'public.visitors'::pg_catalog.regclass
    AND conname = 'visitors_registration_type_check';
  IF NOT FOUND THEN
    ALTER TABLE public.visitors
      ADD CONSTRAINT visitors_registration_type_check
      CHECK (registration_type IN ('institutional', 'community'));
  ELSIF v_type <> 'c' OR NOT v_validated
     OR pg_catalog.strpos(pg_catalog.lower(v_definition), 'registration_type') = 0
     OR pg_catalog.strpos(pg_catalog.lower(v_definition), 'institutional') = 0
     OR pg_catalog.strpos(pg_catalog.lower(v_definition), 'community') = 0 THEN
    RAISE EXCEPTION 'Existing visitors_registration_type_check is not the expected validated registration-type constraint.';
  END IF;

  SELECT pg_catalog.pg_get_constraintdef(oid), contype, convalidated
    INTO v_definition, v_type, v_validated
  FROM pg_catalog.pg_constraint
  WHERE conrelid = 'public.visitors'::pg_catalog.regclass
    AND conname = 'visitors_approval_status_check';
  IF NOT FOUND THEN
    ALTER TABLE public.visitors
      ADD CONSTRAINT visitors_approval_status_check
      CHECK (approval_status IN ('approved', 'pending'));
  ELSIF v_type <> 'c' OR NOT v_validated
     OR pg_catalog.strpos(pg_catalog.lower(v_definition), 'approval_status') = 0
     OR pg_catalog.strpos(pg_catalog.lower(v_definition), 'approved') = 0
     OR pg_catalog.strpos(pg_catalog.lower(v_definition), 'pending') = 0 THEN
    RAISE EXCEPTION 'Existing visitors_approval_status_check is not the expected validated approval-status constraint.';
  END IF;
END;
$constraints$;

CREATE INDEX IF NOT EXISTS visitors_community_approval_idx
  ON public.visitors (library_id, registered_at DESC)
  WHERE registration_type = 'community' AND approval_status = 'pending';

-- Institutional email validation remains the default. Community registration
-- bypasses only the domain match, never the required preferred-library check.
CREATE OR REPLACE FUNCTION public.enforce_visitor_email_domain()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_type text;
  v_library_id uuid;
  v_domain text;
  v_partner_domain text;
BEGIN
  IF COALESCE(NEW.raw_user_meta_data ->> 'role', '') <> 'visitor' THEN
    RETURN NEW;
  END IF;

  v_type := COALESCE(
    NULLIF(pg_catalog.lower(pg_catalog.btrim(NEW.raw_user_meta_data ->> 'registration_type')), ''),
    'institutional'
  );
  IF v_type NOT IN ('institutional', 'community') THEN
    RAISE EXCEPTION 'Choose a valid visitor registration type.';
  END IF;

  BEGIN
    v_library_id := NULLIF(pg_catalog.btrim(NEW.raw_user_meta_data ->> 'library_id'), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Select a valid preferred library.';
  END;
  IF v_library_id IS NULL THEN
    RAISE EXCEPTION 'Select a preferred library.';
  END IF;

  SELECT NULLIF(pg_catalog.btrim(pg_catalog.lower(pg_catalog.btrim(library.email_domain)), '@.'), '')
    INTO v_partner_domain
  FROM public.libraries AS library
  WHERE library.id = v_library_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The selected preferred library does not exist.';
  END IF;

  IF v_type = 'community' THEN
    RETURN NEW;
  END IF;

  v_domain := pg_catalog.lower(pg_catalog.split_part(pg_catalog.btrim(COALESCE(NEW.email, '')), '@', 2));
  IF v_domain = 'gmail.com'
     OR v_partner_domain IS NULL
     OR (v_domain <> v_partner_domain
       AND pg_catalog.right(v_domain, pg_catalog.length(v_partner_domain) + 1) <> ('.' || v_partner_domain)) THEN
    RAISE EXCEPTION 'Institutional visitor registration requires an email domain configured for the selected library.';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_visitor_email_domain()
  FROM PUBLIC, anon, authenticated, service_role;

-- Preserve the Auth linking trigger while assigning community accounts to the
-- selected branch and making them inactive until a librarian approves them.
CREATE OR REPLACE FUNCTION public.link_visitor_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_type text;
  v_library_id uuid;
  v_existing_id text;
  v_existing_auth_id uuid;
  v_existing_verified boolean;
  v_existing_qr text;
BEGIN
  IF COALESCE(NEW.raw_user_meta_data ->> 'role', '') <> 'visitor' THEN
    RETURN NEW;
  END IF;

  v_type := COALESCE(
    NULLIF(pg_catalog.lower(pg_catalog.btrim(NEW.raw_user_meta_data ->> 'registration_type')), ''),
    'institutional'
  );
  IF v_type NOT IN ('institutional', 'community') THEN
    RAISE EXCEPTION 'Choose a valid visitor registration type.';
  END IF;
  v_library_id := NULLIF(pg_catalog.btrim(NEW.raw_user_meta_data ->> 'library_id'), '')::uuid;
  IF v_library_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.libraries AS library WHERE library.id = v_library_id
  ) THEN
    RAISE EXCEPTION 'Select a valid preferred library.';
  END IF;

  SELECT visitor.id::text, visitor.auth_user_id, visitor.otp_verified, visitor.qr_code
    INTO v_existing_id, v_existing_auth_id, v_existing_verified, v_existing_qr
  FROM public.visitors AS visitor
  WHERE pg_catalog.lower(visitor.email) = pg_catalog.lower(NEW.email)
  LIMIT 1
  FOR UPDATE;

  IF v_existing_id IS NULL THEN
    INSERT INTO public.visitors (
      full_name, contact_number, email, address, otp_verified, qr_code,
      auth_user_id, is_active, library_id, registration_type, approval_status
    ) VALUES (
      COALESCE(NEW.raw_user_meta_data ->> 'full_name', 'Visitor'),
      NEW.raw_user_meta_data ->> 'contact_number',
      pg_catalog.lower(NEW.email),
      NEW.raw_user_meta_data ->> 'address',
      false,
      NULL,
      NEW.id,
      v_type <> 'community',
      v_library_id,
      v_type,
      CASE WHEN v_type = 'community' THEN 'pending' ELSE 'approved' END
    );
  ELSE
    IF v_existing_auth_id IS NOT NULL AND v_existing_auth_id <> NEW.id THEN
      RAISE EXCEPTION 'This email is already linked to a visitor account.';
    END IF;
    IF v_type = 'community' AND (COALESCE(v_existing_verified, false) OR v_existing_qr IS NOT NULL) THEN
      RAISE EXCEPTION 'An existing verified visitor record cannot be converted to a pending community registration.';
    END IF;

    UPDATE public.visitors AS visitor
    SET auth_user_id = NEW.id,
        full_name = COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'full_name', ''), visitor.full_name),
        contact_number = COALESCE(NEW.raw_user_meta_data ->> 'contact_number', visitor.contact_number),
        address = COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'address', ''), visitor.address),
        library_id = v_library_id,
        registration_type = v_type,
        approval_status = CASE WHEN v_type = 'community' THEN 'pending' ELSE 'approved' END,
        is_active = CASE WHEN v_type = 'community' THEN false ELSE visitor.is_active END
    WHERE visitor.id::text = v_existing_id;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.link_visitor_auth_user()
  FROM PUBLIC, anon, authenticated, service_role;

-- New unique endpoint avoids changing the existing register_visitor RPC
-- contract. It binds the requested type, branch and registration details to
-- the Auth user's untrusted user_metadata plus the one-time registration nonce.
CREATE OR REPLACE FUNCTION public.register_visitor_v2(
  p_auth_user_id uuid,
  p_full_name text,
  p_contact_number text,
  p_email text,
  p_address text,
  p_registration_nonce text,
  p_library_id uuid,
  p_registration_type text
)
RETURNS TABLE(visitor_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_metadata jsonb;
  v_email text;
  v_type text;
  v_domain text;
  v_partner_domain text;
  v_visitor_id text;
  v_profile_library_id uuid;
  v_profile_type text;
  v_profile_approval text;
BEGIN
  v_type := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_registration_type, '')));
  IF v_type IS NULL OR v_type NOT IN ('institutional', 'community') THEN
    RAISE EXCEPTION 'Choose a valid visitor registration type.';
  END IF;
  IF p_library_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.libraries AS library WHERE library.id = p_library_id
  ) THEN
    RAISE EXCEPTION 'Select a valid preferred library.';
  END IF;

  SELECT pg_catalog.lower(account.email), account.raw_user_meta_data
    INTO v_email, v_metadata
  FROM auth.users AS account
  WHERE account.id = p_auth_user_id;

  IF v_email IS NULL
     OR v_email <> pg_catalog.lower(pg_catalog.btrim(p_email))
     OR v_metadata ->> 'role' IS DISTINCT FROM 'visitor'
     OR v_metadata ->> 'registration_type' IS DISTINCT FROM v_type
     OR v_metadata ->> 'registration_nonce' IS DISTINCT FROM p_registration_nonce
     OR v_metadata ->> 'full_name' IS DISTINCT FROM pg_catalog.btrim(p_full_name)
     OR v_metadata ->> 'contact_number' IS DISTINCT FROM NULLIF(pg_catalog.btrim(p_contact_number), '')
     OR v_metadata ->> 'address' IS DISTINCT FROM NULLIF(pg_catalog.btrim(p_address), '')
     OR v_metadata ->> 'library_id' IS DISTINCT FROM p_library_id::text THEN
    RAISE EXCEPTION 'A matching visitor registration proof is required.';
  END IF;

  IF v_type = 'institutional' THEN
    v_domain := pg_catalog.lower(pg_catalog.split_part(v_email, '@', 2));
  SELECT NULLIF(pg_catalog.btrim(pg_catalog.lower(pg_catalog.btrim(library.email_domain)), '@.'), '')
      INTO v_partner_domain
    FROM public.libraries AS library
    WHERE library.id = p_library_id;
    IF v_domain = 'gmail.com'
       OR v_partner_domain IS NULL
       OR (v_domain <> v_partner_domain
         AND pg_catalog.right(v_domain, pg_catalog.length(v_partner_domain) + 1) <> ('.' || v_partner_domain)) THEN
      RAISE EXCEPTION 'Institutional visitor registration requires an email domain configured for the selected library.';
    END IF;
  END IF;

  SELECT visitor.id::text, visitor.library_id,
         visitor.registration_type, visitor.approval_status
    INTO v_visitor_id, v_profile_library_id, v_profile_type, v_profile_approval
  FROM public.visitors AS visitor
  WHERE visitor.auth_user_id = p_auth_user_id
    AND pg_catalog.lower(visitor.email) = v_email
  FOR UPDATE;
  IF v_visitor_id IS NULL THEN
    RAISE EXCEPTION 'The visitor profile was not created by the Auth trigger.';
  END IF;
  -- Auth metadata is user-editable. Never let a later RPC call move an
  -- existing visitor to another branch, change registration type, or reset
  -- approval state by replaying this registration-completion endpoint.
  IF v_profile_library_id IS DISTINCT FROM p_library_id
     OR v_profile_type IS DISTINCT FROM v_type
     OR v_profile_approval IS DISTINCT FROM
       CASE WHEN v_type = 'community' THEN 'pending' ELSE 'approved' END THEN
    RAISE EXCEPTION 'The visitor profile does not match the original registration request.';
  END IF;

  RETURN QUERY SELECT v_visitor_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.register_visitor_v2(uuid, text, text, text, text, text, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.register_visitor_v2(uuid, text, text, text, text, text, uuid, text)
  TO anon, authenticated;

-- Keep the app's six-column OTP response and persistent failed-attempt logic.
-- A community pass is not created or returned until librarian approval.
CREATE OR REPLACE FUNCTION public.verify_visitor_otp(p_visitor_id text, p_code text)
RETURNS TABLE (id text, full_name text, email text, qr_code text, error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_visitor public.visitors%rowtype;
  v_qr text;
  v_attempts integer;
  v_message text;
BEGIN
  SELECT visitor.* INTO v_visitor
  FROM public.visitors AS visitor
  WHERE visitor.id = pg_catalog.btrim(p_visitor_id)
  FOR UPDATE;
  IF v_visitor.id IS NULL THEN
    RAISE EXCEPTION 'Registration not found. Please register again.';
  END IF;
  IF COALESCE(v_visitor.otp_verified, false) THEN
    RETURN QUERY SELECT v_visitor.id::text, v_visitor.full_name::text,
      v_visitor.email::text, v_visitor.qr_code::text, NULL::text;
    RETURN;
  END IF;
  IF v_visitor.otp IS NULL THEN
    RETURN QUERY SELECT NULL::text, NULL::text, NULL::text, NULL::text,
      'No verification code is pending. Please request a new code.'::text;
    RETURN;
  END IF;
  IF v_visitor.otp_expires_at IS NOT NULL AND v_visitor.otp_expires_at <= pg_catalog.now() THEN
    UPDATE public.visitors SET otp = NULL, otp_expires_at = NULL, otp_attempts = 0 WHERE id = v_visitor.id;
    INSERT INTO public.audit_logs(actor_id, action, branch_id, details)
    VALUES (auth.uid(), 'visitor.otp.expired', NULL, pg_catalog.jsonb_build_object('visitorId', v_visitor.id));
    RETURN QUERY SELECT NULL::text, NULL::text, NULL::text, NULL::text,
      'This verification code has expired. Please request a new code.'::text;
    RETURN;
  END IF;
  v_attempts := COALESCE(v_visitor.otp_attempts, 0);
  IF v_attempts >= 5 THEN
    INSERT INTO public.audit_logs(actor_id, action, branch_id, details)
    VALUES (auth.uid(), 'visitor.otp.lockout', NULL,
      pg_catalog.jsonb_build_object('visitorId', v_visitor.id, 'attempts', v_attempts));
    RETURN QUERY SELECT NULL::text, NULL::text, NULL::text, NULL::text,
      'Too many incorrect attempts. Please request a new code.'::text;
    RETURN;
  END IF;
  IF v_visitor.otp <> pg_catalog.btrim(p_code) THEN
    UPDATE public.visitors SET otp_attempts = v_attempts + 1 WHERE id = v_visitor.id;
    INSERT INTO public.audit_logs(actor_id, action, branch_id, details)
    VALUES (auth.uid(), 'visitor.otp.verification_failed', NULL,
      pg_catalog.jsonb_build_object('visitorId', v_visitor.id, 'attempts', v_attempts + 1));
    v_message := 'Incorrect OTP code. Please try again.';
    IF v_attempts + 1 >= 5 THEN
      v_message := v_message || ' After one more incorrect attempt this code will be blocked.';
    END IF;
    RETURN QUERY SELECT NULL::text, NULL::text, NULL::text, NULL::text, v_message;
    RETURN;
  END IF;

  IF v_visitor.registration_type = 'community' AND v_visitor.approval_status = 'pending' THEN
    v_qr := v_visitor.qr_code;
  ELSE
    v_qr := COALESCE(NULLIF(v_visitor.qr_code, ''), public.generate_visitor_qr_code());
  END IF;
  UPDATE public.visitors
  SET otp_verified = true, qr_code = v_qr, otp = NULL,
      otp_expires_at = NULL, otp_attempts = 0
  WHERE id = v_visitor.id;
  INSERT INTO public.audit_logs(actor_id, action, branch_id, details)
  VALUES (auth.uid(), 'visitor.registration.verified', NULL,
    pg_catalog.jsonb_build_object('visitorId', v_visitor.id, 'fullName', v_visitor.full_name, 'email', v_visitor.email));
  RETURN QUERY SELECT v_visitor.id::text, v_visitor.full_name::text,
    v_visitor.email::text, v_qr::text, NULL::text;
END;
$function$;

REVOKE ALL ON FUNCTION public.verify_visitor_otp(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_visitor_otp(text, text) TO anon, authenticated;

-- Reading lists and community-request participant reads previously relied on
-- auth_user_id alone. Keep those paths unavailable until librarian approval.
CREATE OR REPLACE FUNCTION public.fetch_visitor_reading_list(p_visitor_id uuid)
RETURNS SETOF public.books
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT book.*
  FROM public.visitor_reading_list AS reading_list
  JOIN public.visitors AS visitor ON visitor.id = reading_list.visitor_id
  JOIN public.books AS book ON book.id = reading_list.book_id
  WHERE visitor.auth_user_id = auth.uid()
    AND visitor.auth_user_id = p_visitor_id
    AND visitor.otp_verified IS TRUE
    AND visitor.is_active IS TRUE
  ORDER BY reading_list.created_at DESC;
$function$;

DROP POLICY IF EXISTS "Visitors can manage own reading list" ON public.visitor_reading_list;
DROP POLICY IF EXISTS "Visitors can view own reading list" ON public.visitor_reading_list;
DROP POLICY IF EXISTS "Visitors can insert own reading list item" ON public.visitor_reading_list;
DROP POLICY IF EXISTS "Visitors can delete own reading list item" ON public.visitor_reading_list;
CREATE POLICY "Visitors can manage own reading list"
  ON public.visitor_reading_list FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.visitors AS visitor
    WHERE visitor.id = visitor_reading_list.visitor_id
      AND visitor.auth_user_id = auth.uid()
      AND visitor.otp_verified IS TRUE AND visitor.is_active IS TRUE
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.visitors AS visitor
    WHERE visitor.id = visitor_reading_list.visitor_id
      AND visitor.auth_user_id = auth.uid()
      AND visitor.otp_verified IS TRUE AND visitor.is_active IS TRUE
  ));
CREATE POLICY "Visitors can view own reading list"
  ON public.visitor_reading_list FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.visitors AS visitor
    WHERE visitor.id = visitor_reading_list.visitor_id
      AND visitor.auth_user_id = auth.uid()
      AND visitor.otp_verified IS TRUE AND visitor.is_active IS TRUE
  ));
CREATE POLICY "Visitors can insert own reading list item"
  ON public.visitor_reading_list FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.visitors AS visitor
    WHERE visitor.id = visitor_reading_list.visitor_id
      AND visitor.auth_user_id = auth.uid()
      AND visitor.otp_verified IS TRUE AND visitor.is_active IS TRUE
  ));
CREATE POLICY "Visitors can delete own reading list item"
  ON public.visitor_reading_list FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.visitors AS visitor
    WHERE visitor.id = visitor_reading_list.visitor_id
      AND visitor.auth_user_id = auth.uid()
      AND visitor.otp_verified IS TRUE AND visitor.is_active IS TRUE
  ));

DROP POLICY IF EXISTS "community request participants read" ON public.community_book_requests;
CREATE POLICY "community request participants read"
  ON public.community_book_requests FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.visitors AS visitor
      WHERE visitor.id::text = community_book_requests.owner_visitor_id::text
        AND visitor.auth_user_id = auth.uid()
        AND visitor.otp_verified IS TRUE AND visitor.is_active IS TRUE
    )
    OR EXISTS (
      SELECT 1 FROM public.visitors AS visitor
      WHERE visitor.id::text = community_book_requests.requester_visitor_id::text
        AND visitor.auth_user_id = auth.uid()
        AND visitor.otp_verified IS TRUE AND visitor.is_active IS TRUE
    )
    OR EXISTS (
      SELECT 1 FROM public.books AS book
      WHERE book.id::text = community_book_requests.book_id::text
        AND public.is_active_staff_for_branch(book.library_id::text)
    )
  );

DROP POLICY IF EXISTS "Visitors read their own fine reminder notifications"
  ON public.due_date_notifications;
CREATE POLICY "Visitors read their own fine reminder notifications"
  ON public.due_date_notifications FOR SELECT TO authenticated
  USING (
    notification_type = 'fine_reminder'
    AND EXISTS (
      SELECT 1 FROM public.visitors AS visitor
      WHERE visitor.id::text = due_date_notifications.visitor_id
        AND visitor.auth_user_id = auth.uid()
        AND visitor.otp_verified IS TRUE AND visitor.is_active IS TRUE
    )
  );

-- A pending account can read only its own verified status row. All other visitor
-- RLS and RPC checks continue to require is_active = true, so no visitor-service
-- permission is granted by email verification alone.
DROP POLICY IF EXISTS "visitor and staff read scoped visitor profiles" ON public.visitors;
CREATE POLICY "visitor and staff read scoped visitor profiles"
  ON public.visitors FOR SELECT TO authenticated
  USING (
    (auth_user_id = auth.uid() AND otp_verified IS TRUE AND (
      is_active IS TRUE OR (registration_type = 'community' AND approval_status = 'pending')
    ))
    OR public.is_active_staff_for_branch(library_id::text)
  );

CREATE OR REPLACE FUNCTION public.approve_community_visitor(p_visitor_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_visitor public.visitors%rowtype;
BEGIN
  IF auth.uid() IS NULL OR COALESCE(auth.jwt() ->> 'aal', '') <> 'aal2' THEN
    RAISE EXCEPTION 'A verified AAL2 staff session is required.' USING ERRCODE = '42501';
  END IF;
  SELECT visitor.* INTO v_visitor
  FROM public.visitors AS visitor
  WHERE visitor.id = pg_catalog.btrim(p_visitor_id)
  FOR UPDATE;
  IF v_visitor.id IS NULL THEN
    RAISE EXCEPTION 'Community visitor not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_visitor.library_id IS NULL THEN
    RAISE EXCEPTION 'The community visitor has no preferred library assigned.' USING ERRCODE = '22023';
  END IF;
  IF v_visitor.auth_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Visitors cannot approve their own accounts.' USING ERRCODE = '42501';
  END IF;
  IF v_visitor.registration_type <> 'community'
     OR v_visitor.approval_status <> 'pending'
     OR v_visitor.otp_verified IS NOT TRUE THEN
    RAISE EXCEPTION 'Only an email-verified pending community visitor can be approved.' USING ERRCODE = '22023';
  END IF;
  IF NOT public.is_active_staff_for_branch(v_visitor.library_id::text) THEN
    RAISE EXCEPTION 'You are not authorized to approve visitors for this library.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.visitors AS visitor
  SET approval_status = 'approved',
      is_active = true,
      qr_code = COALESCE(NULLIF(visitor.qr_code, ''), public.generate_visitor_qr_code())
  WHERE visitor.id = v_visitor.id;
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.approve_community_visitor(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.approve_community_visitor(text) TO authenticated;

-- Keep the existing status RPC for established accounts, but prevent it from
-- bypassing the explicit approval path for a pending community registration.
CREATE OR REPLACE FUNCTION public.set_visitor_active(p_visitor_id text, p_is_active boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_visitor public.visitors%rowtype;
BEGIN
  IF auth.uid() IS NULL OR COALESCE(auth.jwt() ->> 'aal', '') <> 'aal2' THEN
    RAISE EXCEPTION 'A verified AAL2 staff session is required.' USING ERRCODE = '42501';
  END IF;
  IF p_is_active IS NULL THEN
    RAISE EXCEPTION 'A visitor account status is required.' USING ERRCODE = '22023';
  END IF;
  SELECT visitor.* INTO v_visitor FROM public.visitors AS visitor
    WHERE visitor.id = pg_catalog.btrim(p_visitor_id) FOR UPDATE;
  IF v_visitor.id IS NULL THEN
    RAISE EXCEPTION 'Visitor account not found.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.is_active_staff_for_branch(v_visitor.library_id::text) THEN
    RAISE EXCEPTION 'You are not authorized to update this visitor account.' USING ERRCODE = '42501';
  END IF;
  IF p_is_active IS TRUE AND v_visitor.registration_type = 'community'
     AND v_visitor.approval_status = 'pending' THEN
    RAISE EXCEPTION 'Use the community visitor approval action for pending accounts.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.visitors SET is_active = p_is_active WHERE id = v_visitor.id;
  RETURN p_is_active;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_visitor_active(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_visitor_active(text, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;