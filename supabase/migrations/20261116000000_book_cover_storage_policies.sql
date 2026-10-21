insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'book-covers',
  'book-covers',
  true,
  5242880,
  array['image/jpeg', 'image/png']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Book covers are publicly readable" on storage.objects;
create policy "Book covers are publicly readable"
on storage.objects
for select
to public
using (bucket_id = 'book-covers');

drop policy if exists "Staff can upload branch book covers" on storage.objects;
create policy "Staff can upload branch book covers"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'book-covers'
  and array_length(storage.foldername(name), 1) = 2
  and (storage.foldername(name))[1] = 'books'
  and public.is_active_staff_for_branch((storage.foldername(name))[2])
);

drop policy if exists "Staff can update branch book covers" on storage.objects;
create policy "Staff can update branch book covers"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'book-covers'
  and array_length(storage.foldername(name), 1) = 2
  and (storage.foldername(name))[1] = 'books'
  and public.is_active_staff_for_branch((storage.foldername(name))[2])
)
with check (
  bucket_id = 'book-covers'
  and array_length(storage.foldername(name), 1) = 2
  and (storage.foldername(name))[1] = 'books'
  and public.is_active_staff_for_branch((storage.foldername(name))[2])
);

drop policy if exists "Staff can delete branch book covers" on storage.objects;
create policy "Staff can delete branch book covers"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'book-covers'
  and array_length(storage.foldername(name), 1) = 2
  and (storage.foldername(name))[1] = 'books'
  and public.is_active_staff_for_branch((storage.foldername(name))[2])
);
