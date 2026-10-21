CREATE OR REPLACE FUNCTION public.diag_list_community_rpcs()
  RETURNS TABLE (
    proname   text,
    arguments text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  return query
  select
    p.proname::text,
    pg_get_function_identity_arguments(p.oid)::text as arguments
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'request_community_book',
      'approve_community_book_request',
      'reject_community_book_request',
      'confirm_community_book_pickup',
      'confirm_community_book_return',
      'fetch_my_community_book_requests',
      'fetch_owner_community_book_requests',
      'fetch_community_books',
      'fetch_personal_books',
      'request_borrow',
      'confirm_pickup',
      'confirm_return'
    )
  order by p.proname;
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."diag_list_community_rpcs"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";
