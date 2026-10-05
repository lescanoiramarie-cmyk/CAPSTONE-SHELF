create or replace function public.toggle_attendance(p_qr text, p_library_id text)
returns table(log_id text, visitor_id text, visitor_name text, action text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_visitor public.visitors%rowtype;
  v_log public.attendance_logs%rowtype;
  v_action text;
  library_id_type text;
begin
  if not public.is_active_staff_for_branch(p_library_id) then
    raise exception 'You are not authorized to record attendance for this branch.';
  end if;

  select visitor.* into v_visitor
  from public.visitors as visitor
  where visitor.qr_code = trim(p_qr)
    and visitor.otp_verified
    and visitor.is_active;
  if v_visitor.id is null then
    raise exception 'QR code is invalid, unverified, or inactive.';
  end if;

  select attendance.* into v_log
  from public.attendance_logs as attendance
  where attendance.visitor_id::text = v_visitor.id::text
    and attendance.library_id::text = p_library_id
    and attendance.time_in::date = current_date
    and attendance.checked_out_at is null
  order by attendance.time_in desc
  limit 1
  for update;

  if v_log.id is null then
    select format_type(attribute.atttypid, attribute.atttypmod)
      into library_id_type
      from pg_attribute attribute
     where attribute.attrelid = 'public.attendance_logs'::regclass
       and attribute.attname = 'library_id'
       and not attribute.attisdropped;

    execute format(
      'insert into public.attendance_logs (visitor_id, visitor_name, library_id) values ($1, $2, $3::%s) returning *',
      library_id_type
    ) into v_log using v_visitor.id, v_visitor.full_name, p_library_id;
    v_action := 'checked_in';
  else
    update public.attendance_logs as attendance
       set checked_out_at = now()
     where attendance.id::text = v_log.id::text
     returning attendance.* into v_log;
    v_action := 'checked_out';
  end if;

  return query
    select
      v_log.id::text,
      v_visitor.id::text,
      v_visitor.full_name::text,
      v_action;
end;
$$;

revoke all on function public.toggle_attendance(text, text) from public, anon;
grant execute on function public.toggle_attendance(text, text) to authenticated;
