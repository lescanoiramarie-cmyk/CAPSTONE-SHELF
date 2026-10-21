CREATE OR REPLACE FUNCTION public.add_personal_book (
  p_visitor_id          text,
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

  insert into public.books (
    title,
    author,
    category,
    isbn,
    summary,
    book_type,
    owner_visitor_id,
    is_public,
    lending_enabled,
    condition,
    lending_period_days,
    handover_method,
    handover_details,
    total_copies,
    available_copies
  )
  values (
    trim(p_title),
    trim(p_author),
    nullif(trim(p_category), ''),
    nullif(trim(p_isbn), ''),
    nullif(trim(p_summary), ''),
    'personal',
    trim(p_visitor_id),
    coalesce(p_is_public, false),
    coalesce(p_lending_enabled, false),
    nullif(trim(p_condition), ''),
    p_lending_period_days,
    nullif(trim(p_handover_method), ''),
    nullif(trim(p_handover_details), ''),
    p_total_copies,
    p_total_copies
  )
  returning * into book_row;

  return book_row;
end;
$function$;

GRANT EXECUTE
  ON FUNCTION "public"."add_personal_book"(text, text, text, text, text, text, text, integer, text, text, boolean, integer, boolean)
  TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."add_personal_book"(text, text, text, text, text, text, text, integer, text, text, boolean, integer, boolean) FROM PUBLIC;
