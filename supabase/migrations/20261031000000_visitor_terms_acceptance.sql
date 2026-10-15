alter table public.visitors
  add column if not exists terms_accepted_at timestamptz;

create or replace function public.get_visitor_terms_accepted_at()
returns timestamptz
language plpgsql
security definer
set search_path = public
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
    and visitor.is_active;

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

create or replace function public.accept_visitor_terms()
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  accepted_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'A signed-in visitor session is required.';
  end if;

  update public.visitors visitor
  set terms_accepted_at = coalesce(visitor.terms_accepted_at, now())
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

revoke all on function public.accept_visitor_terms()
  from public, anon;
grant execute on function public.accept_visitor_terms()
  to authenticated;

notify pgrst, 'reload schema';
