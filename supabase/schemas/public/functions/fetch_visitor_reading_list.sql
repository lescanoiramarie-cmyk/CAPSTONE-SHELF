CREATE OR REPLACE FUNCTION public.fetch_visitor_reading_list (
  p_visitor_id uuid
)
  RETURNS SETOF public.books
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select b.*
  from public.visitor_reading_list r
  join public.visitors v on v.id = r.visitor_id
  join public.books b on b.id = r.book_id
  where v.auth_user_id = p_visitor_id
  order by r.created_at desc;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fetch_visitor_reading_list"(uuid) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";
