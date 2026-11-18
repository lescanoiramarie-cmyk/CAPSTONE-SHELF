-- Read-only evidence export for an OWNER-APPROVED production connection.
-- Never run against an unverified target. Use psql with ON_ERROR_STOP and save
-- the single JSON result to a restricted owner-controlled file. No row data,
-- credentials, Auth tokens, or visitor/payment records are selected.
BEGIN TRANSACTION READ ONLY;

SELECT jsonb_build_object(
  'format', 'shelf-catalog-evidence-v1',
  'projectIdentity', jsonb_build_object(
    'database', current_database(),
    'serverVersion', current_setting('server_version'),
    'serverVersionNum', current_setting('server_version_num'),
    'currentRole', current_user
  ),
  'capturedAt', clock_timestamp(),
  'migrationHistory', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'version', migration.version::text,
      'name', migration.name::text
    ) ORDER BY migration.version), '[]'::jsonb)
    FROM supabase_migrations.schema_migrations AS migration
  ),
  'relations', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'key', 'relation:' || namespace.nspname || '.' || relation.relname,
      'schema', namespace.nspname,
      'name', relation.relname,
      'kind', relation.relkind,
      'owner', owner_role.rolname,
      'rlsEnabled', relation.relrowsecurity,
      'rlsForced', relation.relforcerowsecurity,
      'acl', relation.relacl::text,
      'columns', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'name', attribute.attname,
          'type', pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
          'notNull', attribute.attnotnull,
          'default', pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid),
          'identity', attribute.attidentity,
          'generated', attribute.attgenerated
        ) ORDER BY attribute.attnum), '[]'::jsonb)
        FROM pg_catalog.pg_attribute AS attribute
        LEFT JOIN pg_catalog.pg_attrdef AS default_value
          ON default_value.adrelid = attribute.attrelid AND default_value.adnum = attribute.attnum
        WHERE attribute.attrelid = relation.oid
          AND attribute.attnum > 0 AND NOT attribute.attisdropped
      )
    ) ORDER BY namespace.nspname, relation.relname), '[]'::jsonb)
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = relation.relowner
    WHERE namespace.nspname = 'public'
      AND relation.relname = ANY(ARRAY[
        'libraries', 'visitors', 'staff_profiles', 'books', 'borrow_requests',
        'attendance_logs', 'book_reviews', 'book_rating_aggregates',
        'fine_payments', 'community_book_requests', 'announcements',
        'audit_logs', 'due_date_notifications'
      ])
  ),
  'constraints', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'key', 'constraint:' || namespace.nspname || '.' || relation.relname || '.' || constraint_row.conname,
      'table', namespace.nspname || '.' || relation.relname,
      'name', constraint_row.conname,
      'type', constraint_row.contype,
      'definition', pg_catalog.pg_get_constraintdef(constraint_row.oid, true),
      'validated', constraint_row.convalidated,
      'deferrable', constraint_row.condeferrable,
      'initiallyDeferred', constraint_row.condeferred,
      'referencedTable', CASE WHEN constraint_row.confrelid = 0 THEN NULL
        ELSE constraint_row.confrelid::regclass::text END
    ) ORDER BY relation.relname, constraint_row.conname), '[]'::jsonb)
    FROM pg_catalog.pg_constraint AS constraint_row
    JOIN pg_catalog.pg_class AS relation ON relation.oid = constraint_row.conrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = ANY(ARRAY[
        'libraries', 'visitors', 'staff_profiles', 'books', 'borrow_requests',
        'attendance_logs', 'book_reviews', 'book_rating_aggregates',
        'fine_payments', 'community_book_requests', 'announcements',
        'audit_logs', 'due_date_notifications'
      ])
  ),
  'indexes', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'key', 'index:' || namespace.nspname || '.' || index_relation.relname,
      'table', namespace.nspname || '.' || table_relation.relname,
      'name', index_relation.relname,
      'definition', pg_catalog.pg_get_indexdef(index_relation.oid),
      'valid', index_row.indisvalid,
      'ready', index_row.indisready,
      'live', index_row.indislive
    ) ORDER BY table_relation.relname, index_relation.relname), '[]'::jsonb)
    FROM pg_catalog.pg_index AS index_row
    JOIN pg_catalog.pg_class AS index_relation ON index_relation.oid = index_row.indexrelid
    JOIN pg_catalog.pg_class AS table_relation ON table_relation.oid = index_row.indrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = table_relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND table_relation.relname = ANY(ARRAY[
        'libraries', 'visitors', 'staff_profiles', 'books', 'borrow_requests',
        'attendance_logs', 'book_reviews', 'book_rating_aggregates',
        'fine_payments', 'community_book_requests', 'announcements',
        'audit_logs', 'due_date_notifications'
      ])
  ),
  'policies', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'key', 'policy:public.' || relation.relname || '.' || policy.polname,
      'table', 'public.' || relation.relname,
      'name', policy.polname,
      'command', policy.polcmd,
      'permissive', policy.polpermissive,
      'roles', ARRAY(
        SELECT CASE WHEN role_oid = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(role_oid) END
        FROM unnest(policy.polroles) AS role_oid ORDER BY 1
      ),
      'using', pg_catalog.pg_get_expr(policy.polqual, policy.polrelid),
      'withCheck', pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid)
    ) ORDER BY relation.relname, policy.polname), '[]'::jsonb)
    FROM pg_catalog.pg_policy AS policy
    JOIN pg_catalog.pg_class AS relation ON relation.oid = policy.polrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = ANY(ARRAY[
        'libraries', 'visitors', 'staff_profiles', 'books', 'borrow_requests',
        'attendance_logs', 'book_reviews', 'book_rating_aggregates',
        'fine_payments', 'community_book_requests', 'announcements',
        'audit_logs', 'due_date_notifications'
      ])
  ),
  'triggers', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'key', 'trigger:' || namespace.nspname || '.' || relation.relname || '.' || trigger_row.tgname,
      'table', namespace.nspname || '.' || relation.relname,
      'name', trigger_row.tgname,
      'definition', pg_catalog.pg_get_triggerdef(trigger_row.oid, true),
      'enabled', trigger_row.tgenabled,
      'function', trigger_row.tgfoid::regprocedure::text
    ) ORDER BY namespace.nspname, relation.relname, trigger_row.tgname), '[]'::jsonb)
    FROM pg_catalog.pg_trigger AS trigger_row
    JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger_row.tgrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE NOT trigger_row.tgisinternal
      AND ((namespace.nspname = 'public' AND relation.relname = ANY(ARRAY[
        'visitors', 'books', 'borrow_requests', 'attendance_logs', 'book_reviews',
        'fine_payments', 'community_book_requests', 'announcements', 'audit_logs'
      ])) OR (namespace.nspname = 'auth' AND relation.relname = 'users'))
  ),
  'functions', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'key', 'function:' || namespace.nspname || '.' || procedure.proname || '(' || pg_catalog.oidvectortypes(procedure.proargtypes) || ')',
      'identityArguments', pg_catalog.pg_get_function_identity_arguments(procedure.oid),
      'result', pg_catalog.pg_get_function_result(procedure.oid),
      'owner', owner_role.rolname,
      'language', language.lanname,
      'volatility', procedure.provolatile,
      'securityDefiner', procedure.prosecdef,
      'configuration', procedure.proconfig,
      'directAcl', procedure.proacl::text,
      'definition', pg_catalog.pg_get_functiondef(procedure.oid)
    ) ORDER BY procedure.proname, procedure.oid), '[]'::jsonb)
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = procedure.proowner
    JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
    WHERE namespace.nspname = 'public'
      AND (procedure.prosecdef IS TRUE OR procedure.proname = ANY(ARRAY[
        'is_active_staff_for_branch', 'is_shelf_superadmin',
        'shelf_admin_mfa_access_allowed', 'find_visitor_by_qr',
        'lookup_attendance_visitor_v2', 'toggle_attendance',
        'confirm_pickup', 'confirm_return', 'confirm_community_book_pickup',
        'confirm_community_book_return', 'get_fine_payment_dashboard',
        'get_fine_payment_analytics', 'get_fine_payment_alert_targets',
        'record_fine_payment', 'resolve_fine_review', 'get_book_reviews',
        'save_my_book_review', 'delete_my_book_review', 'approve_community_visitor',
        'register_visitor_v2', 'capture_shelf_audit_event'
      ]))
  ),
  'effectivePrivileges', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'role', role_name,
      'object', object_name,
      'privilege', privilege_name,
      'allowed', allowed
    ) ORDER BY role_name, object_name, privilege_name), '[]'::jsonb)
    FROM (
      SELECT role_name, object_name, privilege_name,
        CASE WHEN privilege_name = 'EXECUTE' THEN COALESCE((
          SELECT pg_catalog.has_function_privilege(role_name, function_oid, 'EXECUTE')
          FROM (SELECT pg_catalog.to_regprocedure(object_name)::oid AS function_oid) AS resolved
          WHERE function_oid IS NOT NULL
        ), false) ELSE COALESCE((
          SELECT pg_catalog.has_table_privilege(role_name, relation_oid, privilege_name)
          FROM (SELECT pg_catalog.to_regclass(object_name)::oid AS relation_oid) AS resolved
          WHERE relation_oid IS NOT NULL
        ), false) END AS allowed
      FROM (VALUES
        ('anon'::text, 'public.attendance_logs'::text, 'SELECT'::text),
        ('authenticated', 'public.attendance_logs', 'SELECT'),
        ('anon', 'public.book_reviews', 'SELECT'),
        ('authenticated', 'public.book_reviews', 'SELECT'),
        ('anon', 'public.fine_payments', 'SELECT'),
        ('authenticated', 'public.fine_payments', 'SELECT'),
        ('anon', 'public.is_active_staff_for_branch(text)', 'EXECUTE'),
        ('authenticated', 'public.is_active_staff_for_branch(text)', 'EXECUTE'),
        ('anon', 'public.lookup_attendance_visitor_v2(text,text)', 'EXECUTE'),
        ('authenticated', 'public.lookup_attendance_visitor_v2(text,text)', 'EXECUTE'),
        ('anon', 'public.get_fine_payment_analytics(text)', 'EXECUTE'),
        ('authenticated', 'public.get_fine_payment_analytics(text)', 'EXECUTE'),
        ('service_role', 'public.get_fine_payment_analytics(text)', 'EXECUTE')
      ) AS expected(role_name, object_name, privilege_name)
    ) AS effective
  ),
  'defaultPrivileges', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'owner', owner_role.rolname,
      'schema', CASE WHEN defaults.defaclnamespace = 0 THEN NULL ELSE namespace.nspname END,
      'objectType', defaults.defaclobjtype,
      'acl', defaults.defaclacl::text
    ) ORDER BY owner_role.rolname, defaults.defaclobjtype), '[]'::jsonb)
    FROM pg_catalog.pg_default_acl AS defaults
    JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = defaults.defaclrole
    LEFT JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = defaults.defaclnamespace
    WHERE owner_role.rolname IN ('postgres', 'supabase_admin')
      AND (defaults.defaclnamespace = 0 OR namespace.nspname = 'public')
  ),
  'roleMemberships', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'role', granted_role.rolname,
      'member', member_role.rolname,
      'grantor', grantor_role.rolname,
      'adminOption', membership.admin_option,
      'inheritOption', membership.inherit_option,
      'setOption', membership.set_option
    ) ORDER BY granted_role.rolname, member_role.rolname), '[]'::jsonb)
    FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS granted_role ON granted_role.oid = membership.roleid
    JOIN pg_catalog.pg_roles AS member_role ON member_role.oid = membership.member
    JOIN pg_catalog.pg_roles AS grantor_role ON grantor_role.oid = membership.grantor
    WHERE granted_role.rolname IN ('anon', 'authenticated', 'service_role', 'postgres', 'supabase_admin')
       OR member_role.rolname IN ('anon', 'authenticated', 'service_role', 'postgres', 'supabase_admin')
  )
) AS evidence;

COMMIT;