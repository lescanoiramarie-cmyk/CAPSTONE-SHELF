import test from 'node:test';
import process from 'node:process';
import assert from 'node:assert/strict';

// These checks run only when the caller explicitly opts into the disposable
// Supabase local database after `supabase db reset --local`.
const localDbConfigured = process.env.SHELF_TEST_LOCAL_SUPABASE === '1';
const pg = localDbConfigured ? (await import('pg')).default : null;
const connection = {
  host: process.env.PGHOST ?? '127.0.0.1',
  port: Number(process.env.PGPORT ?? 54322),
  database: process.env.PGDATABASE ?? 'postgres',
  user: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD ?? 'postgres',
  connectionTimeoutMillis: 5000,
};
async function withDatabase(callback) {
  const client = new pg.Client(connection);
  await client.connect();
  try { return await callback(client); } finally { await client.end(); }
}

const catalogChecks = [
  ['no_function_signature_conflicts', async (client) => {
    const { rows } = await client.query(`SELECT
      to_regprocedure('public.confirm_pickup(text,text)') IS NOT NULL AS pickup_text,
      to_regprocedure('public.confirm_pickup(uuid,text)') IS NOT NULL AS pickup_uuid,
      to_regprocedure('public.confirm_return(text,text)') IS NOT NULL AS return_text,
      to_regprocedure('public.confirm_return(uuid,text)') IS NOT NULL AS return_uuid,
      to_regprocedure('public.record_fine_payment_v2(text,numeric,text,text,text,uuid)') IS NOT NULL AS payment_v2`);
    assert.deepEqual(Object.values(rows[0]), [true, true, true, true, true]);
  }],
  ['no_grant_expansion', async (client) => {
    const { rows } = await client.query(`SELECT
      NOT has_function_privilege('anon','shelf_private.request_borrow_unchecked(uuid,text)','EXECUTE')
      AND NOT has_function_privilege('authenticated','shelf_private.request_borrow_unchecked(uuid,text)','EXECUTE')
      AND NOT has_function_privilege('service_role','shelf_private.request_borrow_unchecked(uuid,text)','EXECUTE')
      AND NOT has_function_privilege('authenticated','public.get_fine_payment_alert_targets_detail_internal(text)','EXECUTE')
      AND NOT has_function_privilege('service_role','public.get_fine_payment_alert_targets_detail_internal(text)','EXECUTE') AS safe`);
    assert.equal(rows[0].safe, true);
  }],
  ['function_ownership_search_path', async (client) => {
    const { rows } = await client.query(`SELECT count(*)::int AS unsafe FROM pg_proc p
      WHERE p.oid = ANY(ARRAY[
        'public.confirm_pickup(text,text)'::regprocedure,
        'public.confirm_return(text,text)'::regprocedure,
        'public.lookup_attendance_visitor_v2(text,text)'::regprocedure,
        'public.record_fine_payment_v2(text,numeric,text,text,text,uuid)'::regprocedure
      ]) AND (p.proowner <> 'postgres'::regrole OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[])`);
    assert.equal(rows[0].unsafe, 0);
  }],
  ['rls_policy_coverage', async (client) => {
    const { rows } = await client.query(`SELECT count(*)::int AS unsafe FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname = ANY(ARRAY['borrow_requests','fine_payments','staff_profiles','book_reviews','attendance_logs','visitors'])
        AND c.relkind='r' AND (NOT c.relrowsecurity OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid))`);
    assert.equal(rows[0].unsafe, 0);
  }],
  ['function_volatility', async (client) => {
    const { rows } = await client.query(`SELECT provolatile='i' AS safe
      FROM pg_proc WHERE oid='public.mask_reviewer_name(text)'::regprocedure`);
    assert.equal(rows[0].safe, true);
  }],
  ['text_borrow_request_handover_contract', async (client) => {
    const { rows } = await client.query(`SELECT
      (SELECT format_type(a.atttypid,a.atttypmod)='text' FROM pg_attribute a
        WHERE a.attrelid='public.borrow_requests'::regclass AND a.attname='id' AND a.attnum>0 AND NOT a.attisdropped)
      AND (SELECT format_type(a.atttypid,a.atttypmod)='text' FROM pg_attribute a
        WHERE a.attrelid='public.fine_payment_idempotency'::regclass AND a.attname='request_id' AND a.attnum>0 AND NOT a.attisdropped)
      AND has_function_privilege('authenticated','public.confirm_pickup_v2(text,text)','EXECUTE')
      AND has_function_privilege('authenticated','public.confirm_return_v2(text,text)','EXECUTE')
      AND NOT has_function_privilege('anon','public.confirm_pickup_v2(text,text)','EXECUTE')
      AND NOT has_function_privilege('anon','public.confirm_return_v2(text,text)','EXECUTE') AS safe`);
    assert.equal(rows[0].safe, true);
  }],
  ['type_consistency_visitor_id', async (client) => {
    const { rows } = await client.query(`SELECT
      (SELECT atttypid='text'::regtype FROM pg_attribute WHERE attrelid='public.book_reviews'::regclass AND attname='visitor_id' AND attnum>0 AND NOT attisdropped)
      AND (SELECT atttypid='text'::regtype FROM pg_attribute WHERE attrelid='public.borrow_requests'::regclass AND attname='visitor_id' AND attnum>0 AND NOT attisdropped)
      AND (SELECT atttypid='uuid'::regtype FROM pg_attribute WHERE attrelid='public.visitors'::regclass AND attname='auth_user_id' AND attnum>0 AND NOT attisdropped) AS safe`);
    assert.equal(rows[0].safe, true);
  }],
  ['security_definer_search_path', async (client) => {
    const { rows } = await client.query(`SELECT count(*)::int AS unsafe FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.prosecdef AND
        (p.proconfig IS NULL OR cardinality(p.proconfig)<>1 OR p.proconfig[1] NOT IN (
          'search_path=""','search_path=public','search_path=public, pg_temp','search_path=public, auth',
          'search_path=pg_catalog, public, pg_temp','search_path=pg_catalog, public, auth, pg_temp'))`);
    assert.equal(rows[0].unsafe, 0);
  }],
  ['no_public_execute_on_security_definer', async (client) => {
    const { rows } = await client.query(`SELECT count(*)::int AS unsafe FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f',p.proowner))) acl
      WHERE n.nspname='public' AND p.prosecdef AND acl.grantee=0 AND acl.privilege_type='EXECUTE'`);
    assert.equal(rows[0].unsafe, 0);
  }],
];

for (const [name, check] of catalogChecks) {
  test(`migration integrity: ${name}`, { skip: !localDbConfigured && 'set SHELF_TEST_LOCAL_SUPABASE=1 after supabase db reset --local' }, async () => {
    await withDatabase(check);
  });
}
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMigrationManifest } from '../../scripts/validate-migrations.mjs';

const migrationDirectory = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));
const localMigrationFiles = readdirSync(migrationDirectory)
  .filter((file) => file.toLowerCase().endsWith('.sql'))
  .sort((left, right) => left.localeCompare(right));
const localMigrationEntries = localMigrationFiles.map((file) => ({
  file,
  contents: readFileSync(join(migrationDirectory, file)),
}));

test('migration integrity: local migration versions are unique, valid, and ordered', () => {
  const manifest = buildMigrationManifest(localMigrationEntries);
  assert.deepEqual(manifest.errors, []);
  assert.equal(manifest.migrations.length, localMigrationFiles.length);
  assert.ok(manifest.migrations.length > 0);
  assert.deepEqual(manifest.migrations.map(({ version }) => version), [...manifest.migrations.map(({ version }) => version)].sort());
});

test('migration integrity: security remediation source has postflight guards', () => {
  const migrations = [
    '20270102002500_remaining_secdef_hardening.sql',
    '20270102002600_fix_visitor_functions_aal2_and_harden_base.sql',
    '20270102002700_critical_rpcs_for_direct_access.sql',
    '20270103000100_fine_payment_internal_hardening_and_cohort_protection.sql',
    '20270103000600_community_books_read_later.sql',
    '20270103000700_community_books_read_later_rpcs.sql',
    '20270118000000_fail_closed_attendance_lookup_role_claim.sql',
    '20270128000000_fix_handover_existing_columns.sql',
    '20270129000000_support_text_borrow_request_ids.sql',
    '20270130000000_lock_down_borrowed_book_counts_table.sql',
  ];
  for (const file of migrations) {
    const sql = readFileSync(join(migrationDirectory, file), 'utf8');
    assert.match(sql, /\bDO\b/i, `${file} should have catalog assertions`);
    assert.match(sql, /RAISE\s+EXCEPTION/i, `${file} should fail closed on mismatch`);
  }
});

test('migration integrity: declared prerequisite versions precede dependent migrations', () => {
  const dependencies = [
    ['20270102000300', '20270102000400'],
    ['20270102000300', '20270102001100'],
    ['20270102001100', '20270102001800'],
    ['20270102001100', '20270102002300'],
    ['20270103000800', '20270103000900'],
  ];
  const versions = new Set(localMigrationFiles.map((file) => file.slice(0, 14)));
  for (const [prerequisite, dependent] of dependencies) {
    assert.ok(versions.has(prerequisite), `missing prerequisite migration ${prerequisite}`);
    assert.ok(versions.has(dependent), `missing dependent migration ${dependent}`);
    assert.ok(prerequisite < dependent, `${prerequisite} must precede ${dependent}`);
  }
});

function sourceFilesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = join(directory, entry.name);
    return entry.isDirectory()
      ? sourceFilesUnder(absolutePath)
      : /\.(?:js|jsx|ts|tsx)$/.test(entry.name) ? [absolutePath] : [];
  });
}

test('migration integrity: frontend RPCs have a latest local SQL definition', () => {
  const frontendFiles = sourceFilesUnder(fileURLToPath(new URL('../../src/', import.meta.url)));
  const rpcNames = new Set();
  for (const file of frontendFiles) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\.rpc\(\s*['"]([a-z_][a-z0-9_]*)['"]/gi)) rpcNames.add(match[1].toLowerCase());
  }
  const latestEvents = new Map();
  for (const { file, contents } of localMigrationEntries) {
    const sql = contents.toString('utf8');
    const eventPattern = /\b(CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION|DROP\s+FUNCTION(?:\s+IF\s+EXISTS)?)\s+(?:public\s*\.\s*)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi;
    for (const match of sql.matchAll(eventPattern)) latestEvents.set(match[2].toLowerCase(), { action: match[1].toUpperCase().startsWith('DROP') ? 'drop' : 'create', file });
  }
  const schemaNames = new Set();
  const schemaFiles = [
    fileURLToPath(new URL('../../supabase/schema.sql', import.meta.url)),
    ...sourceFilesUnder(fileURLToPath(new URL('../../supabase/schemas/', import.meta.url))).filter((file) => file.endsWith('.sql')),
  ];
  const definitionPattern = /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\s*\.\s*)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi;
  for (const file of schemaFiles) for (const match of readFileSync(file, 'utf8').matchAll(definitionPattern)) schemaNames.add(match[1].toLowerCase());
  const unresolved = [...rpcNames].filter((name) => {
    const event = latestEvents.get(name);
    return event ? event.action === 'drop' : !schemaNames.has(name);
  });
  assert.deepEqual(unresolved, [], 'every literal frontend RPC must have a latest local SQL CREATE, not DROP');
});

test('migration integrity: reviewable security migrations retain postflight checks', () => {
  const files = [
    '20270102002500_remaining_secdef_hardening.sql',
    '20270102002600_fix_visitor_functions_aal2_and_harden_base.sql',
    '20270102002700_critical_rpcs_for_direct_access.sql',
    '20270103000100_fine_payment_internal_hardening_and_cohort_protection.sql',
    '20270103000600_community_books_read_later.sql',
    '20270103000700_community_books_read_later_rpcs.sql',
    '20270118000000_fail_closed_attendance_lookup_role_claim.sql',
    '20270128000000_fix_handover_existing_columns.sql',
    '20270129000000_support_text_borrow_request_ids.sql',
  ];
  for (const file of files) {
    const sql = readFileSync(join(migrationDirectory, file), 'utf8');
    assert.match(sql, /\bDO\s+(?:\$[a-z_]*\$|\$\$)/i, `${file} should declare postflight`);
    assert.match(sql, /RAISE\s+EXCEPTION/i, `${file} should fail closed`);
  }
});
