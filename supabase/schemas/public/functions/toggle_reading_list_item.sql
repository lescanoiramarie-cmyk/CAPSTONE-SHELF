CREATE OR REPLACE FUNCTION public.toggle_reading_list_item (
  p_visitor_id uuid,
  p_book_id    text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
begin
  if auth.uid() is null or auth.uid() is distinct from p_visitor_id then
    raise exception 'The authenticated visitor account could not be verified.';
  end if;

  return shelf_private.toggle_reading_list_item_unchecked(p_visitor_id, p_book_id);
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."toggle_reading_list_item"(uuid, text) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."toggle_reading_list_item"(uuid, text) FROM PUBLIC;
