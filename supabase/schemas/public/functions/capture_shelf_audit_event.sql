CREATE OR REPLACE FUNCTION public.capture_shelf_audit_event()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  branch_value text;
  event_action text;
  event_details jsonb;
  request_row public.borrow_requests%rowtype;
begin
  if tg_table_name = 'visitors' then
    if tg_op = 'INSERT' then
      event_action := 'visitor.registration.created';
      event_details := jsonb_build_object(
        'visitorId', new.id,
        'fullName', new.full_name,
        'email', new.email,
        'otpVerified', coalesce(new.otp_verified, false)
      );
    elsif tg_op = 'UPDATE' then
      branch_value := null;
      if coalesce(old.otp_verified, false) is distinct from coalesce(new.otp_verified, false) then
        event_action := case
          when coalesce(new.otp_verified, false)
            then 'visitor.registration.verified'
          else 'visitor.registration.verification_revoked'
        end;
        event_details := jsonb_build_object(
          'visitorId', new.id,
          'fullName', new.full_name,
          'email', new.email
        );
      elsif coalesce(old.is_active, true) is distinct from coalesce(new.is_active, true) then
        event_action := case
          when coalesce(new.is_active, true)
            then 'visitor.account.enabled'
          else 'visitor.account.disabled'
        end;
        event_details := jsonb_build_object(
          'visitorId', new.id,
          'fullName', new.full_name,
          'email', new.email
        );
      else
        return new;
      end if;
    else
      event_action := 'visitor.registration.deleted';
      event_details := jsonb_build_object(
        'visitorId', old.id,
        'fullName', old.full_name,
        'email', old.email
      );
    end if;
  elsif tg_table_name = 'borrow_requests' then
    if tg_op = 'DELETE' then
      request_row := old;
    else
      request_row := new;
    end if;
    select library_id::text into branch_value
    from public.books
    where id::text = request_row.book_id::text;
    event_action := 'circulation.borrow_request.' || lower(tg_op);
    event_details := jsonb_build_object(
      'requestId', request_row.id,
      'bookId', request_row.book_id,
      'status', request_row.status,
      'fineAmount', request_row.fine_amount
    );
  elsif tg_table_name = 'attendance_logs' then
    if tg_op = 'DELETE' then
      branch_value := old.library_id::text;
    else
      branch_value := new.library_id::text;
    end if;
    event_action := case
      when tg_op = 'INSERT' then 'circulation.visitor.checked_in'
      else 'circulation.visitor.checked_out'
    end;
    event_details := jsonb_build_object(
      'attendanceId', case when tg_op = 'DELETE' then old.id else new.id end,
      'visitorId', case when tg_op = 'DELETE' then old.visitor_id else new.visitor_id end
    );
  elsif tg_table_name = 'books' then
    if tg_op = 'DELETE' then
      branch_value := old.library_id::text;
    else
      branch_value := new.library_id::text;
    end if;
    event_action := 'inventory.book.' || lower(tg_op);
    event_details := jsonb_build_object(
      'bookId', case when tg_op = 'DELETE' then old.id else new.id end,
      'title', case when tg_op = 'DELETE' then old.title else new.title end,
      'isbn', case when tg_op = 'DELETE' then old.isbn else new.isbn end
    );
  elsif tg_table_name = 'visitor_feedback' then
    if tg_op = 'DELETE' then
      branch_value := old.library_id::text;
    else
      branch_value := new.library_id::text;
    end if;
    event_action := 'visitor_feedback.' || lower(tg_op);
    event_details := jsonb_build_object(
      'feedbackId', case when tg_op = 'DELETE' then old.id else new.id end,
      'status', case when tg_op = 'DELETE' then old.status else new.status end,
      'category', case when tg_op = 'DELETE' then old.category else new.category end
    );
  elsif tg_table_name = 'announcements' then
    event_action := 'announcement.' || lower(tg_op);
    event_details := jsonb_build_object(
      'announcementId', case when tg_op = 'DELETE' then old.id else new.id end,
      'title', case when tg_op = 'DELETE' then old.title else new.title end,
      'published', case when tg_op = 'DELETE' then old.published else new.published end
    );
  end if;

  insert into public.audit_logs(actor_id, action, branch_id, details)
  values (auth.uid(), event_action, branch_value, coalesce(event_details, '{}'::jsonb));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."capture_shelf_audit_event"() TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."capture_shelf_audit_event"() FROM PUBLIC;
