CREATE OR REPLACE FUNCTION public.enforce_book_copy_inventory()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  active_allocations integer := 0;
  community_allocations integer := 0;
begin
  select count(*)::integer into active_allocations
  from public.borrow_requests request
  where request.book_id = new.id
    and request.status in ('ready_for_pickup', 'borrowed')
    and request.return_date is null;

  select count(*)::integer into community_allocations
  from public.community_book_requests request
  where request.book_id = new.id
    and request.status = 'borrowed'
    and request.return_date is null;
  active_allocations := active_allocations + community_allocations;

  if new.total_copies < active_allocations
    or new.available_copies < 0
    or new.available_copies > new.total_copies - active_allocations
  then
    raise exception using
      errcode = '23514',
      message = format(
        'INVENTORY_CONFLICT: copy totals must preserve %s outstanding allocations.',
        active_allocations
      );
  end if;

  return new;
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."enforce_book_copy_inventory"() TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."enforce_book_copy_inventory"() FROM PUBLIC;
