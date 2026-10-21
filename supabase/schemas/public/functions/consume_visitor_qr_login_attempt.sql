CREATE OR REPLACE FUNCTION public.consume_visitor_qr_login_attempt (
  p_client_hash text
)
  RETURNS TABLE (
    allowed             boolean,
    retry_after_seconds integer
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

GRANT EXECUTE ON FUNCTION "public"."consume_visitor_qr_login_attempt"(text) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."consume_visitor_qr_login_attempt"(text) FROM PUBLIC;
