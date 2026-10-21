CREATE OR REPLACE FUNCTION public.set_book_updated_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO 'public'
  AS $function$
begin
  new.updated_at := greatest(
    clock_timestamp(),
    old.updated_at + interval '1 microsecond'
  );
  return new;
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."set_book_updated_at"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";
