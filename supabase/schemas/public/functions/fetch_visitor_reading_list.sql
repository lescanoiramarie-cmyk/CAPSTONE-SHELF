CREATE OR REPLACE FUNCTION public.fetch_visitor_reading_list (
  p_visitor_id uuid
)
  RETURNS SETOF public.books
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
begin
  if auth.uid() is null or auth.uid() is distinct from p_visitor_id then
    raise exception 'The authenticated visitor account could not be verified.';
  end if;

  return query
  select *
  from shelf_private.fetch_visitor_reading_list_unchecked(p_visitor_id);
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fetch_visitor_reading_list"(uuid) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."fetch_visitor_reading_list"(uuid) FROM PUBLIC;
