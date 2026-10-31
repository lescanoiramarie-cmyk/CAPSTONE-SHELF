
create table if not exists public.external_catalog_books (
  openlibrary_key text primary key,
  title text not null,
  author text,
  category text,
  isbn text,
  summary text,
  cover_url text,
  source_url text,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.external_catalog_books enable row level security;

drop policy if exists "External catalog readable by visitors"
  on public.external_catalog_books;

create policy "External catalog readable by visitors"
  on public.external_catalog_books
  for select
  to anon, authenticated
  using (true);

grant select on public.external_catalog_books to anon, authenticated;