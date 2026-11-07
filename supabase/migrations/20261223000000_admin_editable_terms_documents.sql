create table if not exists public.system_terms_documents (
  document_key text primary key check (document_key in ('visitor', 'subadmin')),
  version text not null,
  content text not null check (length(trim(content)) > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.system_terms_documents enable row level security;

drop policy if exists "Anyone can read current terms" on public.system_terms_documents;
create policy "Anyone can read current terms"
  on public.system_terms_documents for select to anon, authenticated using (true);

create or replace function public.is_shelf_superadmin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.staff_profiles staff
    where staff.id = auth.uid()
      and staff.role = 'superadmin'
      and staff.is_active = true
      and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', staff.role) = 'superadmin'
  );
$$;
revoke all on function public.is_shelf_superadmin() from public, anon;
grant execute on function public.is_shelf_superadmin() to authenticated, service_role;

drop policy if exists "Super admins manage current terms" on public.system_terms_documents;
create policy "Super admins manage current terms"
  on public.system_terms_documents for all to authenticated
  using (public.is_shelf_superadmin())
  with check (public.is_shelf_superadmin());

grant select on public.system_terms_documents to anon, authenticated;
grant insert, update, delete on public.system_terms_documents to authenticated;

create or replace function public.get_visitor_terms_accepted_at()
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare current_version text;
begin
  if auth.uid() is null then return null; end if;
  select terms.version into current_version
    from public.system_terms_documents terms where terms.document_key = 'visitor';
  current_version := coalesce(current_version, '2026-11-04-v2');
  return (
    select visitor.terms_accepted_at
    from public.visitors visitor
    where visitor.auth_user_id = auth.uid()
      and visitor.is_active
      and visitor.otp_verified
      and visitor.terms_version = current_version
    limit 1
  );
end;
$$;
grant execute on function public.get_visitor_terms_accepted_at() to authenticated, postgres, service_role;
revoke all on function public.get_visitor_terms_accepted_at() from public, anon;

create or replace function public.accept_visitor_terms()
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare accepted_at timestamptz; current_version text;
begin
  if auth.uid() is null then raise exception 'A signed-in visitor session is required.'; end if;
  select terms.version into current_version
    from public.system_terms_documents terms where terms.document_key = 'visitor';
  current_version := coalesce(current_version, '2026-11-04-v2');
  update public.visitors visitor
    set terms_accepted_at = now(), terms_version = current_version
    where visitor.auth_user_id = auth.uid() and visitor.otp_verified and visitor.is_active
    returning visitor.terms_accepted_at into accepted_at;
  if not found then raise exception 'The active visitor account could not be found.'; end if;
  return accepted_at;
end;
$$;
grant execute on function public.accept_visitor_terms() to authenticated, postgres, service_role;
revoke all on function public.accept_visitor_terms() from public, anon;

create or replace function public.get_subadmin_terms_accepted_at()
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare current_version text;
begin
  if auth.uid() is null then return null; end if;
  select terms.version into current_version
    from public.system_terms_documents terms where terms.document_key = 'subadmin';
  current_version := coalesce(current_version, '2026-11-04-v1');
  return (
    select acceptance.accepted_at
    from public.staff_terms_acceptances acceptance
    where acceptance.staff_user_id = auth.uid()
      and acceptance.terms_version = current_version
    limit 1
  );
end;
$$;
grant execute on function public.get_subadmin_terms_accepted_at() to authenticated, postgres, service_role;
revoke all on function public.get_subadmin_terms_accepted_at() from public, anon;

create or replace function public.accept_subadmin_terms()
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare staff_row public.staff_profiles%rowtype; accepted_at timestamptz; current_version text;
begin
  if auth.uid() is null then raise exception 'A signed-in sub-admin session is required.'; end if;
  select staff.* into staff_row
    from public.staff_profiles staff
    where staff.id = auth.uid() and staff.role = 'subadmin' and staff.is_active
      and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', staff.role) = staff.role;
  if not found then raise exception 'The active sub-admin account could not be found.'; end if;
  select terms.version into current_version
    from public.system_terms_documents terms where terms.document_key = 'subadmin';
  current_version := coalesce(current_version, '2026-11-04-v1');
  insert into public.staff_terms_acceptances (staff_user_id, staff_name, staff_email, staff_role, library_id, terms_version)
    values (staff_row.id, staff_row.full_name, staff_row.email, staff_row.role, staff_row.library_id, current_version)
    on conflict (staff_user_id, terms_version) do nothing;
  select acceptance.accepted_at into accepted_at
    from public.staff_terms_acceptances acceptance
    where acceptance.staff_user_id = auth.uid() and acceptance.terms_version = current_version;
  return accepted_at;
end;
$$;
grant execute on function public.accept_subadmin_terms() to authenticated, postgres, service_role;
revoke all on function public.accept_subadmin_terms() from public, anon;

-- Require an AAL2 session for authenticated staff on every RLS-protected
-- application table. Visitors retain their existing access; staff_profiles
-- is intentionally exempt so login can determine the staff role before the
-- MFA challenge is issued.
create or replace function public.shelf_admin_mfa_access_allowed()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select not exists (
    select 1
    from public.staff_profiles staff
    where staff.id = auth.uid()
      and staff.role in ('subadmin', 'superadmin')
  ) or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;
revoke all on function public.shelf_admin_mfa_access_allowed() from public, anon;
grant execute on function public.shelf_admin_mfa_access_allowed() to authenticated, service_role;

do $$
declare target_table record;
begin
  for target_table in
    select cls.relname
    from pg_class cls
    join pg_namespace ns on ns.oid = cls.relnamespace
    where ns.nspname = 'public'
      and cls.relkind in ('r', 'p')
      and cls.relrowsecurity
      and cls.relname <> 'staff_profiles'
  loop
    execute format(
      'drop policy if exists "SHELF admin MFA required" on public.%I',
      target_table.relname
    );
    execute format(
      'create policy "SHELF admin MFA required" on public.%I as restrictive for all to authenticated using (public.shelf_admin_mfa_access_allowed()) with check (public.shelf_admin_mfa_access_allowed())',
      target_table.relname
    );
  end loop;
end;
$$;
