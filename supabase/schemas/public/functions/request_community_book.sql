CREATE OR REPLACE FUNCTION public.request_community_book (
  p_requester_visitor_id text,
  p_book_id              text
)
  RETURNS TABLE (
    id                   uuid,
    book_id              text,
    book_title           text,
    owner_visitor_id     text,
    owner_name           text,
    requester_visitor_id text,
    requester_name       text,
    status               text,
    request_date         timestamp with time zone,
    owner_response       text,
    queue_position       integer
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  requester public.visitors%rowtype;
  book_row public.books%rowtype;
  request_row public.community_book_requests%rowtype;
  position_value integer;
begin
  select visitor.* into requester
  from public.visitors visitor
  where visitor.auth_user_id = auth.uid()
    and (
      visitor.id = trim(p_requester_visitor_id)
      or visitor.auth_user_id::text = trim(p_requester_visitor_id)
    )
    and visitor.otp_verified
    and visitor.is_active;
  if not found then
    raise exception 'The authenticated, verified visitor account could not be found.';
  end if;

  select book.* into book_row
  from public.books book
  where book.id = trim(p_book_id)
    and book.book_type = 'personal'
    and book.is_public
    and book.lending_enabled
  for update;
  if not found then
    raise exception 'This is not available for community lending.';
  end if;
  if book_row.owner_visitor_id = requester.id then
    raise exception 'You cannot request your own personal book.';
  end if;
  if exists (
    select 1
    from public.community_book_requests request
    where request.book_id = book_row.id
      and request.requester_visitor_id = requester.id
      and request.status in ('pending', 'approved', 'borrowed')
  ) then
    raise exception 'You already have an active request for this community book.';
  end if;

  select count(*)::integer + 1 into position_value
  from public.community_book_requests request
  where request.book_id = book_row.id
    and request.status = 'pending';

  insert into public.community_book_requests (
    book_id,
    book_title,
    owner_visitor_id,
    owner_name,
    requester_visitor_id,
    requester_name,
    status,
    queue_position
  ) values (
    book_row.id,
    book_row.title,
    book_row.owner_visitor_id,
    coalesce(
      (
        select owner.full_name
        from public.visitors owner
        where owner.id = book_row.owner_visitor_id
      ),
      'Book owner'
    ),
    requester.id,
    requester.full_name,
    'pending',
    position_value
  )
  returning * into request_row;

  return query
  select
    request_row.id::uuid,
    request_row.book_id::text,
    request_row.book_title::text,
    request_row.owner_visitor_id::text,
    request_row.owner_name::text,
    request_row.requester_visitor_id::text,
    request_row.requester_name::text,
    request_row.status::text,
    request_row.request_date::timestamptz,
    request_row.owner_response::text,
    request_row.queue_position::integer;
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."request_community_book"(text, text) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."request_community_book"(text, text) FROM PUBLIC;
