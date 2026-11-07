-- Evaluate the staff MFA gate once per query instead of once per row.
-- Large tables such as visitors and borrow_requests otherwise repeat a
-- security-definer staff lookup for every scanned row.
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
      'create policy "SHELF admin MFA required" on public.%I as restrictive for all to authenticated using ((select public.shelf_admin_mfa_access_allowed())) with check ((select public.shelf_admin_mfa_access_allowed()))',
      target_table.relname
    );
  end loop;
end;
$$;

-- A super-admin is allowed to review all library data. These stable,
-- one-time checks let Postgres bypass branch- and visitor-scoped policy
-- subqueries when loading global dashboard data.
drop policy if exists "superadmins read all visitors" on public.visitors;
create policy "superadmins read all visitors"
  on public.visitors for select to authenticated
  using ((select public.is_shelf_superadmin()));

drop policy if exists "superadmins read all borrow requests" on public.borrow_requests;
create policy "superadmins read all borrow requests"
  on public.borrow_requests for select to authenticated
  using ((select public.is_shelf_superadmin()));

drop policy if exists "superadmins read all attendance" on public.attendance_logs;
create policy "superadmins read all attendance"
  on public.attendance_logs for select to authenticated
  using ((select public.is_shelf_superadmin()));

drop policy if exists "superadmins read all books" on public.books;
create policy "superadmins read all books"
  on public.books for select to authenticated
  using ((select public.is_shelf_superadmin()));
