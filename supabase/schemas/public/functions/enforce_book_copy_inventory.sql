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
    and request.status in ('approved', 'borrowed')
    and request.return_date is null;
  active_allocations := active_allocations + community_allocations;

  if new.total_copies is null
    or new.total_copies < 1
    or new.available_copies is null
    or new.available_copies < 0
    or new.available_copies > new.total_copies
    or new.available_copies > greatest(new.total_copies - active_allocations, 0)
  then
    raise exception using
      errcode = '23514',
      message = format(
        'INVENTORY_CONFLICT: total copies must be positive, and available copies must be within the unallocated stock after %s outstanding allocations.',
        active_allocations
      );
  end if;

  -- Existing over-allocation can be unwound safely by reducing availability
  -- to zero after a real return/cancellation/expiry. Do not permit a total
  -- reduction or any increase in availability while allocations exceed it.
  if new.total_copies < active_allocations then
    if tg_op <> 'UPDATE' then
      raise exception using
        errcode = '23514',
        message = format(
          'INVENTORY_CONFLICT: total copies cannot be less than %s outstanding allocations.',
          active_allocations
        );
    end if;

    if new.total_copies is distinct from old.total_copies
       or new.available_copies <> 0
       or new.available_copies > old.available_copies
    then
      raise exception using
        errcode = '23514',
        message = format(
          'INVENTORY_CONFLICT: total copies cannot be less than %s outstanding allocations.',
          active_allocations
        );
    end if;
  end if;

  return new;
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."enforce_book_copy_inventory"() TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."enforce_book_copy_inventory"() FROM PUBLIC;
