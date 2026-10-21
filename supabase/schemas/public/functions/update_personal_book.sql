CREATE OR REPLACE FUNCTION public.update_personal_book (
  p_visitor_id          text,
  p_book_id             text,
  p_title               text,
  p_author              text,
  p_category            text,
  p_isbn                text,
  p_summary             text,
  p_condition           text,
  p_lending_period_days integer,
  p_handover_method     text,
  p_handover_details    text,
  p_lending_enabled     boolean,
  p_total_copies        integer,
  p_is_public           boolean
)
  RETURNS public.books
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

  if nullif(trim(p_title), '') is null
    or nullif(trim(p_author), '') is null then
    raise exception 'Book title and author are required.';
  end if;

  if p_total_copies is null or p_total_copies < 1 then
    raise exception 'Copy count must be a whole number of at least 1.';
  end if;

  if p_lending_period_days is null
    or p_lending_period_days < 1
    or p_lending_period_days > 30 then
    raise exception 'Lending period must be between 1 and 30 days.';
  end if;

  if p_condition is null
    or p_condition not in ('New', 'Like New', 'Good', 'Fair', 'Poor') then
    raise exception 'Invalid book condition.';
  end if;

  if p_handover_method is null
    or p_handover_method not in (
    'meet_in_person',
    'public_place',
    'courier',
    'arrange_with_owner'
  ) then
    raise exception 'Invalid handover method.';
  end if;

  if length(coalesce(p_handover_details, '')) > 500 then
    raise exception 'Handover details must not exceed 500 characters.';
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
      and request.status in ('pending', 'approved', 'borrowed')
  ) or book_row.available_copies < book_row.total_copies then
    raise exception 'This book cannot be edited while a community request or loan is active.';
  end if;

  update public.books
  set title = trim(p_title),
      author = trim(p_author),
      category = nullif(trim(p_category), ''),
      isbn = nullif(trim(p_isbn), ''),
      summary = nullif(trim(p_summary), ''),
      condition = nullif(trim(p_condition), ''),
      lending_period_days = p_lending_period_days,
      handover_method = nullif(trim(p_handover_method), ''),
      handover_details = nullif(trim(p_handover_details), ''),
      lending_enabled = coalesce(p_lending_enabled, false),
      is_public = coalesce(p_is_public, false),
      total_copies = p_total_copies,
      available_copies = p_total_copies
  where id = book_row.id
  returning * into book_row;

  return book_row;
end;
$function$;

GRANT EXECUTE
  ON FUNCTION "public"."update_personal_book"(text, text, text, text, text, text, text, text, integer, text, text, boolean, integer, boolean)
  TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."update_personal_book"(text, text, text, text, text, text, text, text, integer, text, text, boolean, integer, boolean) FROM PUBLIC;
