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
      pg_catalog.floor(pg_catalog.random() * 900000 + 100000)::integer::text;

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

do $$
declare
  visitor_id_value text;
begin
  for visitor_id_value in
    select visitor.id
    from public.visitors visitor
    where visitor.qr_code is not null
    order by visitor.id
    for update
  loop
    update public.visitors visitor
    set qr_code = public.generate_visitor_qr_code()
    where visitor.id = visitor_id_value;
  end loop;
end;
$$;

alter table public.visitors
  add constraint visitors_qr_code_shelf_format
  check (qr_code is null or qr_code ~ '^SHELF-QR-[0-9]{6}$');

commit;
