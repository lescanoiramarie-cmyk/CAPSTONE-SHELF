CREATE OR REPLACE FUNCTION public.auto_expire_pickups()
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare r record; expired_count integer := 0;
begin
  for r in select id, book_id from public.borrow_requests
    where status = 'ready_for_pickup' and pickup_deadline <= now()
    for update skip locked
  loop
    update public.borrow_requests set status = 'expired'
    where id = r.id;
    perform public.release_copy_and_promote(r.book_id);
    expired_count := expired_count + 1;
  end loop;
  return expired_count;
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."auto_expire_pickups"() TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."auto_expire_pickups"() FROM PUBLIC;
