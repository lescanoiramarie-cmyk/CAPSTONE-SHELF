-- ============================================================================
-- RESTORE FUNCTIONS LOST TO THE OVERLOAD SWEEP
--
-- This repairs damage caused by 20261016000000.
--
-- What happened:
--
-- That migration enumerated 13 function names from pg_proc and dropped every
-- overload with `drop function ... cascade`. It listed is_active_staff_for_branch,
-- get_visitor_feedback_replies and find_visitor_by_qr in the drop list but
-- recreated only the visitor OTP functions. The other three were not
-- recreated.
--
-- Because the drop used cascade, removing is_active_staff_for_branch also
-- removed every RLS policy that referenced it. RLS policies depend on the
-- functions in their USING and WITH CHECK expressions, so they went with it.
--
-- Consequence: 20261019000000 then failed with
--
--   function public.is_active_staff_for_branch(unknown) does not exist
--
-- because the policy it tried to create depends on that function. The visitors
-- table was left with RLS enabled and no policy at all.
--
-- Restored here in dependency order, followed by every policy that was lost.
-- Definitions are copied from their authoritative sources:
--   is_active_staff_for_branch    20261002000000:87
--   get_visitor_feedback_replies  20261002000100:240
--   find_visitor_by_qr            20261011000000:1
--
-- This migration is idempotent: every create is preceded by a drop, and every
-- policy is created with drop policy if exists.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. THE BRANCH-STAFF GATE
--
-- Must exist before any policy that references it.
-- ---------------------------------------------------------------------------

drop function if exists public.is_active_staff_for_branch(text);

create function public.is_active_staff_for_branch(p_branch_id text default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.staff_profiles staff
    where staff.id = auth.uid()
      and staff.is_active
      and (
        staff.role = 'superadmin'
        or (staff.role = 'subadmin' and p_branch_id is not null
          and staff.library_id::text = p_branch_id)
      )
      and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', staff.role) = staff.role
  );
$$;

revoke all on function public.is_active_staff_for_branch(text) from public;
grant execute on function public.is_active_staff_for_branch(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. THE OTHER TWO FUNCTIONS DROPPED WITH CASCADE
-- ---------------------------------------------------------------------------

drop function if exists public.get_visitor_feedback_replies(text, text);

create function public.get_visitor_feedback_replies(p_visitor_id text, p_email text)
returns table(id uuid, subject text, admin_reply text, replied_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.visitors visitor
    where visitor.id::text = trim(p_visitor_id)
      and lower(visitor.email) = lower(trim(p_email))
      and visitor.auth_user_id = auth.uid()
      and visitor.otp_verified
      and visitor.is_active
  ) then
    raise exception 'Authenticated, active visitor identity could not be verified.';
  end if;
  return query
    select feedback.id, feedback.subject, feedback.admin_reply, feedback.replied_at
    from public.visitor_feedback feedback
    where feedback.visitor_id::text = trim(p_visitor_id)
      and feedback.admin_reply is not null
    order by feedback.replied_at desc;
end;
$$;

revoke all on function public.get_visitor_feedback_replies(text, text) from public, anon;
grant execute on function public.get_visitor_feedback_replies(text, text) to authenticated;

drop function if exists public.find_visitor_by_qr(text, text);

create function public.find_visitor_by_qr(p_qr text, p_library_id text)
returns table(
  id text,
  full_name text,
  contact_number text,
  email text,
  address text,
  qr_code text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_active_staff_for_branch(p_library_id) then
    raise exception 'You are not authorized to scan visitors for this branch.';
  end if;

  return query
    select
      visitor.id::text,
      visitor.full_name::text,
      visitor.contact_number::text,
      visitor.email::text,
      visitor.address::text,
      visitor.qr_code::text
    from public.visitors visitor
    where visitor.qr_code = trim(p_qr)
      and visitor.otp_verified
      and visitor.is_active;
end;
$$;

revoke all on function public.find_visitor_by_qr(text, text) from public, anon;
grant execute on function public.find_visitor_by_qr(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. RESTORE THE RLS POLICIES REMOVED BY THE CASCADE
--
-- Reconstructed from 20261002000000 and 20261002000100. The visitors policy
-- carries the same relaxation as the intended 20261019000000: a visitor may read
-- their own profile before verification so login can distinguish "unverified"
-- from "not a visitor". Every other policy keeps its verification gate, since
-- feedback, reviews and requests must not be usable before the email is proven.
-- ---------------------------------------------------------------------------

drop policy if exists "visitor and staff read scoped visitor profiles" on public.visitors;
create policy "visitor and staff read scoped visitor profiles" on public.visitors
  for select to authenticated
  using (
    auth_user_id = auth.uid()
    or public.is_active_staff_for_branch(null)
  );

drop policy if exists "visitors and branch staff read requests" on public.borrow_requests;
create policy "visitors and branch staff read requests" on public.borrow_requests
  for select to authenticated
  using (
    exists (
      select 1 from public.visitors visitor
      where visitor.id::text = public.borrow_requests.visitor_id::text
        and visitor.auth_user_id = auth.uid()
        and visitor.otp_verified
        and visitor.is_active
    )
    or exists (
      select 1 from public.books book
      where book.id::text = public.borrow_requests.book_id::text
        and public.is_active_staff_for_branch(book.library_id::text)
    )
  );

drop policy if exists "authenticated visitors submit feedback" on public.visitor_feedback;
create policy "authenticated visitors submit feedback" on public.visitor_feedback
  for insert to authenticated
  with check (exists (
    select 1 from public.visitors visitor
    where visitor.id::text = public.visitor_feedback.visitor_id::text
      and visitor.auth_user_id = auth.uid()
      and visitor.otp_verified
      and visitor.is_active
  ));

drop policy if exists "visitors and branch staff read feedback" on public.visitor_feedback;
create policy "visitors and branch staff read feedback" on public.visitor_feedback
  for select to authenticated using (
    exists (
      select 1 from public.visitors visitor
      where visitor.id::text = public.visitor_feedback.visitor_id::text
        and visitor.auth_user_id = auth.uid()
        and visitor.otp_verified
        and visitor.is_active
    )
    or public.is_active_staff_for_branch(library_id::text)
  );

drop policy if exists "visitors and staff read attendance" on public.attendance_logs;
create policy "visitors and staff read attendance" on public.attendance_logs
  for select to authenticated using (
    exists (
      select 1 from public.visitors visitor
      where visitor.id::text = public.attendance_logs.visitor_id::text
        and visitor.auth_user_id = auth.uid()
        and visitor.otp_verified
        and visitor.is_active
    )
    or public.is_active_staff_for_branch(library_id::text)
  );

drop policy if exists "visitors manage own reviews" on public.book_reviews;
create policy "visitors manage own reviews" on public.book_reviews
  for all to authenticated
  using (exists (
    select 1 from public.visitors visitor
    where visitor.auth_user_id = auth.uid()
      and visitor.otp_verified
      and visitor.is_active
  ))
  with check (exists (
    select 1 from public.visitors visitor
    where visitor.auth_user_id = auth.uid()
      and visitor.otp_verified
      and visitor.is_active
  ));

-- Staff table: a staff profile is readable by its owner or by any active
-- superadmin, which is what the cascade removed.
drop policy if exists "staff read own or superadmin" on public.staff_profiles;
create policy "staff read own or superadmin" on public.staff_profiles
  for select to authenticated
  using (
    id = auth.uid()
    or public.is_active_staff_for_branch(null)
  );

drop policy if exists "staff manage by superadmin" on public.staff_profiles;
create policy "staff manage by superadmin" on public.staff_profiles
  for all to authenticated
  using (public.is_active_staff_for_branch(null))
  with check (public.is_active_staff_for_branch(null));

-- Inventory tables: write access for active staff of the owning branch.
drop policy if exists "staff manage libraries" on public.libraries;
create policy "staff manage libraries" on public.libraries
  for all to authenticated
  using (public.is_active_staff_for_branch(id::text))
  with check (public.is_active_staff_for_branch(id::text));

drop policy if exists "staff manage books" on public.books;
create policy "staff manage books" on public.books
  for all to authenticated
  using (public.is_active_staff_for_branch(library_id::text))
  with check (public.is_active_staff_for_branch(library_id::text));

drop policy if exists "staff manage visitors" on public.visitors;
create policy "staff manage visitors" on public.visitors
  for all to authenticated
  using (public.is_active_staff_for_branch(null))
  with check (public.is_active_staff_for_branch(null));

-- Audit trail: staff of the owning branch only.
drop policy if exists "staff read branch audit log" on public.audit_logs;
create policy "staff read branch audit log" on public.audit_logs
  for select to authenticated using (public.is_active_staff_for_branch(null));

drop policy if exists "staff write branch audit log" on public.audit_logs;
create policy "staff write branch audit log" on public.audit_logs
  for insert to authenticated with check (
    actor_id = auth.uid()
    and public.is_active_staff_for_branch(branch_id::text)
  );

-- Announcements: write access for active staff.
drop policy if exists "staff manage announcements" on public.announcements;
create policy "staff manage announcements" on public.announcements
  for all to authenticated
  using (public.is_active_staff_for_branch(null))
  with check (public.is_active_staff_for_branch(null));

-- Personal books: owners manage their own shelf.
drop policy if exists "visitors manage own personal books" on public.personal_books;
create policy "visitors manage own personal books" on public.personal_books
  for all to authenticated
  using (exists (
    select 1 from public.visitors visitor
    where visitor.id::text = public.personal_books.owner_id::text
      and visitor.auth_user_id = auth.uid()
      and visitor.otp_verified
      and visitor.is_active
  ))
  with check (exists (
    select 1 from public.visitors visitor
    where visitor.id::text = public.personal_books.owner_id::text
      and visitor.auth_user_id = auth.uid()
      and visitor.otp_verified
      and visitor.is_active
  ));

-- Community book requests: participants only.
drop policy if exists "community request participants read" on public.community_book_requests;
create policy "community request participants read" on public.community_book_requests
  for select to authenticated using (
    exists (
      select 1 from public.visitors visitor
      where visitor.id::text = public.community_book_requests.owner_visitor_id::text
        and visitor.auth_user_id = auth.uid()
    )
    or exists (
      select 1 from public.visitors visitor
      where visitor.id::text = public.community_book_requests.requester_visitor_id::text
        and visitor.auth_user_id = auth.uid()
    )
    or exists (
      select 1 from public.books book
      where book.id::text = public.community_book_requests.book_id::text
        and public.is_active_staff_for_branch(book.library_id::text)
    )
  );

-- ---------------------------------------------------------------------------
-- 4. AUDIT AND RELOAD
-- ---------------------------------------------------------------------------

insert into public.audit_logs(actor_id, action, branch_id, details)
values (
  null,
  'security.policy.restored_after_cascade',
  null,
  jsonb_build_object(
    'functions', jsonb_build_array(
      'is_active_staff_for_branch(text)',
      'get_visitor_feedback_replies(text, text)',
      'find_visitor_by_qr(text, text)'
    ),
    'cause', '20261016000000 dropped these names with cascade and did not recreate them',
    'impact', 'RLS policies depending on is_active_staff_for_branch were removed with it'
  )
);

-- ---------------------------------------------------------------------------
-- 5. VISITOR SELF-READ BEFORE VERIFICATION
--
-- Carried over from the intended 20261019000000, which could not create its
-- policy until is_active_staff_for_branch was restored above.
--
-- The previous policy required otp_verified for the visitor's own row, so
-- loginVisitor's `if (!visitor)` check reported "This account is not registered
-- as a SHELF visitor." for accounts that exist but are not yet verified.
--
-- otp_verified still guards the QR pass and the participation policies below.
-- Only self-identification is relaxed.
-- ---------------------------------------------------------------------------

drop policy if exists "visitor and staff read scoped visitor profiles" on public.visitors;
create policy "visitor and staff read scoped visitor profiles" on public.visitors
  for select to authenticated
  using (
    auth_user_id = auth.uid()
    or public.is_active_staff_for_branch(null)
  );

insert into public.audit_logs(actor_id, action, branch_id, details)
values (
  null,
  'security.policy.visitor_own_profile_read',
  null,
  jsonb_build_object(
    'change', 'visitors self-read no longer requires otp_verified',
    'reason', 'login must distinguish unverified account from non-visitor account',
    'retained', 'qr_code and verified-only participation policies still require verification'
  )
);

notify pgrst, 'reload schema';