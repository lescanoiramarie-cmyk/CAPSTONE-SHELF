CREATE OR REPLACE FUNCTION public.accept_subadmin_terms()
  RETURNS timestamp WITH time zone
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  staff_row public.staff_profiles%rowtype;
  accepted_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'A signed-in sub-admin session is required.';
  end if;

  select staff.*
    into staff_row
  from public.staff_profiles staff
  where staff.id = auth.uid()
    and staff.role = 'subadmin'
    and staff.is_active
    and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', staff.role) = staff.role;

  if not found then
    raise exception 'The active sub-admin account could not be found.';
  end if;

  insert into public.staff_terms_acceptances (
    staff_user_id,
    staff_name,
    staff_email,
    staff_role,
    library_id,
    terms_version
  )
  values (
    staff_row.id,
    staff_row.full_name,
    staff_row.email,
    staff_row.role,
    staff_row.library_id,
    '2026-11-04-v1'
  )
  on conflict (staff_user_id, terms_version) do nothing;

  select acceptance.accepted_at
    into accepted_at
  from public.staff_terms_acceptances acceptance
  where acceptance.staff_user_id = auth.uid()
    and acceptance.terms_version = '2026-11-04-v1';

  return accepted_at;
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."accept_subadmin_terms"() TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."accept_subadmin_terms"() FROM PUBLIC, anon;
