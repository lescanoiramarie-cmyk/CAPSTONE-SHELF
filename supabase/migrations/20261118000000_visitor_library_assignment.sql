alter table public.visitors
  add column if not exists library_id uuid
  references public.libraries(id) on delete set null;

create index if not exists visitors_library_registered_idx
  on public.visitors (library_id, registered_at desc);

drop policy if exists "visitor and staff read scoped visitor profiles"
  on public.visitors;

create policy "visitor and staff read scoped visitor profiles"
  on public.visitors
  for select
  to authenticated
  using (
    auth_user_id = auth.uid()
    or public.is_active_staff_for_branch(library_id::text)
  );

drop function if exists public.register_visitor(
  uuid, text, text, text, text, text
);

drop function if exists public.register_visitor(
  uuid, text, text, text, text, text, uuid
);

create function public.register_visitor(
  p_auth_user_id uuid,
  p_full_name text,
  p_contact_number text,
  p_email text,
  p_address text,
  p_registration_nonce text,
  p_library_id uuid
)
returns table(visitor_id text)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  auth_metadata jsonb;
  auth_email text;
  visitor_id_value text;
begin
  select lower(account.email), account.raw_user_meta_data
    into auth_email, auth_metadata
  from auth.users account
  where account.id = p_auth_user_id;

  if auth_email is null
    or auth_email <> lower(trim(p_email))
    or auth_metadata ->> 'role' is distinct from 'visitor'
    or auth_metadata ->> 'registration_nonce' is distinct from p_registration_nonce
    or auth_metadata ->> 'full_name' is distinct from trim(p_full_name)
    or auth_metadata ->> 'contact_number' is distinct from nullif(trim(p_contact_number), '')
    or auth_metadata ->> 'address' is distinct from nullif(trim(p_address), '')
  then
    raise exception 'A matching visitor registration proof is required.';
  end if;

  if p_library_id is not null and not exists (
    select 1
    from public.libraries library
    where library.id = p_library_id
  ) then
    raise exception 'Select a valid library branch or Outside Visitor.';
  end if;

  select visitor.id into visitor_id_value
  from public.visitors visitor
  where visitor.auth_user_id = p_auth_user_id
    and lower(visitor.email) = auth_email
  for update;

  if visitor_id_value is null then
    raise exception 'The visitor profile was not created by the Auth trigger.';
  end if;

  update public.visitors
  set library_id = p_library_id
  where auth_user_id = p_auth_user_id;

  return query select visitor_id_value;
end;
$$;

revoke all on function public.register_visitor(
  uuid, text, text, text, text, text, uuid
) from public;

grant execute on function public.register_visitor(
  uuid, text, text, text, text, text, uuid
) to anon, authenticated;
