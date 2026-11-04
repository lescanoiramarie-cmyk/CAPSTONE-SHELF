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
);
