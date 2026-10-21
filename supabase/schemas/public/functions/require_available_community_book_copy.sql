CREATE OR REPLACE FUNCTION public.require_available_community_book_copy()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  available_count integer;
begin
  if new.status = 'pending' then
    select book.available_copies
    into available_count
    from public.books as book
    where book.id = new.book_id
      and book.book_type = 'personal'
      and book.is_public = true
      and book.lending_enabled = true
    for update;

    if not found then
      raise exception 'This community book is private or unavailable for lending.';
    end if;
    if coalesce(available_count, 0) < 1 then
      raise exception 'This community book is currently borrowed and unavailable.';
    end if;
  end if;

  return new;
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."require_available_community_book_copy"() TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."require_available_community_book_copy"() FROM PUBLIC;
