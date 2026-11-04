alter table public.visitors
  add column if not exists profile_image_path text;

grant select on public.visitors to authenticated;
revoke update on public.visitors from authenticated;
revoke update (contact_number, address, profile_image_path)
  on public.visitors from authenticated;
grant update (contact_number, address, profile_image_path)
  on public.visitors to authenticated;

drop policy if exists "Visitors can update own profile"
  on public.visitors;
create policy "Visitors can update own profile"
on public.visitors
for update
to authenticated
using (
  auth_user_id = auth.uid()
  and otp_verified
  and is_active
)
with check (
  auth_user_id = auth.uid()
  and otp_verified
  and is_active
);

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'visitor-profile-images',
  'visitor-profile-images',
  false,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Visitor profile images are publicly readable"
  on storage.objects;
drop policy if exists "Visitors can read own profile images"
  on storage.objects;
create policy "Visitors can read own profile images"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'visitor-profile-images'
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

drop policy if exists "Visitors can upload own profile images"
  on storage.objects;
create policy "Visitors can upload own profile images"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'visitor-profile-images'
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

drop policy if exists "Visitors can update own profile images"
  on storage.objects;
create policy "Visitors can update own profile images"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'visitor-profile-images'
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
  bucket_id = 'visitor-profile-images'
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

drop policy if exists "Visitors can delete own profile images"
  on storage.objects;
create policy "Visitors can delete own profile images"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'visitor-profile-images'
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

notify pgrst, 'reload schema';
