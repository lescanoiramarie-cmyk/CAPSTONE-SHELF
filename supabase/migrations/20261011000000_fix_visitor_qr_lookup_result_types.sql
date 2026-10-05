create or replace function public.find_visitor_by_qr(p_qr text, p_library_id text)
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
