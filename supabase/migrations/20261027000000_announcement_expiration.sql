alter table public.announcements
  add column if not exists expires_at timestamptz;

create index if not exists announcements_published_expiration_created_idx
  on public.announcements (published, expires_at, created_at desc);

drop policy if exists "published announcements are public" on public.announcements;
drop policy if exists "public read announcements" on public.announcements;
create policy "published announcements are public" on public.announcements
  for select to anon, authenticated
  using (published and (expires_at is null or expires_at > now()));
