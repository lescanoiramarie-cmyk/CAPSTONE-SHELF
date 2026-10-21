alter function public.auto_cancel_expired_borrow_requests()
  set search_path = '';

drop policy if exists "Visitors can manage own reading list"
  on public.visitor_reading_list;
drop policy if exists "Visitors can view own reading list"
  on public.visitor_reading_list;
drop policy if exists "Visitors can insert own reading list item"
  on public.visitor_reading_list;
drop policy if exists "Visitors can delete own reading list item"
  on public.visitor_reading_list;

create policy "Visitors can manage own reading list"
  on public.visitor_reading_list
  for all
  to authenticated
  using (
    visitor_id in (
      select visitor.id
      from public.visitors visitor
      where visitor.auth_user_id = (select auth.uid())
    )
  )
  with check (
    visitor_id in (
      select visitor.id
      from public.visitors visitor
      where visitor.auth_user_id = (select auth.uid())
    )
  );
