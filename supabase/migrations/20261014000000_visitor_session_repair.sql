-- ============================================================================
-- VISITOR SESSION REPAIR
--
-- Fixes the RPC failures raised once a visitor reached the portal.
--
--   1. invalid input syntax for type uuid: "VIS-..."
--      store.js called get_visitor_borrow_requests(p_visitor_id text) but no
--      such function existed in the repository, so the live database still had
--      a UUID-typed overload. A VIS-* text id cannot be cast to uuid.
--
--   2. structure of query does not match function result type
--      The deployed fetch_my_community_book_requests did not agree with its own
--      RETURNS TABLE. Recreated here with explicit casts on every column so the
--      row descriptor always matches the declared OUT parameters.
--
--   3. permission denied for function fetch_owner_community_book_requests
--      Granted only to authenticated. Every visitor path now carries a real
--      Supabase session, so this resolves.
--
-- Ownership: the two request readers previously accepted any VIS-* id from an
-- unauthenticated caller and returned that visitor's rows. Both now require
-- auth.uid() to own the visitor, and the anon grants are withdrawn.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. GET VISITOR BORROW REQUESTS
--
-- borrow_requests.id is text ('REQ-*') and borrow_requests.visitor_id is text,
-- so the parameter is text. Grants are withheld here; see the grant section at
-- the end of this migration.
-- ---------------------------------------------------------------------------

drop function if exists public.get_visitor_borrow_requests(uuid);
drop function if exists public.get_visitor_borrow_requests(text);

create function public.get_visitor_borrow_requests(p_visitor_id text)
returns table (
  id text,
  book_id text,
  book_title text,
  visitor_id text,
  visitor_name text,
  status text,
  request_date timestamptz,
  pickup_deadline timestamptz,
  queue_position integer,
  borrow_date timestamptz,
  due_date timestamptz,
  return_date timestamptz,
  fine_amount numeric,
  confirmed_by text,
  return_confirmed_by text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not exists (
    select 1
    from public.visitors as visitor
    where visitor.id = trim(p_visitor_id)
      and visitor.auth_user_id = auth.uid()
  ) then
    raise exception 'The authenticated visitor account could not be verified.';
  end if;

  return query
    select
      request.id::text,
      request.book_id::text,
      request.book_title::text,
      request.visitor_id::text,
      request.visitor_name::text,
      request.status::text,
      request.request_date,
      request.pickup_deadline,
      request.queue_position,
      request.borrow_date,
      request.due_date,
      request.return_date,
      request.fine_amount::numeric,
      request.confirmed_by::text,
      request.return_confirmed_by::text
    from public.borrow_requests as request
    where request.visitor_id = trim(p_visitor_id)
    order by request.request_date desc;
end;
$$;

revoke all on function public.get_visitor_borrow_requests(text)
  from public, anon;

-- ---------------------------------------------------------------------------
-- 2. FETCH MY COMMUNITY BOOK REQUESTS
--
-- Every returned column is cast so the row descriptor matches RETURNS TABLE
-- exactly, which is what PostgREST validates.
-- ---------------------------------------------------------------------------

drop function if exists public.fetch_my_community_book_requests(uuid);
drop function if exists public.fetch_my_community_book_requests(text);

create function public.fetch_my_community_book_requests(p_requester_visitor_id text)
returns table (
  id uuid,
  book_id text,
  book_title text,
  owner_visitor_id text,
  owner_name text,
  requester_visitor_id text,
  requester_name text,
  status text,
  request_date timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  owner_response text,
  pickup_deadline timestamptz,
  borrow_date timestamptz,
  due_date timestamptz,
  return_date timestamptz,
  fine_amount numeric,
  confirmed_by text,
  return_confirmed_by text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not exists (
    select 1
    from public.visitors as visitor
    where visitor.id = trim(p_requester_visitor_id)
      and visitor.auth_user_id = auth.uid()
      and visitor.otp_verified
      and visitor.is_active
  ) then
    raise exception 'The authenticated, verified visitor account could not be found.';
  end if;

  return query
    select
      request.id,
      request.book_id::text,
      request.book_title::text,
      request.owner_visitor_id::text,
      request.owner_name::text,
      request.requester_visitor_id::text,
      request.requester_name::text,
      request.status::text,
      request.request_date,
      request.approved_at,
      request.rejected_at,
      request.owner_response::text,
      request.pickup_deadline,
      request.borrow_date,
      request.due_date,
      request.return_date,
      request.fine_amount::numeric,
      request.confirmed_by::text,
      request.return_confirmed_by::text
    from public.community_book_requests as request
    where request.requester_visitor_id = trim(p_requester_visitor_id)
    order by request.request_date desc;
end;
$$;

revoke all on function public.fetch_my_community_book_requests(text)
  from public, anon;

-- ---------------------------------------------------------------------------
-- 3. FETCH OWNER COMMUNITY BOOK REQUESTS
--
-- Recreated identically to 20261007000000 but with the explicit casts applied
-- throughout. The body already required auth.uid() ownership.
-- ---------------------------------------------------------------------------

drop function if exists public.fetch_owner_community_book_requests(uuid);
drop function if exists public.fetch_owner_community_book_requests(text);

create function public.fetch_owner_community_book_requests(p_owner_visitor_id text)
returns table (
  id uuid,
  book_id text,
  book_title text,
  owner_visitor_id text,
  owner_name text,
  requester_visitor_id text,
  requester_name text,
  status text,
  request_date timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  owner_response text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not exists (
    select 1
    from public.visitors as visitor
    where visitor.id = trim(p_owner_visitor_id)
      and visitor.auth_user_id = auth.uid()
      and visitor.otp_verified
      and visitor.is_active
  ) then
    raise exception 'The authenticated, verified visitor account could not be found.';
  end if;

  return query
    select
      request.id,
      request.book_id::text,
      request.book_title::text,
      request.owner_visitor_id::text,
      request.owner_name::text,
      request.requester_visitor_id::text,
      request.requester_name::text,
      request.status::text,
      request.request_date,
      request.approved_at,
      request.rejected_at,
      request.owner_response::text
    from public.community_book_requests as request
    where request.owner_visitor_id = trim(p_owner_visitor_id)
    order by
      case
        when request.status = 'pending' then 0
        when request.status = 'approved' then 1
        else 2
      end,
      request.request_date desc;
end;
$$;

revoke all on function public.fetch_owner_community_book_requests(text)
  from public, anon;

-- ---------------------------------------------------------------------------
-- GRANTS
--
-- All three now require an authenticated caller that owns the visitor, so they
-- are granted to authenticated only.
-- ---------------------------------------------------------------------------

grant execute on function public.get_visitor_borrow_requests(text)
  to authenticated;
grant execute on function public.fetch_my_community_book_requests(text)
  to authenticated;
grant execute on function public.fetch_owner_community_book_requests(text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- POSTGREST SCHEMA RELOAD
--
-- PostgREST caches function signatures. Without this reload the old
-- UUID-typed overload stays visible in the schema cache and the client keeps
-- receiving the same errors after the migration succeeds.
-- ---------------------------------------------------------------------------

notify pgrst, 'reload schema';