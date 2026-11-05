begin;

create or replace function public.set_visitor_active(
  p_visitor_id text,
  p_is_active boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  visitor_library_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.'
      using errcode = '42501';
  end if;

  if p_is_active is null then
    raise exception 'A visitor account status is required.'
      using errcode = '22023';
  end if;

  select visitor.library_id
  into visitor_library_id
  from public.visitors visitor
  where visitor.id = p_visitor_id
  for update;

  if not found then
    raise exception 'Visitor account not found.'
      using errcode = 'P0002';
  end if;

  if not public.is_active_staff_for_branch(visitor_library_id::text) then
    raise exception 'You are not authorized to update this visitor account.'
      using errcode = '42501';
  end if;

  update public.visitors
  set is_active = p_is_active
  where id = p_visitor_id;

  return p_is_active;
end;
$$;

revoke all on function public.set_visitor_active(text, boolean)
  from public, anon;
grant execute on function public.set_visitor_active(text, boolean)
  to authenticated;

commit;
