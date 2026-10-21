CREATE OR REPLACE FUNCTION public.is_shelf_superadmin()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM public.staff_profiles
        WHERE id = auth.uid()
          AND role = 'superadmin'
          AND is_active = true
    );
$function$;

GRANT EXECUTE ON FUNCTION "public"."is_shelf_superadmin"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";
