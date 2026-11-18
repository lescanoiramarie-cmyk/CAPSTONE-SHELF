-- OPAC Book Count RPCs for accurate, authorized counting
-- Provides exact counts respecting RLS and authorization context

-- Count of library books visible to current auth context (anon or authenticated)
create or replace function public.get_opac_library_book_count()
returns bigint
language sql
security definer
set search_path = public
as $$
  select count(*)
  from public.books
  where book_type = 'library';
$$;

-- Count of all books visible in OPAC (library + public personal + external catalog)
create or replace function public.get_opac_total_book_count()
returns bigint
language sql
security definer
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

-- Count of library books for a specific library (for sub-admin branch scoping)
create or replace function public.get_opac_library_book_count_by_library(p_library_id uuid)
returns bigint
language sql
security definer
set search_path = public
as $$
  select count(*)
  from public.books
  where book_type = 'library'
    and library_id = p_library_id;
$$;

-- Count of books matching search/filter criteria (for OPAC pagination)
create or replace function public.get_opac_filtered_book_count(
  p_search text default '',
  p_category text default 'All',
  p_library_id uuid default null,
  p_availability text default 'All'
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count bigint;
  v_normalized_search text;
  v_normalized_category text;
begin
  v_normalized_search := lower(trim(coalesce(p_search, '')));
  v_normalized_category := lower(trim(coalesce(p_category, 'All')));

  -- Count physical books matching criteria
  select count(*) into v_count
  from public.books b
  where b.book_type = 'library'
    and (v_normalized_search = '' or
         lower(b.title) like '%' || v_normalized_search || '%' or
         lower(b.author) like '%' || v_normalized_search || '%' or
         lower(b.isbn) like '%' || v_normalized_search || '%' or
         lower(b.category) like '%' || v_normalized_search || '%')
    and (v_normalized_category = 'all' or lower(b.category) = v_normalized_category)
    and (p_library_id is null or b.library_id = p_library_id)
    and (p_availability = 'All' or
         (p_availability = 'Available' and b.available_copies > 0) or
         (p_availability = 'Unavailable' and b.available_copies = 0));

  -- Add external catalog books matching criteria
  select v_count + count(*) into v_count
  from public.external_catalog_books ecb
  where (v_normalized_search = '' or
         lower(ecb.title) like '%' || v_normalized_search || '%' or
         lower(ecb.author) like '%' || v_normalized_search || '%' or
         lower(ecb.isbn) like '%' || v_normalized_search || '%' or
         lower(ecb.category) like '%' || v_normalized_search || '%')
    and (v_normalized_category = 'all' or lower(ecb.category) = v_normalized_category);

  return v_count;
end;
$$;

-- Grants
revoke all on function public.get_opac_library_book_count() from public, anon;
grant execute on function public.get_opac_library_book_count() to anon, authenticated;

revoke all on function public.get_opac_total_book_count() from public, anon;
grant execute on function public.get_opac_total_book_count() to anon, authenticated;

revoke all on function public.get_opac_library_book_count_by_library(uuid) from public, anon;
grant execute on function public.get_opac_library_book_count_by_library(uuid) to anon, authenticated;

revoke all on function public.get_opac_filtered_book_count(text, text, uuid, text) from public, anon;
grant execute on function public.get_opac_filtered_book_count(text, text, uuid, text) to anon, authenticated;