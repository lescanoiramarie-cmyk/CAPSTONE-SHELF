-- OPAC Book Count RPCs - CORRECTED VERSION
-- Fixes: SECURITY DEFINER bypassing RLS, missing authorization, predicate mismatches
-- Uses SECURITY INVOKER (default) to respect RLS, with explicit grants

-- Drop existing insecure functions
drop function if exists public.get_opac_library_book_count();
drop function if exists public.get_opac_total_book_count();
drop function if exists public.get_opac_library_book_count_by_library(uuid);
drop function if exists public.get_opac_filtered_book_count(text, text, uuid, text);

-- ============================================================================
-- HELPER: Check if current user has staff access to a library
-- ============================================================================
create or replace function public.opac_has_library_access(p_library_id uuid)
returns boolean
language sql
security invoker
set search_path = public
as $$
  select case
    when p_library_id is null then true
    when auth.uid() is null then false
    else public.is_active_staff_for_branch(p_library_id::text)
  end;
$$;

-- ============================================================================
-- Count of library books visible to current auth context (respects RLS)
-- ============================================================================
create or replace function public.get_opac_library_book_count()
returns bigint
language sql
security invoker
set search_path = public
as $$
  select count(*)
  from public.books
  where book_type = 'library';
$$;

-- ============================================================================
-- Count of all books visible in OPAC (library + public personal + external catalog)
-- Respects RLS for the current user
-- ============================================================================
create or replace function public.get_opac_total_book_count()
returns bigint
language sql
security invoker
set search_path = public
as $$
  select (
    select count(*) from public.books where book_type = 'library'
  ) + (
    select count(*) from public.books where book_type = 'personal' and is_public = true
  ) + (
    select count(*) from public.external_catalog_books
  );
$$;

-- ============================================================================
-- Count of library books for a specific library (branch-scoped for sub-admin)
-- Requires staff authorization for the library
-- ============================================================================
create or replace function public.get_opac_library_book_count_by_library(p_library_id uuid)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- Authorization: only staff with access to the library can query branch-scoped counts
  if not public.opac_has_library_access(p_library_id) then
    raise exception 'Insufficient privileges for library %', p_library_id
      using errcode = '42501';
  end if;

  return (
    select count(*)
    from public.books
    where book_type = 'library'
      and library_id = p_library_id
  );
end;
$$;

-- ============================================================================
-- Count of books matching search/filter criteria (for OPAC pagination)
-- Matches OPACCatalog filter logic exactly
-- ============================================================================
create or replace function public.get_opac_filtered_book_count(
  p_search text default '',
  p_category text default 'All',
  p_library_id uuid default null,
  p_availability text default 'All'
)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count bigint;
  v_normalized_search text;
  v_normalized_category text;
  v_caller_auth_uid uuid;
begin
  v_normalized_search := lower(trim(coalesce(p_search, '')));
  v_normalized_category := lower(trim(coalesce(p_category, 'All')));
  v_caller_auth_uid := auth.uid();

  -- Authorization for library-scoped queries
  if p_library_id is not null and not public.opac_has_library_access(p_library_id) then
    raise exception 'Insufficient privileges for library %', p_library_id
      using errcode = '42501';
  end if;

  -- Count physical library books matching criteria (respects RLS)
  select count(*) into v_count
  from public.books b
  where b.book_type = 'library'
    and (v_normalized_search = '' or
         lower(b.title) like '%' || v_normalized_search || '%' or
         lower(b.author) like '%' || v_normalized_search || '%' or
         lower(b.isbn) like '%' || v_normalized_search || '%' or
         lower(b.category) like '%' || v_normalized_search || '%' or
         lower(b.call_number) like '%' || v_normalized_search || '%')
    and (v_normalized_category = 'all' or lower(b.category) = v_normalized_category)
    and (p_library_id is null or b.library_id = p_library_id)
    and (p_availability = 'All' or
         (p_availability = 'Available' and b.available_copies > 0) or
         (p_availability = 'Unavailable' and b.available_copies = 0));

  -- Add external catalog books matching criteria
  -- External books have no copies (always "unavailable"), include only when availability allows
  if p_availability = 'All' or p_availability = 'Unavailable' then
    select v_count + count(*) into v_count
    from public.external_catalog_books ecb
    where (v_normalized_search = '' or
           lower(ecb.title) like '%' || v_normalized_search || '%' or
           lower(ecb.author) like '%' || v_normalized_search || '%' or
           lower(ecb.isbn) like '%' || v_normalized_search || '%' or
           lower(ecb.category) like '%' || v_normalized_search || '%')
      and (v_normalized_category = 'all' or lower(ecb.category) = v_normalized_category);
  end if;

  return v_count;
end;
$$;

-- ============================================================================
-- GRANTS - Only authenticated users for library-scoped, anon+authenticated for general
-- ============================================================================

-- General counts: anon and authenticated can execute
revoke all on function public.get_opac_library_book_count() from public;
grant execute on function public.get_opac_library_book_count() to anon, authenticated;

revoke all on function public.get_opac_total_book_count() from public;
grant execute on function public.get_opac_total_book_count() to anon, authenticated;

-- Branch-scoped counts: only authenticated (staff) can execute
revoke all on function public.get_opac_library_book_count_by_library(uuid) from public;
grant execute on function public.get_opac_library_book_count_by_library(uuid) to authenticated;

-- Filtered counts: anon and authenticated can execute (RLS handles visibility)
revoke all on function public.get_opac_filtered_book_count(text, text, uuid, text) from public;
grant execute on function public.get_opac_filtered_book_count(text, text, uuid, text) to anon, authenticated;

-- Helper function
revoke all on function public.opac_has_library_access(uuid) from public;
grant execute on function public.opac_has_library_access(uuid) to authenticated;