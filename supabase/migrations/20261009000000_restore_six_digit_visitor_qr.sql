create or replace function public.generate_visitor_qr_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  qr_value text;
begin
  perform pg_advisory_xact_lock(hashtext('public.visitors.qr_code'));
  loop
    qr_value := floor(random() * 900000 + 100000)::text;
    exit when not exists (
      select 1 from public.visitors where qr_code = qr_value
    );
  end loop;
  return qr_value;
end;
$$;
revoke all on function public.generate_visitor_qr_code() from public, anon, authenticated;

do $$
declare
  visitor_row record;
begin
  for visitor_row in
    select id
    from public.visitors
    where qr_code is not null
      and qr_code !~ '^[0-9]{6}$'
    order by id
    for update
  loop
    update public.visitors
    set qr_code = public.generate_visitor_qr_code()
    where id = visitor_row.id;
  end loop;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.visitors'::regclass
      and conname = 'visitors_qr_code_six_digits'
  ) then
    alter table public.visitors
      add constraint visitors_qr_code_six_digits
      check (qr_code is null or qr_code ~ '^[0-9]{6}$');
  end if;
end;
$$;

create or replace function public.link_visitor_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  visitor_id_value text;
  is_confirmed boolean;
begin
  if coalesce(new.raw_user_meta_data ->> 'role', '') <> 'visitor' then
    return new;
  end if;

  is_confirmed := new.email_confirmed_at is not null;

  select id::text into visitor_id_value
  from public.visitors
  where lower(email) = lower(new.email)
  limit 1;

  if visitor_id_value is null then
    insert into public.visitors (
      full_name,
      contact_number,
      email,
      address,
      otp_verified,
      qr_code,
      auth_user_id,
      is_active
    ) values (
      coalesce(new.raw_user_meta_data ->> 'full_name', 'Visitor'),
      new.raw_user_meta_data ->> 'contact_number',
      lower(new.email),
      new.raw_user_meta_data ->> 'address',
      is_confirmed,
      case
        when is_confirmed then public.generate_visitor_qr_code()
        else null
      end,
      new.id,
      is_confirmed
    );
  else
    update public.visitors
    set auth_user_id = new.id,
        full_name = coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), full_name),
        contact_number = coalesce(new.raw_user_meta_data ->> 'contact_number', contact_number),
        address = coalesce(new.raw_user_meta_data ->> 'address', address),
        otp_verified = is_confirmed,
        is_active = case
          when is_confirmed and not otp_verified then true
          else is_active
        end,
        qr_code = case
          when not is_confirmed or (not is_active and otp_verified) then null
          when qr_code ~ '^[0-9]{6}$' then qr_code
          else public.generate_visitor_qr_code()
        end
    where id::text = visitor_id_value;
  end if;

  return new;
end;
$$;
revoke all on function public.link_visitor_auth_user() from public, anon, authenticated;
