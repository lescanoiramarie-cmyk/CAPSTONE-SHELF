update public.visitors
set terms_accepted_at = coalesce(terms_accepted_at, registered_at, now())
where terms_accepted_at is null;

update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']::text[]
where id = 'book-covers';

drop policy if exists "Visitors can upload personal book covers"
on storage.objects;

create policy "Visitors can upload personal book covers"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'book-covers'
  and array_length(storage.foldername(name), 1) = 1
  and exists (
    select 1
    from public.visitors visitor
    where visitor.id::text = (storage.foldername(name))[1]
      and visitor.auth_user_id = auth.uid()
      and visitor.otp_verified
      and visitor.is_active
  )
  and metadata->>'mimetype' in ('image/jpeg', 'image/png', 'image/webp')
  and case
    when coalesce(metadata->>'size', '') ~ '^[0-9]+$'
      then (metadata->>'size')::bigint <= 2097152
    else false
  end
);

drop policy if exists "Visitors can update personal book covers"
on storage.objects;

create policy "Visitors can update personal book covers"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'book-covers'
  and array_length(storage.foldername(name), 1) = 1
  and exists (
    select 1
    from public.visitors visitor
    where visitor.id::text = (storage.foldername(name))[1]
      and visitor.auth_user_id = auth.uid()
      and visitor.otp_verified
      and visitor.is_active
  )
)
with check (
  bucket_id = 'book-covers'
  and array_length(storage.foldername(name), 1) = 1
  and exists (
    select 1
    from public.visitors visitor
    where visitor.id::text = (storage.foldername(name))[1]
      and visitor.auth_user_id = auth.uid()
      and visitor.otp_verified
      and visitor.is_active
  )
  and metadata->>'mimetype' in ('image/jpeg', 'image/png', 'image/webp')
  and case
    when coalesce(metadata->>'size', '') ~ '^[0-9]+$'
      then (metadata->>'size')::bigint <= 2097152
    else false
  end
);

drop policy if exists "Visitors can delete personal book covers"
on storage.objects;

create policy "Visitors can delete personal book covers"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'book-covers'
  and array_length(storage.foldername(name), 1) = 1
  and exists (
    select 1
    from public.visitors visitor
    where visitor.id::text = (storage.foldername(name))[1]
      and visitor.auth_user_id = auth.uid()
      and visitor.otp_verified
      and visitor.is_active
  )
);

create or replace function public.add_personal_book_with_cover(
  p_visitor_id text,
  p_title text,
  p_author text,
  p_category text,
  p_isbn text,
  p_summary text,
  p_condition text,
  p_lending_period_days integer,
  p_handover_method text,
  p_handover_details text,
  p_lending_enabled boolean,
  p_total_copies integer,
  p_is_public boolean,
  p_cover_url text
)
returns public.books
language plpgsql
security definer
set search_path = public
as $$
declare
  book_row public.books%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.visitors visitor
    where visitor.id::text = trim(p_visitor_id)
      and visitor.auth_user_id = auth.uid()
      and visitor.otp_verified
      and visitor.is_active
  ) then
    raise exception 'The authenticated, verified visitor account could not be found.';
  end if;

  book_row := public.add_personal_book(
    p_visitor_id,
    p_title,
    p_author,
    p_category,
    p_isbn,
    p_summary,
    p_condition,
    p_lending_period_days,
    p_handover_method,
    p_handover_details,
    p_lending_enabled,
    p_total_copies,
    p_is_public
  );

  update public.books
  set cover_url = nullif(trim(p_cover_url), '')
  where id = book_row.id
    and book_type = 'personal'
    and owner_visitor_id::text = trim(p_visitor_id)
  returning * into book_row;

  if not found then
    raise exception 'The personal book cover could not be saved.';
  end if;

  return book_row;
end;
$$;

revoke all on function public.add_personal_book_with_cover(
  text, text, text, text, text, text, text, integer, text, text, boolean,
  integer, boolean, text
) from public, anon;
grant execute on function public.add_personal_book_with_cover(
  text, text, text, text, text, text, text, integer, text, text, boolean,
  integer, boolean, text
) to authenticated;

create or replace function public.update_personal_book_with_cover(
  p_visitor_id text,
  p_book_id text,
  p_title text,
  p_author text,
  p_category text,
  p_isbn text,
  p_summary text,
  p_condition text,
  p_lending_period_days integer,
  p_handover_method text,
  p_handover_details text,
  p_lending_enabled boolean,
  p_total_copies integer,
  p_is_public boolean,
  p_cover_url text
)
returns public.books
language plpgsql
security definer
set search_path = public
as $$
declare
  book_row public.books%rowtype;
begin
  book_row := public.update_personal_book(
    p_visitor_id,
    p_book_id,
    p_title,
    p_author,
    p_category,
    p_isbn,
    p_summary,
    p_condition,
    p_lending_period_days,
    p_handover_method,
    p_handover_details,
    p_lending_enabled,
    p_total_copies,
    p_is_public
  );

  update public.books
  set cover_url = nullif(trim(p_cover_url), '')
  where id = book_row.id
    and book_type = 'personal'
    and owner_visitor_id::text = trim(p_visitor_id)
  returning * into book_row;

  if not found then
    raise exception 'The personal book cover could not be saved.';
  end if;

  return book_row;
end;
$$;

revoke all on function public.update_personal_book_with_cover(
  text, text, text, text, text, text, text, text, integer, text, text,
  boolean, integer, boolean, text
) from public, anon;
grant execute on function public.update_personal_book_with_cover(
  text, text, text, text, text, text, text, text, integer, text, text,
  boolean, integer, boolean, text
) to authenticated;

notify pgrst, 'reload schema';
