CREATE OR REPLACE FUNCTION public.update_community_book_copy_availability()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  if tg_op = 'INSERT' then
    if new.status in ('approved', 'borrowed') then
      update public.books
      set available_copies = available_copies - 1
      where id = new.book_id
        and book_type = 'personal'
        and available_copies > 0;

      if not found then
        raise exception 'No copies of this community book are currently available.';
      end if;
    end if;
  elsif tg_op = 'UPDATE' then
    if old.status not in ('approved', 'borrowed')
      and new.status in ('approved', 'borrowed')
    then
      update public.books
      set available_copies = available_copies - 1
      where id = new.book_id
        and book_type = 'personal'
        and available_copies > 0;

      if not found then
        raise exception 'No copies of this community book are currently available.';
      end if;
    elsif old.status in ('approved', 'borrowed')
      and new.status not in ('approved', 'borrowed')
    then
      update public.books
      set available_copies = least(
        coalesce(total_copies, 1),
        available_copies + 1
      )
      where id = old.book_id
        and book_type = 'personal';
    end if;
  end if;

  return new;
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."update_community_book_copy_availability"() TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."update_community_book_copy_availability"() FROM PUBLIC;
