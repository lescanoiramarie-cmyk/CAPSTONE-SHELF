-- Version visitor terms so returning visitors must acknowledge the updated
-- notice instead of relying on an acceptance timestamp for an older version.
alter table public.visitors
  add column if not exists terms_version text;

create or replace function public.get_visitor_terms_accepted_at()
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  accepted_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'A signed-in visitor session is required.';
  end if;

  select visitor.terms_accepted_at
    into accepted_at
  from public.visitors visitor
  where visitor.auth_user_id = auth.uid()
    and visitor.otp_verified
    and visitor.is_active
    and visitor.terms_version = '2026-11-04-v2';

  if not found then
    if not exists (
      select 1
      from public.visitors visitor
      where visitor.auth_user_id = auth.uid()
        and visitor.otp_verified
        and visitor.is_active
    ) then
      raise exception 'The active visitor account could not be found.';
    end if;
    return null;
  end if;

  return accepted_at;
end;
$$;

create or replace function public.accept_visitor_terms()
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  accepted_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'A signed-in visitor session is required.';
  end if;

  update public.visitors visitor
  set terms_accepted_at = now(),
      terms_version = '2026-11-04-v2'
  where visitor.auth_user_id = auth.uid()
    and visitor.otp_verified
    and visitor.is_active
  returning visitor.terms_accepted_at into accepted_at;

  if not found then
    raise exception 'The active visitor account could not be found.';
  end if;

  return accepted_at;
end;
$$;

revoke all on function public.get_visitor_terms_accepted_at()
  from public, anon;
grant execute on function public.get_visitor_terms_accepted_at()
  to authenticated;

revoke all on function public.accept_visitor_terms()
  from public, anon;
grant execute on function public.accept_visitor_terms()
  to authenticated;

-- Store an immutable, version-specific acknowledgment with the authenticated
-- staff identity and profile snapshot. No client can insert or alter records
-- directly; the security-definer RPCs verify the active sub-admin profile.
create table if not exists public.staff_terms_acceptances (
  id uuid primary key default gen_random_uuid(),
  staff_user_id uuid not null,
  staff_name text not null,
  staff_email text not null,
  staff_role text not null check (staff_role = 'subadmin'),
  library_id uuid,
  terms_version text not null,
  accepted_at timestamptz not null default now(),
  constraint staff_terms_acceptances_user_version_key
    unique (staff_user_id, terms_version)
);

create index if not exists staff_terms_acceptances_version_accepted_idx
  on public.staff_terms_acceptances (terms_version, accepted_at desc);

alter table public.staff_terms_acceptances enable row level security;

drop policy if exists "staff terms acceptance read own or superadmin"
  on public.staff_terms_acceptances;
create policy "staff terms acceptance read own or superadmin"
  on public.staff_terms_acceptances
  for select
  to authenticated
  using (
    staff_user_id = auth.uid()
    or exists (
      select 1
      from public.staff_profiles admin
      where admin.id = auth.uid()
        and admin.role = 'superadmin'
        and admin.is_active
    )
  );

revoke all on table public.staff_terms_acceptances from anon, public;
revoke all on table public.staff_terms_acceptances from authenticated;
grant select on table public.staff_terms_acceptances to authenticated;

create or replace function public.get_subadmin_terms_accepted_at()
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  staff_row public.staff_profiles%rowtype;
  accepted_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'A signed-in sub-admin session is required.';
  end if;

  select staff.*
    into staff_row
  from public.staff_profiles staff
  where staff.id = auth.uid()
    and staff.role = 'subadmin'
    and staff.is_active
    and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', staff.role) = staff.role;

  if not found then
    raise exception 'The active sub-admin account could not be found.';
  end if;

  select acceptance.accepted_at
    into accepted_at
  from public.staff_terms_acceptances acceptance
  where acceptance.staff_user_id = auth.uid()
    and acceptance.terms_version = '2026-11-04-v1';

  return accepted_at;
end;
$$;

create or replace function public.accept_subadmin_terms()
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  staff_row public.staff_profiles%rowtype;
  accepted_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'A signed-in sub-admin session is required.';
  end if;

  select staff.*
    into staff_row
  from public.staff_profiles staff
  where staff.id = auth.uid()
    and staff.role = 'subadmin'
    and staff.is_active
    and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', staff.role) = staff.role;

  if not found then
    raise exception 'The active sub-admin account could not be found.';
  end if;

  insert into public.staff_terms_acceptances (
    staff_user_id,
    staff_name,
    staff_email,
    staff_role,
    library_id,
    terms_version
  )
  values (
    staff_row.id,
    staff_row.full_name,
    staff_row.email,
    staff_row.role,
    staff_row.library_id,
    '2026-11-04-v1'
  )
  on conflict (staff_user_id, terms_version) do nothing;

  select acceptance.accepted_at
    into accepted_at
  from public.staff_terms_acceptances acceptance
  where acceptance.staff_user_id = auth.uid()
    and acceptance.terms_version = '2026-11-04-v1';

  return accepted_at;
end;
$$;

revoke all on function public.get_subadmin_terms_accepted_at()
  from public, anon;
grant execute on function public.get_subadmin_terms_accepted_at()
  to authenticated;

revoke all on function public.accept_subadmin_terms()
  from public, anon;
grant execute on function public.accept_subadmin_terms()
  to authenticated;

notify pgrst, 'reload schema';
