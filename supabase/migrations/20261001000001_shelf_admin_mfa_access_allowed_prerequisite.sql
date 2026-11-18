-- Bootstrap the staff MFA predicate before the November 7 policy migration.
-- If a same-named function already exists, validate it without replacing it.
do $migration$
declare
  v_named_function_count integer;
  v_zero_argument_function_count integer;
  v_function_oid oid;
  v_owner_name name;
  v_returns_boolean boolean;
  v_returns_set boolean;
  v_routine_kind "char";
  v_language_name name;
  v_volatility "char";
  v_security_definer boolean;
  v_function_config text[];
  v_function_body text;
  v_acl_is_explicit boolean;
  v_has_public_execute boolean;
  v_has_anon_execute boolean;
  v_has_authenticated_execute boolean;
  v_has_service_role_execute boolean;
  v_has_owner_execute boolean;
  v_has_unexpected_acl boolean;
  v_acl_entry_count integer;
  v_has_effective_anon_execute boolean;
  v_has_effective_authenticated_execute boolean;
  v_has_effective_service_role_execute boolean;
  v_expected_body constant text := $expected_body$
  select not exists (
    select 1
    from public.staff_profiles staff
    where staff.id = auth.uid()
      and staff.role in ('subadmin', 'superadmin')
  ) or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$expected_body$;
begin
  select count(*), count(*) filter (where function_proc.pronargs = 0)
  into v_named_function_count, v_zero_argument_function_count
  from pg_catalog.pg_proc function_proc
  join pg_catalog.pg_namespace function_ns
    on function_ns.oid = function_proc.pronamespace
  where function_ns.nspname = 'public'
    and function_proc.proname = 'shelf_admin_mfa_access_allowed';

  if v_named_function_count = 0 then
    if current_user is distinct from 'postgres' then
      raise exception
        'Cannot create public.shelf_admin_mfa_access_allowed() with the required owner: migration current_user is %, expected postgres. No ownership change will be attempted.',
        current_user;
    end if;

    execute $create_function$
      create function public.shelf_admin_mfa_access_allowed()
      returns boolean
      language sql
      stable
      security definer
      set search_path = public, pg_temp
      as $function_body$
  select not exists (
    select 1
    from public.staff_profiles staff
    where staff.id = auth.uid()
      and staff.role in ('subadmin', 'superadmin')
  ) or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$function_body$
    $create_function$;

    -- CREATE FUNCTION grants EXECUTE to PUBLIC by default. Remove that
    -- default and any role-specific grants before granting the allowlist.
    execute 'revoke all privileges on function public.shelf_admin_mfa_access_allowed() from public, anon, authenticated, service_role';
    execute 'grant execute on function public.shelf_admin_mfa_access_allowed() to authenticated, service_role';
  elsif v_named_function_count <> 1 or v_zero_argument_function_count <> 1 then
    raise exception
      'Expected exactly one public.shelf_admin_mfa_access_allowed() function; found % function(s), including % zero-argument function(s). No existing function was replaced.',
      v_named_function_count,
      v_zero_argument_function_count;
  end if;

  v_function_oid := pg_catalog.to_regprocedure(
    'public.shelf_admin_mfa_access_allowed()'
  )::oid;
  if v_function_oid is null then
    raise exception
      'public.shelf_admin_mfa_access_allowed() was not created or could not be resolved.';
  end if;

  select function_owner.rolname,
         function_proc.prorettype = 'pg_catalog.bool'::pg_catalog.regtype,
         function_proc.proretset,
         function_proc.prokind,
         function_language.lanname,
         function_proc.provolatile,
         function_proc.prosecdef,
         function_proc.proconfig,
         function_proc.prosrc
  into v_owner_name,
       v_returns_boolean,
       v_returns_set,
       v_routine_kind,
       v_language_name,
       v_volatility,
       v_security_definer,
       v_function_config,
       v_function_body
  from pg_catalog.pg_proc function_proc
  join pg_catalog.pg_namespace function_ns
    on function_ns.oid = function_proc.pronamespace
  join pg_catalog.pg_roles function_owner
    on function_owner.oid = function_proc.proowner
  join pg_catalog.pg_language function_language
    on function_language.oid = function_proc.prolang
  where function_proc.oid = v_function_oid
    and function_ns.nspname = 'public'
    and function_proc.pronargs = 0;

  if v_owner_name is distinct from 'postgres'
     or v_returns_boolean is distinct from true
     or v_returns_set is distinct from false
     or v_routine_kind is distinct from 'f'
     or v_language_name is distinct from 'sql'
     or v_volatility is distinct from 's'
     or v_security_definer is distinct from true
     or v_function_config is distinct from array['search_path=public, pg_temp']::text[]
     or pg_catalog.regexp_replace(
          btrim(replace(replace(v_function_body, E'\r\n', E'\n'), E'\r', E'\n')),
          '[ \t]+$', '', 'gm'
        ) is distinct from pg_catalog.regexp_replace(
          btrim(replace(replace(v_expected_body, E'\r\n', E'\n'), E'\r', E'\n')),
          '[ \t]+$', '', 'gm'
        ) then
    raise exception
      'Existing public.shelf_admin_mfa_access_allowed() does not match the expected owner, signature, scalar return type, language, volatility, security mode, search_path, or body. No existing function was replaced.';
  end if;

  -- Validate direct ACL entries separately from effective privileges. A NULL
  -- proacl means PostgreSQL's default function ACL applies (including PUBLIC
  -- EXECUTE), which is not an acceptable explicit allowlist for this helper.
  select function_proc.proacl is not null,
         coalesce(bool_or(acl.grantee = 0 and acl.privilege_type = 'EXECUTE'), false),
         coalesce(bool_or(acl.grantee = 'anon'::pg_catalog.regrole::oid
                          and acl.privilege_type = 'EXECUTE'), false),
         coalesce(bool_or(acl.grantee = 'authenticated'::pg_catalog.regrole::oid
                          and acl.privilege_type = 'EXECUTE'
                          and not acl.is_grantable), false),
         coalesce(bool_or(acl.grantee = 'service_role'::pg_catalog.regrole::oid
                          and acl.privilege_type = 'EXECUTE'
                          and not acl.is_grantable), false),
         coalesce(bool_or(acl.grantee = function_proc.proowner
                          and acl.privilege_type = 'EXECUTE'
                          and not acl.is_grantable), false),
         coalesce(bool_or(
           acl.privilege_type <> 'EXECUTE'
           or (acl.grantee = function_proc.proowner and acl.is_grantable)
           or (acl.grantee <> function_proc.proowner and acl.is_grantable)
           or acl.grantee not in (
             function_proc.proowner,
             'authenticated'::pg_catalog.regrole::oid,
             'service_role'::pg_catalog.regrole::oid
           )
         ), false),
         count(acl.grantee)::integer
  into v_acl_is_explicit,
       v_has_public_execute,
       v_has_anon_execute,
       v_has_authenticated_execute,
       v_has_service_role_execute,
       v_has_owner_execute,
       v_has_unexpected_acl,
       v_acl_entry_count
  from pg_catalog.pg_proc function_proc
  left join lateral pg_catalog.aclexplode(function_proc.proacl) acl on true
  where function_proc.oid = v_function_oid
  group by function_proc.proacl, function_proc.proowner;

  -- has_function_privilege resolves effective access, including PUBLIC and
  -- role memberships. Keep these checks distinct from the direct ACL checks.
  select pg_catalog.has_function_privilege('anon', v_function_oid, 'EXECUTE'),
         pg_catalog.has_function_privilege('authenticated', v_function_oid, 'EXECUTE'),
         pg_catalog.has_function_privilege('service_role', v_function_oid, 'EXECUTE')
  into v_has_effective_anon_execute,
       v_has_effective_authenticated_execute,
       v_has_effective_service_role_execute;

  if not v_acl_is_explicit
     or v_has_public_execute
     or v_has_anon_execute
     or not v_has_authenticated_execute
     or not v_has_service_role_execute
     or not v_has_owner_execute
     or v_acl_entry_count <> 3
     or v_has_unexpected_acl
     or v_has_effective_anon_execute
     or not v_has_effective_authenticated_execute
     or not v_has_effective_service_role_execute then
    raise exception
      'public.shelf_admin_mfa_access_allowed() ACL mismatch: expected explicit owner EXECUTE without an ACL grant option, authenticated and service_role EXECUTE without grant option, no PUBLIC or anon EXECUTE, no other ACL entries, and effective access only for the allowlisted roles.';
  end if;
end;
$migration$;