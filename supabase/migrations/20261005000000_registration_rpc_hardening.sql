-- Make visitor registration RPC read-only and require the sign-up nonce.
-- The auth.users trigger creates/links the visitor profile; this RPC only
-- returns its ID to the sign-up flow so it can send the verification code.

drop function if exists public.register_visitor(uuid, text, text, text, text);
drop function if exists public.register_visitor(uuid, text, text, text, text, text);

create function public.register_visitor(
  p_auth_user_id uuid,
  p_full_name text,
  p_contact_number text,
  p_email text,
  p_address text,
  p_registration_nonce text
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

  select visitor.id into visitor_id_value
  from public.visitors visitor
  where visitor.auth_user_id = p_auth_user_id
    and lower(visitor.email) = auth_email;

  if visitor_id_value is null then
    raise exception 'The visitor profile was not created by the Auth trigger.';
  end if;

  return query select visitor_id_value;
end;
$$;

revoke all on function public.register_visitor(uuid, text, text, text, text, text)
  from public;
grant execute on function public.register_visitor(uuid, text, text, text, text, text)
  to anon, authenticated;
