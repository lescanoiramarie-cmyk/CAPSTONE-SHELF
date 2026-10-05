drop policy if exists "books visible to catalog and owners" on public.books;
drop policy if exists "public catalog books readable" on public.books;

create policy "public catalog books readable" on public.books
  for select to anon
  using (
    book_type <> 'personal'
    or is_public
  );

create policy "books visible to catalog and owners" on public.books
  for select to authenticated
  using (
    book_type <> 'personal'
    or is_public
    or exists (
      select 1
      from public.visitors as visitor
      where visitor.id = books.owner_visitor_id
        and visitor.auth_user_id = auth.uid()
    )
  );

grant select on public.visitors to authenticated;
