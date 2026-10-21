CREATE OR REPLACE FUNCTION public.delete_personal_book (
  p_visitor_id text,
  p_book_id    text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  book_row public.books%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.visitors visitor
    where visitor.id = trim(p_visitor_id)
      and visitor.auth_user_id = auth.uid()
      and visitor.otp_verified
      and visitor.is_active
  ) then
    raise exception 'The authenticated, verified visitor account could not be found.';
  end if;

  select book.* into book_row
  from public.books book
  where book.id::text = trim(p_book_id)
    and book.book_type = 'personal'
    and book.owner_visitor_id = trim(p_visitor_id)
  for update;

  if not found then
    raise exception 'This personal book could not be found.';
  end if;

  if exists (
    select 1
    from public.community_book_requests request
    where request.book_id = book_row.id::text
  ) then
    raise exception 'This book has community request history and cannot be removed. You can make it private and disable lending instead.';
  end if;

  if book_row.available_copies < book_row.total_copies then
    raise exception 'This book cannot be removed while copies are on loan.';
  end if;

  delete from public.books
  where id = book_row.id
    and book_type = 'personal'
    and owner_visitor_id = trim(p_visitor_id);

  return true;
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."delete_personal_book"(text, text) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."delete_personal_book"(text, text) FROM PUBLIC;
