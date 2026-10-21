CREATE OR REPLACE FUNCTION public.write_audit_log (
  p_action    text,
  p_branch_id text  DEFAULT NULL::text,
  p_details   jsonb DEFAULT '{}'::jsonb
)
  RETURNS uuid
  LANGUAGE plpgsql
  SET search_path TO 'public'
  AS $function$
declare log_id uuid;
begin
  insert into public.audit_logs(actor_id, action, branch_id, details)
  values (auth.uid(), p_action, p_branch_id, coalesce(p_details, '{}'::jsonb))
  returning id into log_id;
  return log_id;
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."write_audit_log"(text, text, jsonb) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";
