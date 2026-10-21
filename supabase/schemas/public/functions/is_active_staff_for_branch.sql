CREATE OR REPLACE FUNCTION public.is_active_staff_for_branch (
  p_branch_id text DEFAULT NULL::text
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select exists (
    select 1
    from public.staff_profiles staff
    where staff.id = auth.uid()
      and staff.is_active
      and (
        staff.role = 'superadmin'
        or (staff.role = 'subadmin' and p_branch_id is not null
          and staff.library_id::text = p_branch_id)
      )
      and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', staff.role) = staff.role
  );
$function$;

GRANT EXECUTE ON FUNCTION "public"."is_active_staff_for_branch"(text) TO "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."is_active_staff_for_branch"(text) FROM PUBLIC;
