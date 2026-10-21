CREATE OR REPLACE FUNCTION public.generate_visitor_qr_code()
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

GRANT EXECUTE ON FUNCTION "public"."generate_visitor_qr_code"() TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."generate_visitor_qr_code"() FROM PUBLIC;
