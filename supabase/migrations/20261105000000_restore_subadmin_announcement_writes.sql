alter table public.libraries
  add column if not exists email_domain text;

create or replace function public.enforce_visitor_email_domain()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  visitor_domain text;
begin
  if coalesce(new.raw_user_meta_data ->> 'role', '') <> 'visitor' then
    return new;
  end if;

  visitor_domain := lower(split_part(trim(new.email), '@', 2));

  if visitor_domain = 'gmail.com' then
    return new;
  end if;

  if not exists (
    select 1
    from public.libraries library
    where nullif(trim(both '@.' from lower(trim(library.email_domain))), '') is not null
      and (
        visitor_domain = trim(both '@.' from lower(trim(library.email_domain)))
        or right(
          visitor_domain,
          length(trim(both '@.' from lower(trim(library.email_domain)))) + 1
        ) = '.' || trim(both '@.' from lower(trim(library.email_domain)))
      )
  ) then
    raise exception 'Visitor registration is limited to Gmail and configured partner school email domains.';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_visitor_email_domain() from public, anon, authenticated;

drop trigger if exists on_auth_user_visitor_domain_validate on auth.users;
create trigger on_auth_user_visitor_domain_validate
  before insert on auth.users
  for each row execute function public.enforce_visitor_email_domain();

alter table public.announcements
  add column if not exists library_id uuid references public.libraries(id) on delete set null;

drop policy if exists "staff manage announcements" on public.announcements;

create policy "staff manage announcements" on public.announcements
  for all to authenticated
  using (
    exists (
      select 1
      from public.staff_profiles staff
      where staff.id = auth.uid()
        and staff.is_active
        and staff.role = 'superadmin'
        and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', staff.role) = staff.role
    )
      or public.is_active_staff_for_branch(library_id::text)
  )
  with check (
    exists (
      select 1
      from public.staff_profiles staff
      where staff.id = auth.uid()
        and staff.is_active
        and staff.role = 'superadmin'
        and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', staff.role) = staff.role
    )
      or public.is_active_staff_for_branch(library_id::text)
  );