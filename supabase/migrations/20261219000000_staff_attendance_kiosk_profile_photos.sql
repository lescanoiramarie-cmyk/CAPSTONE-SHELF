drop function if exists public.find_visitor_by_qr(text, uuid);

create function public.find_visitor_by_qr(
  p_qr text,
  p_library_id uuid
)
returns table (
  id text,
  full_name character varying,
  contact_number character varying,
  email character varying,
  address text,
  qr_code character varying,
  profile_image_path text
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_staff_library_id uuid;
  v_role text;
begin
  select sp.library_id, lower(sp.role)
    into v_staff_library_id, v_role
  from public.staff_profiles as sp
  where sp.id = auth.uid()
    and sp.is_active is true;

  if not found then
    raise exception 'Active staff profile required.';
  end if;

  if v_role <> 'superadmin'
     and v_staff_library_id is distinct from p_library_id
  then
    raise exception 'You are not authorized to scan for this library.';
  end if;

  return query
  select
    v.id::text,
    v.full_name,
    v.contact_number,
    v.email,
    v.address,
    v.qr_code,
    v.profile_image_path
  from public.visitors as v
  where upper(trim(v.qr_code)) = upper(trim(p_qr))
    and v.is_active is true
    and v.otp_verified is true
  limit 1;
end;
$function$;

grant execute on function public.find_visitor_by_qr(text, uuid)
  to authenticated, postgres, service_role;
revoke all on function public.find_visitor_by_qr(text, uuid) from public, anon;

drop policy if exists "Active staff can read visitor profile images"
  on storage.objects;
create policy "Active staff can read visitor profile images"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'visitor-profile-images'
  and exists (
    select 1
    from public.visitors as visitor
    join public.staff_profiles as staff
      on staff.id = auth.uid()
    where visitor.id::text = (storage.foldername(name))[1]
      and staff.is_active is true
      and (
        lower(staff.role) = 'superadmin'
        or (
          lower(staff.role) = 'subadmin'
          and staff.library_id = visitor.library_id
        )
      )
  )
);

notify pgrst, 'reload schema';
