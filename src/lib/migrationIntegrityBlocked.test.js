import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMigrationManifest } from '../../scripts/validate-migrations.mjs';

// Phase 6: Group 14 - Migration Integrity Verification Tests
// These remaining catalog checks need an isolated database with this migration set applied.
// Deterministic local manifest, selected postflight-source, and dependency-order checks run below.

const MIGRATION_CHECKS = [
  {
    name: 'no_function_signature_conflicts',
    description: 'No duplicate/conflicting function signatures across migrations',
  },
  {
    name: 'no_grant_expansion',
    description: 'Function grants match documented intent (no PUBLIC/anon on SECURITY DEFINER)',
  },
  {
    name: 'function_ownership_search_path',
    description: 'All SECURITY DEFINER functions owned by postgres with empty search_path',
  },
  {
    name: 'rls_policy_coverage',
    description: 'All sensitive tables have RLS enabled with policies',
  },
  {
    name: 'function_volatility',
    description: 'Functions have appropriate volatility (STABLE/IMMUTABLE where applicable)',
  },
  {
    name: 'type_consistency_visitor_id',
    description: 'visitor_id (TEXT) vs auth_user_id (UUID) consistency across tables',
  },
];

for (const check of MIGRATION_CHECKS) {
  test.skip(`migration integrity: ${check.name}`, () => {
    // Requires isolated PostgreSQL database with all 158 migrations applied
  });
}

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
  assert.deepEqual(
    manifest.migrations.map(({ version }) => version),
    [...manifest.migrations.map(({ version }) => version)].sort()
  );
});

test('migration integrity: security-remediation migrations include source postflight guards', () => {
  const migrationsWithExpectedPostflight = [
    '20270102002500_remaining_secdef_hardening.sql',
    '20270102002600_fix_visitor_functions_aal2_and_harden_base.sql',
    '20270102002700_critical_rpcs_for_direct_access.sql',
    '20270103000100_fine_payment_internal_hardening_and_cohort_protection.sql',
    '20270103000600_community_books_read_later.sql',
    '20270103000700_community_books_read_later_rpcs.sql',
    '20270118000000_fail_closed_attendance_lookup_role_claim.sql',
  ];
  for (const file of migrationsWithExpectedPostflight) {
    const sql = readFileSync(join(migrationDirectory, file), 'utf8');
    assert.match(sql, /\bDO\b/i, `${file} should have a catalog assertion block`);
    assert.match(sql, /RAISE\s+EXCEPTION/i, `${file} should fail closed on assertion mismatch`);
  }
});

test('migration integrity: declared prerequisite versions precede their dependent migrations', () => {
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

test('migration integrity: frontend RPCs retain a current local SQL definition', () => {
  const frontendFiles = sourceFilesUnder(fileURLToPath(new URL('../../src/', import.meta.url)));
  const rpcNames = new Set();
  for (const file of frontendFiles) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\.rpc\(\s*['"]([a-z_][a-z0-9_]*)['"]/gi)) {
      rpcNames.add(match[1].toLowerCase());
    }
  }

  const latestEvents = new Map();
  for (const { file, contents } of localMigrationEntries) {
    const sql = contents.toString('utf8');
    const eventPattern = /\b(CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION|DROP\s+FUNCTION(?:\s+IF\s+EXISTS)?)\s+(?:public\s*\.\s*)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi;
    for (const match of sql.matchAll(eventPattern)) {
      latestEvents.set(match[2].toLowerCase(), {
        action: match[1].toUpperCase().startsWith('DROP') ? 'drop' : 'create',
        file,
      });
    }
  }

  const schemaDefinitionNames = new Set();
  const schemaFiles = [
    fileURLToPath(new URL('../../supabase/schema.sql', import.meta.url)),
    ...sourceFilesUnder(fileURLToPath(new URL('../../supabase/schemas/', import.meta.url)))
      .filter((file) => file.endsWith('.sql')),
  ];
  const definitionPattern = /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\s*\.\s*)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi;
  for (const file of schemaFiles) {
    const sql = readFileSync(file, 'utf8');
    for (const match of sql.matchAll(definitionPattern)) schemaDefinitionNames.add(match[1].toLowerCase());
  }

  const unresolved = [...rpcNames].filter((name) => {
    const event = latestEvents.get(name);
    return event ? event.action === 'drop' : !schemaDefinitionNames.has(name);
  });
  assert.deepEqual(unresolved, [], 'every literal frontend RPC must have a latest local SQL CREATE, not DROP');
});

test.skip('migration integrity: SECURITY DEFINER functions have empty search_path', () => {
  // Requires live database to query pg_proc.proconfig
});

test.skip('migration integrity: no GRANT TO PUBLIC on SECURITY DEFINER functions', () => {
  // Requires live database to query pg_proc and pg_roles
});

test('migration integrity: reviewed security migrations retain deterministic source postflight checks', () => {
  const migrationsWithExpectedPostflight = [
    '20270102002500_remaining_secdef_hardening.sql',
    '20270102002600_fix_visitor_functions_aal2_and_harden_base.sql',
    '20270102002700_critical_rpcs_for_direct_access.sql',
    '20270103000100_fine_payment_internal_hardening_and_cohort_protection.sql',
    '20270103000600_community_books_read_later.sql',
    '20270103000700_community_books_read_later_rpcs.sql',
    '20270118000000_fail_closed_attendance_lookup_role_claim.sql',
  ];
  for (const file of migrationsWithExpectedPostflight) {
    const sql = readFileSync(join(migrationDirectory, file), 'utf8');
      assert.match(sql, /\bDO\s+(?:\$[a-z_]*\$|\$\$)/i, `${file} should declare a postflight block`);
    assert.match(sql, /RAISE\s+EXCEPTION/i, `${file} should fail closed on postflight mismatch`);
  }
});
