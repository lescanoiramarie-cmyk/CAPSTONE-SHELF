CREATE OR REPLACE FUNCTION public.generate_visitor_qr_code()
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  qr_value text;
begin
  perform pg_advisory_xact_lock(hashtext('public.visitors.qr_code'));
  loop
    qr_value := 'SHELF-QR-' || floor(random() * 900000 + 100000)::text;
    exit when not exists (
      select 1 from public.visitors where qr_code = qr_value
    );
  end loop;
  return qr_value;
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."generate_visitor_qr_code"() TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."generate_visitor_qr_code"() FROM PUBLIC;
