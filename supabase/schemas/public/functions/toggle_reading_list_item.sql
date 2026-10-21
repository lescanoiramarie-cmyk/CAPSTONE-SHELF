CREATE OR REPLACE FUNCTION public.toggle_reading_list_item (
  p_visitor_id uuid,
  p_book_id    text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_visitor_id text;
  v_exists boolean;
begin
  if p_visitor_id is null or p_book_id is null then
    raise exception 'Visitor ID and Book ID are required.';
  end if;

  select v.id
  into v_visitor_id
  from public.visitors v
  where v.auth_user_id = p_visitor_id;

  if v_visitor_id is null then
    raise exception 'Visitor profile could not be resolved from the supplied auth user.';
  end if;

  select exists (
    select 1
    from public.visitor_reading_list
    where visitor_id = v_visitor_id
      and book_id = p_book_id
  )
  into v_exists;

  if v_exists then
    delete from public.visitor_reading_list
    where visitor_id = v_visitor_id
      and book_id = p_book_id;

    return false;
  end if;

  insert into public.visitor_reading_list (id, visitor_id, book_id)
  values (gen_random_uuid(), v_visitor_id, p_book_id)
  on conflict (visitor_id, book_id) do nothing;

  return exists (
    select 1
    from public.visitor_reading_list
    where visitor_id = v_visitor_id
      and book_id = p_book_id
  );
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."toggle_reading_list_item"(uuid, text) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";
