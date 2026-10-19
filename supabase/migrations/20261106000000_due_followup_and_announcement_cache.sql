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

create table if not exists public.due_date_notifications (
  id uuid primary key default gen_random_uuid(),
  borrow_request_id uuid not null,
  visitor_id text not null,
  notification_type text not null
    check (notification_type in ('due_soon', 'due_today', 'overdue', 'follow_up')),
  notification_date date not null,
  sent_at timestamptz not null default now(),
  unique (borrow_request_id, notification_type, notification_date)
);

alter table public.due_date_notifications enable row level security;

notify pgrst, 'reload schema';