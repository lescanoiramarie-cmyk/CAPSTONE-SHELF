CREATE OR REPLACE FUNCTION shelf_private.fetch_visitor_reading_list_unchecked (
  p_visitor_id uuid
)
  RETURNS SETOF public.books
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
  select b.*
  from public.visitor_reading_list r
  join public.visitors v on v.id = r.visitor_id
  join public.books b on b.id = r.book_id
  where v.auth_user_id = p_visitor_id
  order by r.created_at desc;
$function$;

GRANT EXECUTE ON FUNCTION "shelf_private"."fetch_visitor_reading_list_unchecked"(uuid) TO "postgres";

REVOKE ALL ON FUNCTION "shelf_private"."fetch_visitor_reading_list_unchecked"(uuid) FROM PUBLIC;
