CREATE OR REPLACE FUNCTION public.fetch_my_community_book_requests (
  p_requester_visitor_id text
)
  RETURNS TABLE (
    id                    uuid,
    book_id               text,
    book_title            text,
    owner_visitor_id      text,
    owner_name            text,
    requester_visitor_id  text,
    requester_name        text,
    status                text,
    request_date          timestamp with time zone,
    approved_at           timestamp with time zone,
    rejected_at           timestamp with time zone,
    owner_response        text,
    pickup_deadline       timestamp with time zone,
    borrow_date           timestamp with time zone,
    due_date              timestamp with time zone,
    return_date           timestamp with time zone,
    fine_amount           numeric,
    confirmed_by          text,
    return_confirmed_by   text,
    queue_position        integer,
    owner_contact_email   text,
    owner_contact_number  text,
    owner_contact_details text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  if auth.uid() is null or not exists (
    select 1
    from public.visitors visitor
    where visitor.id = trim(p_requester_visitor_id)
      and visitor.auth_user_id = auth.uid()
      and visitor.otp_verified
      and visitor.is_active
  ) then
    raise exception 'The authenticated, verified visitor account could not be found.';
  end if;

  return query
  select
    request.id::uuid,
    request.book_id::text,
    request.book_title::text,
    request.owner_visitor_id::text,
    request.owner_name::text,
    request.requester_visitor_id::text,
    request.requester_name::text,
    request.status::text,
    request.request_date::timestamptz,
    request.approved_at::timestamptz,
    request.rejected_at::timestamptz,
    request.owner_response::text,
    request.pickup_deadline::timestamptz,
    request.borrow_date::timestamptz,
    request.due_date::timestamptz,
    request.return_date::timestamptz,
    request.fine_amount::numeric,
    request.confirmed_by::text,
    request.return_confirmed_by::text,
    case
      when request.status = 'pending' then (
        select count(*)::integer
        from public.community_book_requests earlier
        where earlier.book_id = request.book_id
          and earlier.status = 'pending'
          and (earlier.request_date, earlier.id)
            <= (request.request_date, request.id)
      )
      else null::integer
    end,
    case
      when request.status in ('approved', 'borrowed')
        then owner.email::text
      else null::text
    end,
    case
      when request.status in ('approved', 'borrowed')
        then owner.contact_number::text
      else null::text
    end,
    case
      when request.status in ('approved', 'borrowed')
        then book.handover_details::text
      else null::text
    end
  from public.community_book_requests request
  left join public.visitors owner
    on owner.id = request.owner_visitor_id
  left join public.books book
    on book.id = request.book_id
  where request.requester_visitor_id = trim(p_requester_visitor_id)
  order by request.request_date desc;
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fetch_my_community_book_requests"(text) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."fetch_my_community_book_requests"(text) FROM PUBLIC;
