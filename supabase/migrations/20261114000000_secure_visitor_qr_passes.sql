begin;

create or replace function public.generate_visitor_qr_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  qr_value text;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('public.visitors.qr_code')
  );

  loop
    qr_value := 'SHELF-QR-' ||
      pg_catalog.upper(
        pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '')
      );

    exit when not exists (
      select 1
      from public.visitors visitor
      where visitor.qr_code = qr_value
    );
  end loop;

  return qr_value;
end;
$$;

revoke all on function public.generate_visitor_qr_code()
  from public, anon, authenticated;
grant execute on function public.generate_visitor_qr_code()
  to postgres, service_role;

alter table public.visitors
  drop constraint if exists visitors_qr_code_shelf_format;

alter table public.visitors
  drop constraint if exists visitors_qr_code_six_digits;

update public.visitors
set qr_code = public.generate_visitor_qr_code()
where qr_code is not null;

alter table public.visitors
  add constraint visitors_qr_code_shelf_format
  check (qr_code is null or qr_code ~ '^SHELF-QR-[0-9A-F]{32}$');

create table if not exists shelf_private.visitor_qr_login_rate_limits (
  client_hash text primary key
    check (client_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  attempt_count integer not null check (attempt_count > 0)
);

revoke all on table shelf_private.visitor_qr_login_rate_limits
  from public, anon, authenticated, service_role;

create or replace function public.consume_visitor_qr_login_attempt(
  p_client_hash text
)
returns table (
  allowed boolean,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_time_value timestamptz := pg_catalog.clock_timestamp();
  attempt_count_value integer;
  window_started_value timestamptz;
begin
  if p_client_hash is null or p_client_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'A valid client hash is required.';
  end if;

  insert into shelf_private.visitor_qr_login_rate_limits as current_limit (
    client_hash,
    window_started_at,
    attempt_count
  )
  values (
    p_client_hash,
    current_time_value,
    1
  )
  on conflict (client_hash)
  do update set
    window_started_at = case
      when current_limit.window_started_at
        <= current_time_value - interval '15 minutes'
        then current_time_value
      else current_limit.window_started_at
    end,
    attempt_count = case
      when current_limit.window_started_at
        <= current_time_value - interval '15 minutes'
        then 1
      else current_limit.attempt_count + 1
    end
  returning
    current_limit.attempt_count,
    current_limit.window_started_at
  into attempt_count_value, window_started_value;

  if attempt_count_value % 100 = 0 then
    delete from shelf_private.visitor_qr_login_rate_limits rate_limit
    where rate_limit.window_started_at
      < current_time_value - interval '1 day';
  end if;

  return query
  select
    attempt_count_value <= 10,
    case
      when attempt_count_value <= 10 then 0
      else greatest(
        1,
        pg_catalog.ceil(
          pg_catalog.date_part(
            'epoch',
            window_started_value + interval '15 minutes' - current_time_value
          )
        )::integer
      )
    end;
end;
$$;

revoke all on function public.consume_visitor_qr_login_attempt(text)
  from public, anon, authenticated;
grant execute on function public.consume_visitor_qr_login_attempt(text)
  to service_role;

commit;
