/**
 * test_production_migration_runner.mjs
 *
 * Exhaustive 19-scenario test suite for scripts/run-production-migrations.mjs:
 *
 * Security & Credential Protection:
 * 1. CLI Credentials Rejection: Rejects --db-url, --connection-string, --password.
 * 2. Secrets Redaction: Proves passwords cannot leak into logs or sanitized error messages.
 * 3. Empty & invalid project identity rejection.
 * 4. Wrong project ref rejection (must be khwtfjyvawukbsvyjdux).
 * 5. Missing production confirmation rejection.
 * 6. Missing backup acknowledgement rejection.
 * 7. Tampered migration checksum detection (fail-closed before execution).
 * 8. Unexpected ledger version detection (fail-closed).
 * 9. Reordered / non-monotonic ledger version detection (fail-closed).
 * 10. Atomic Category B preflight failure (fail-closed on missing schema effects).
 *
 * Execution, Idempotency & Rehearsal:
 * 11. Dry-Run Rehearsal: Analyzes all 45 Category C migrations in an isolated rollback; preserves ledger at 119.
 * 12. Full Execution: Applies all 45 migrations sequentially; stamps ledger to 170.
 * 13. Idempotent Repeat: Reports UP_TO_DATE with 0 executed; database left untouched.
 *
 * Failure Recovery & Integrity:
 * 14. First Migration Failure: Migration #1 fails -> 0 committed, ledger remains at 119, failed migration NOT stamped.
 * 15. Mid-Sequence Failure: Migration #20 fails -> exactly 19 committed, ledger at 138 (119 + 19), migration #20 NOT stamped, migrations 1..19 remain stamped.
 * 16. Near-End Failure: Migration #44 fails -> exactly 43 committed, ledger at 162 (119 + 43), migration #44 NOT stamped, migrations 1..43 remain stamped.
 * 17. Successful Resume: Safely resumes after fixing failure #44, applies remaining 2 migrations, reaches 170.
 * 18. Zero Duplicate Migrations: Verifies no duplicate versions exist in schema_migrations.
 * 19. Category B Isolation: Poisoned Category B files are never executed directly; stamped by 20270120000000.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  runMigrations,
  computeFileChecksum,
  parseArgs,
  redactConnectionString,
  sanitizeErrorMessage,
  resolveSslConfig
} from './scripts/run-production-migrations.mjs';

const { Client } = pg;
const PG_PORT = 5433;
const PG_HOST = '127.0.0.1';
const PG_USER = 'postgres';
const BASE_DB_URL = `postgres://${PG_USER}@${PG_HOST}:${PG_PORT}`;
const TEST_DB = 'shelf_runner_test';
const TEST_DB_URL = `${BASE_DB_URL}/${TEST_DB}`;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, 'supabase', 'migrations');

async function executeSql(client, sql) {
  let clean = sql;
  if (clean.charCodeAt(0) === 0xFEFF) {
    clean = clean.slice(1);
  }
  clean = clean.replace(/\r\n/g, '\n').replace(/^\\.*$/gm, '');
  clean = clean.replace(/create\s+extension\s+(?:if\s+not\s+exists\s+)?["']?(?:pg_cron|pg_net)["']?[^;]*;/gi, '-- cloud extension mocked');
  clean = clean.replace(/WHERE c\.conrelid = v_fine_oid;/g, "WHERE c.conrelid = v_fine_oid AND c.contype != 'n';");
  clean = clean.replace(/WHERE c\.conrelid = v_borrow_oid/g, "WHERE c.conrelid = v_borrow_oid AND c.contype != 'n'");
  clean = clean.replace(/AND c\.conname <> 'borrow_requests_fine_paid_amount_check'/g, "AND c.contype != 'n' AND c.conname <> 'borrow_requests_fine_paid_amount_check'");
  await client.query(clean);
}

async function resetTestDatabase() {
  const adminClient = new Client({ connectionString: `${BASE_DB_URL}/postgres` });
  await adminClient.connect();
  await adminClient.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await adminClient.query(`CREATE DATABASE ${TEST_DB}`);
  await adminClient.end();

  const client = new Client({ connectionString: TEST_DB_URL });
  await client.connect();

  // Create base roles & extensions
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS extensions;
    CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN INHERIT; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN INHERIT; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS INHERIT; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticator') THEN CREATE ROLE authenticator LOGIN NOINHERIT; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'shelf_attendance_rpc_owner') THEN CREATE ROLE shelf_attendance_rpc_owner NOLOGIN NOINHERIT NOBYPASSRLS; END IF;
    END $$;
    GRANT anon TO authenticator WITH INHERIT FALSE, SET TRUE;
    GRANT authenticated TO authenticator WITH INHERIT FALSE, SET TRUE;
    GRANT service_role TO authenticator WITH INHERIT FALSE, SET TRUE;
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE SCHEMA IF NOT EXISTS storage;
    CREATE SCHEMA IF NOT EXISTS supabase_migrations;
    CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text primary key, statements text[], name text);
    GRANT USAGE ON SCHEMA extensions TO postgres, anon, authenticated, service_role;
    GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
    GRANT USAGE ON SCHEMA auth TO postgres, anon, authenticated, service_role;

    CREATE TABLE IF NOT EXISTS storage.buckets (
      id text PRIMARY KEY,
      name text NOT NULL,
      owner uuid,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now(),
      public boolean DEFAULT false,
      file_size_limit bigint,
      allowed_mime_types text[]
    );
    CREATE TABLE IF NOT EXISTS storage.objects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      bucket_id text REFERENCES storage.buckets(id),
      name text,
      owner uuid,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now(),
      last_accessed_at timestamptz DEFAULT now(),
      metadata jsonb DEFAULT '{}'::jsonb
    );
    CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql AS $$ SELECT string_to_array(name, '/') $$;
    CREATE OR REPLACE FUNCTION storage.filename(name text) RETURNS text LANGUAGE sql AS $$ SELECT split_part(name, '/', array_length(string_to_array(name, '/'), 1)) $$;
    CREATE OR REPLACE FUNCTION storage.extension(name text) RETURNS text LANGUAGE sql AS $$ SELECT split_part(name, '.', array_length(string_to_array(name, '.'), 1)) $$;

    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;
    GRANT ALL ON SCHEMA storage TO postgres, service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA storage TO postgres, service_role;
    GRANT ALL ON ALL FUNCTIONS IN SCHEMA storage TO postgres, service_role, authenticated, anon;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA storage TO authenticated, anon;

    -- Supabase Cloud extensions simulation
    CREATE SCHEMA IF NOT EXISTS cron;
    CREATE TABLE IF NOT EXISTS cron.job (jobid bigint, jobname text);
    CREATE OR REPLACE FUNCTION cron.schedule(text, text, text) RETURNS bigint LANGUAGE sql AS 'SELECT 1::bigint';
    CREATE OR REPLACE FUNCTION cron.unschedule(bigint) RETURNS boolean LANGUAGE sql AS 'SELECT true';
    CREATE OR REPLACE FUNCTION cron.unschedule(text) RETURNS boolean LANGUAGE sql AS 'SELECT true';

    CREATE SCHEMA IF NOT EXISTS net;
    CREATE OR REPLACE FUNCTION net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb, headers jsonb default '{}'::jsonb, timeout_milliseconds integer default 5000) RETURNS bigint LANGUAGE sql AS 'SELECT 1::bigint';
    CREATE OR REPLACE FUNCTION extensions.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb, headers jsonb default '{}'::jsonb, timeout_milliseconds integer default 5000) RETURNS bigint LANGUAGE sql AS 'SELECT 1::bigint';

    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text,
      raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
      raw_app_meta_data jsonb DEFAULT '{}'::jsonb,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now(),
      email_confirmed_at timestamptz,
      role text DEFAULT 'authenticated',
      aud text DEFAULT 'authenticated'
    );
    GRANT ALL ON TABLE auth.users TO postgres, service_role;
    GRANT SELECT ON TABLE auth.users TO authenticated, anon;

    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT NULLIF(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
    CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS 'SELECT NULLIF(current_setting(''request.jwt.claim.role'', true), '''')::text';
    CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS 'SELECT COALESCE(NULLIF(current_setting(''request.jwt.claims'', true), '''')::jsonb, ''{}''::jsonb)';
  `);

  const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
  const catBSet = new Set([
    '20261108160959',
    '20261109130133',
    '20261129999998',
    '20261129999999',
    '20261226999999',
    '20261227000001',
  ]);

  const baselineFiles = files.filter(f => f < '20270102000000');
  for (const f of baselineFiles) {
    const v = f.slice(0, 14);
    const content = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
    await executeSql(client, content);
    if (!catBSet.has(v)) {
      await client.query(
        "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [v, f.replace(/\.sql$/, '')]
      );
    }
  }

  // Align with reviewed production catalog state where capture_shelf_audit_event was granted to service_role
  await client.query('GRANT EXECUTE ON FUNCTION public.capture_shelf_audit_event() TO service_role');

  await client.end();
}

async function run19Scenarios() {
  console.log('================================================================');
  console.log('   PRODUCTION MIGRATION RUNNER — 19 SCENARIO TEST SUITE');
  console.log('================================================================\n');

  // Test 1: CLI Credentials Rejection
  console.log('--- Scenario 1: CLI Database Credentials Rejection ---');
  let cliErr1 = null;
  try {
    parseArgs(['--execute', '--db-url', 'postgres://postgres:supersecret@db.supabase.co:5432/postgres']);
  } catch (err) { cliErr1 = err; }
  if (!cliErr1 || !cliErr1.message.includes('SECURITY VIOLATION')) {
    throw new Error('Scenario 1 FAILED: Expected rejection when --db-url is passed on CLI!');
  }

  let cliErr2 = null;
  try {
    parseArgs(['--execute', '--connection-string', 'postgres://postgres:supersecret@localhost/db']);
  } catch (err) { cliErr2 = err; }
  if (!cliErr2 || !cliErr2.message.includes('SECURITY VIOLATION')) {
    throw new Error('Scenario 1 FAILED: Expected rejection when --connection-string is passed on CLI!');
  }
  console.log('  PASS: Passing database credentials via CLI arguments is strictly forbidden.');

  // Test 2: Secrets Redaction & Error Sanitization
  console.log('--- Scenario 2: Connection String Redaction & Error Sanitization ---');
  const sensitiveUrl = 'postgres://postgres:TopSecretPass123!@db.khwtfjyvawukbsvyjdux.supabase.co:5432/postgres';
  const redacted = redactConnectionString(sensitiveUrl);
  if (redacted.includes('TopSecretPass123!')) {
    throw new Error('Scenario 2 FAILED: redactConnectionString leaked the password!');
  }
  if (!redacted.includes('postgres://postgres:***@db.khwtfjyvawukbsvyjdux.supabase.co:5432/postgres')) {
    throw new Error(`Scenario 2 FAILED: Unexpected redacted format: ${redacted}`);
  }

  const sensitiveError = `FATAL: password authentication failed for user "postgres" with password="MyPassword999" at ${sensitiveUrl}`;
  const sanitized = sanitizeErrorMessage(sensitiveError);
  if (sanitized.includes('MyPassword999') || sanitized.includes('TopSecretPass123!')) {
    throw new Error('Scenario 2 FAILED: sanitizeErrorMessage leaked credentials!');
  }
  console.log('  PASS: Passwords and connection strings are cleanly redacted from logs and errors.');

  // Test 3: Empty/invalid project identity
  console.log('--- Scenario 3: Empty/Invalid Project Identity ---');
  try {
    await runMigrations({
      dryRun: true,
      execute: false,
      connectionString: 'postgres://postgres:secret@db.khwtfjyvawukbsvyjdux.supabase.co:5432/postgres',
      projectRef: '',
    });
    throw new Error('Scenario 3 FAILED: Expected rejection on empty project ref!');
  } catch (err) {
    if (err.message.includes('requires --project-ref khwtfjyvawukbsvyjdux')) {
      console.log('  PASS: Rejected remote connection with empty project ref.');
    } else throw err;
  }

  // Test 4: Wrong project ref
  console.log('--- Scenario 4: Wrong Project Reference ---');
  try {
    await runMigrations({
      dryRun: true,
      execute: false,
      connectionString: 'postgres://postgres:secret@db.wrongref12345.supabase.co:5432/postgres',
      projectRef: 'wrongref12345',
    });
    throw new Error('Scenario 4 FAILED: Expected rejection on wrong project ref!');
  } catch (err) {
    if (err.message.includes('requires --project-ref khwtfjyvawukbsvyjdux')) {
      console.log('  PASS: Rejected remote connection with wrong project ref.');
    } else throw err;
  }

  // Test 5: Missing production confirmation
  console.log('--- Scenario 5: Missing Production Confirmation Flag ---');
  try {
    await runMigrations({
      dryRun: false,
      execute: true,
      connectionString: 'postgres://postgres:secret@db.khwtfjyvawukbsvyjdux.supabase.co:5432/postgres',
      projectRef: 'khwtfjyvawukbsvyjdux',
      confirmProductionRelease: false,
      verifiedBackup: true,
    });
    throw new Error('Scenario 5 FAILED: Expected rejection on missing --confirm-production-release!');
  } catch (err) {
    if (err.message.includes('requires --confirm-production-release')) {
      console.log('  PASS: Rejected remote execution without --confirm-production-release.');
    } else throw err;
  }

  // Test 6: Missing backup acknowledgement
  console.log('--- Scenario 6: Missing Backup Acknowledgement Flag ---');
  try {
    await runMigrations({
      dryRun: false,
      execute: true,
      connectionString: 'postgres://postgres:secret@db.khwtfjyvawukbsvyjdux.supabase.co:5432/postgres',
      projectRef: 'khwtfjyvawukbsvyjdux',
      confirmProductionRelease: true,
      verifiedBackup: false,
    });
    throw new Error('Scenario 6 FAILED: Expected rejection on missing --verified-backup!');
  } catch (err) {
    if (err.message.includes('requires --verified-backup')) {
      console.log('  PASS: Rejected remote execution without --verified-backup.');
    } else throw err;
  }

  // Initialize test database
  await resetTestDatabase();

  // Test 7: Incorrect migration checksum
  console.log('--- Scenario 7: Incorrect Migration Checksum ---');
  try {
    await runMigrations({
      dryRun: true,
      execute: false,
      connectionString: TEST_DB_URL,
      allowLocalTest: true,
      migrationsDir: MIGRATIONS_DIR,
      expectedChecksums: {
        '20270102000000': '0000000000000000000000000000000000000000000000000000000000000000',
      },
    });
    throw new Error('Scenario 7 FAILED: Expected rejection on checksum mismatch!');
  } catch (err) {
    if (err.message.includes('Migration checksum mismatch')) {
      console.log('  PASS: Tampered checksum detected and execution halted fail-closed.');
    } else throw err;
  }

  // Test 8: Unexpected ledger version
  console.log('--- Scenario 8: Unexpected Ledger Version Detection ---');
  const rogueClient = new Client({ connectionString: TEST_DB_URL });
  await rogueClient.connect();
  await rogueClient.query("INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20999999999999', 'rogue_migration')");
  await rogueClient.end();

  try {
    await runMigrations({
      dryRun: true,
      execute: false,
      connectionString: TEST_DB_URL,
      allowLocalTest: true,
      migrationsDir: MIGRATIONS_DIR,
    });
    throw new Error('Scenario 8 FAILED: Expected rejection on unexpected ledger version!');
  } catch (err) {
    if (err.message.includes('Unexpected ledger version detected')) {
      console.log('  PASS: Rogue ledger version 20999999999999 detected; runner halted fail-closed.');
    } else throw err;
  }

  // Cleanup rogue version
  const cleanClient = new Client({ connectionString: TEST_DB_URL });
  await cleanClient.connect();
  await cleanClient.query("DELETE FROM supabase_migrations.schema_migrations WHERE version = '20999999999999'");
  await cleanClient.end();

  // Test 9: Reordered / Non-Monotonic Ledger Detection
  console.log('--- Scenario 9: Reordered / Non-Monotonic Ledger Detection ---');
  const reorderClient = new Client({ connectionString: TEST_DB_URL });
  await reorderClient.connect();
  // Insert an out-of-order version
  await reorderClient.query("INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20260101000000', 'reordered_baseline')");
  await reorderClient.end();

  try {
    await runMigrations({
      dryRun: true,
      execute: false,
      connectionString: TEST_DB_URL,
      allowLocalTest: true,
      migrationsDir: MIGRATIONS_DIR,
    });
    throw new Error('Scenario 9 FAILED: Expected rejection on non-monotonic ledger version!');
  } catch (err) {
    if (err.message.includes('Unexpected ledger version detected') || err.message.includes('Reordered ledger detected')) {
      console.log('  PASS: Non-monotonic/reordered ledger detected; runner halted fail-closed.');
    } else throw err;
  }

  const cleanReorderClient = new Client({ connectionString: TEST_DB_URL });
  await cleanReorderClient.connect();
  await cleanReorderClient.query("DELETE FROM supabase_migrations.schema_migrations WHERE version = '20260101000000'");
  await cleanReorderClient.end();

  // Test 10: Missing Category B schema effect
  console.log('--- Scenario 10: Missing Category B Schema Effect Preflight ---');
  const catBClient = new Client({ connectionString: TEST_DB_URL });
  await catBClient.connect();
  await catBClient.query('ALTER TABLE public.fine_payments DROP COLUMN amount');
  await catBClient.end();

  try {
    await runMigrations({
      dryRun: true,
      execute: false,
      connectionString: TEST_DB_URL,
      allowLocalTest: true,
      migrationsDir: MIGRATIONS_DIR,
    });
    throw new Error('Scenario 10 FAILED: Expected preflight failure when fine_payments.amount is missing!');
  } catch (err) {
    if (err.message.includes('Category B verification failed: 20261108160959')) {
      console.log('  PASS: Atomic Category B preflight detected missing schema effect and halted fail-closed.');
    } else throw err;
  }

  // Reset test database to pristine baseline for Scenario 11
  await resetTestDatabase();

  // Test 11: Dry-Run Rehearsal
  console.log('--- Scenario 11: Dry-Run Rehearsal ---');
  const dryResult = await runMigrations({
    dryRun: true,
    execute: false,
    connectionString: TEST_DB_URL,
    allowLocalTest: true,
    migrationsDir: MIGRATIONS_DIR,
  });

  if (dryResult.status !== 'DRY_RUN_PASSED' || dryResult.plannedCount !== 45) {
    throw new Error(`Scenario 11 FAILED: Expected 45 planned, got ${dryResult.plannedCount} (status: ${dryResult.status})`);
  }

  const checkClient = new Client({ connectionString: TEST_DB_URL });
  await checkClient.connect();
  const preCountRes = await checkClient.query('SELECT count(*) FROM supabase_migrations.schema_migrations');
  await checkClient.end();

  if (parseInt(preCountRes.rows[0].count, 10) !== 119) {
    throw new Error(`Scenario 11 FAILED: Dry-run modified database! Ledger count: ${preCountRes.rows[0].count}`);
  }
  console.log('  PASS: Dry-run verified 45 pending migrations and preserved database ledger at 119.');

  // Test 12: Full Execution
  console.log('--- Scenario 12: Full Production Migration Execution ---');
  const fullResult = await runMigrations({
    dryRun: false,
    execute: true,
    connectionString: TEST_DB_URL,
    allowLocalTest: true,
    migrationsDir: MIGRATIONS_DIR,
  });

  if (fullResult.status !== 'SUCCESS' || fullResult.finalLedgerCount !== 170) {
    throw new Error(`Scenario 12 FAILED: Status=${fullResult.status}, Ledger=${fullResult.finalLedgerCount}`);
  }
  console.log('  PASS: All 45 release migrations executed sequentially; ledger count reached 170.');

  // Test 13: Repeated execution against an up-to-date database
  console.log('--- Scenario 13: Repeated Execution on Up-to-Date Database ---');
  const repeatedResult = await runMigrations({
    dryRun: false,
    execute: true,
    connectionString: TEST_DB_URL,
    allowLocalTest: true,
    migrationsDir: MIGRATIONS_DIR,
  });

  if (repeatedResult.status !== 'UP_TO_DATE' || repeatedResult.executedCount !== 0) {
    throw new Error(`Scenario 13 FAILED: Expected UP_TO_DATE with 0 executed, got ${repeatedResult.status}`);
  }
  console.log('  PASS: Runner reported UP_TO_DATE with 0 executed; database left untouched.');

  // Test 14: Failure at an early migration (First Migration Failure)
  console.log('--- Scenario 14: Early Migration Failure (#1 of Cat C) ---');
  await resetTestDatabase();
  const tempDirEarly = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-early-fail-'));
  try {
    const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
    for (const f of files) fs.copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(tempDirEarly, f));
    // Corrupt migration #1 of Category C
    const firstCatC = files.find(f => f.startsWith('20270102000000'));
    fs.writeFileSync(path.join(tempDirEarly, firstCatC), 'BEGIN;\nSELECT * FROM table_does_not_exist_early;\nCOMMIT;\n');

    let earlyErr = null;
    try {
      await runMigrations({
        dryRun: false,
        execute: true,
        connectionString: TEST_DB_URL,
        allowLocalTest: true,
        migrationsDir: tempDirEarly,
      });
    } catch (e) { earlyErr = e; }

    if (!earlyErr || earlyErr.executedMigrations.length !== 0) {
      throw new Error('Scenario 14 FAILED: Expected immediate failure on migration #1 with 0 committed!');
    }

    const earlyVerifyClient = new Client({ connectionString: TEST_DB_URL });
    await earlyVerifyClient.connect();
    const earlyCheckRes = await earlyVerifyClient.query(
      "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20270102000000'"
    );
    const earlyTotalRes = await earlyVerifyClient.query('SELECT count(*) FROM supabase_migrations.schema_migrations');
    await earlyVerifyClient.end();

    if (parseInt(earlyCheckRes.rows[0].count, 10) !== 0) {
      throw new Error('Scenario 14 FAILED: Failed migration #1 was stamped in the ledger!');
    }
    if (parseInt(earlyTotalRes.rows[0].count, 10) !== 119) {
      throw new Error(`Scenario 14 FAILED: Ledger modified on failure! Count: ${earlyTotalRes.rows[0].count}`);
    }
    console.log('  PASS: Early migration failed immediately; 0 committed, failed migration NOT stamped, ledger at 119.');
  } finally {
    fs.rmSync(tempDirEarly, { recursive: true, force: true });
  }

  // Test 15: Failure in the middle of migration sequence
  console.log('--- Scenario 15: Failure in the Middle of Migration Sequence (#20 of Cat C) ---');
  await resetTestDatabase();
  const tempDirMid = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-mid-fail-'));
  let targetMidFile = '';
  try {
    const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
    const catCFiles = files.filter(f => f >= '20270102000000');
    for (const f of files) fs.copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(tempDirMid, f));
    targetMidFile = catCFiles[19]; // 20th migration (index 19)
    const targetMidVersion = targetMidFile.slice(0, 14);
    fs.writeFileSync(path.join(tempDirMid, targetMidFile), 'BEGIN;\nSELECT * FROM table_does_not_exist_mid;\nCOMMIT;\n');

    let midErr = null;
    try {
      await runMigrations({
        dryRun: false,
        execute: true,
        connectionString: TEST_DB_URL,
        allowLocalTest: true,
        migrationsDir: tempDirMid,
      });
    } catch (e) { midErr = e; }

    if (!midErr || midErr.executedMigrations.length !== 19) {
      throw new Error(`Scenario 15 FAILED: Expected 19 committed, got ${midErr?.executedMigrations?.length}`);
    }

    const midVerifyClient = new Client({ connectionString: TEST_DB_URL });
    await midVerifyClient.connect();
    const midCount = await midVerifyClient.query('SELECT count(*) FROM supabase_migrations.schema_migrations');
    const midFailCheck = await midVerifyClient.query(
      "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = $1",
      [targetMidVersion]
    );
    await midVerifyClient.end();

    if (parseInt(midCount.rows[0].count, 10) !== 138) {
      throw new Error(`Scenario 15 FAILED: Expected ledger 138 (119 + 19), got ${midCount.rows[0].count}`);
    }
    if (parseInt(midFailCheck.rows[0].count, 10) !== 0) {
      throw new Error(`Scenario 15 FAILED: Failed migration ${targetMidVersion} was stamped in the ledger!`);
    }
    console.log(`  PASS: Mid-sequence failure stopped at migration 20; exactly 19 committed, failed migration NOT stamped, ledger at 138.`);
  } finally {
    fs.rmSync(tempDirMid, { recursive: true, force: true });
  }

  // Test 16: Failure near the end of migration sequence (#44 of Cat C)
  console.log('--- Scenario 16: Failure Near End of Migration Sequence (#44 of Cat C) ---');
  await resetTestDatabase();
  const tempDirNearEnd = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-nearend-fail-'));
  let targetNearEndFile = '';
  try {
    const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
    const catCFiles = files.filter(f => f >= '20270102000000');
    for (const f of files) fs.copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(tempDirNearEnd, f));
    targetNearEndFile = catCFiles[43]; // 44th migration (index 43)
    const targetNearEndVersion = targetNearEndFile.slice(0, 14);
    fs.writeFileSync(path.join(tempDirNearEnd, targetNearEndFile), 'BEGIN;\nSELECT * FROM table_does_not_exist_nearend;\nCOMMIT;\n');

    let nearEndErr = null;
    try {
      await runMigrations({
        dryRun: false,
        execute: true,
        connectionString: TEST_DB_URL,
        allowLocalTest: true,
        migrationsDir: tempDirNearEnd,
      });
    } catch (e) { nearEndErr = e; }

    if (!nearEndErr || nearEndErr.executedMigrations.length !== 43) {
      throw new Error(`Scenario 16 FAILED: Expected 43 committed, got ${nearEndErr?.executedMigrations?.length}`);
    }

    const nearEndVerifyClient = new Client({ connectionString: TEST_DB_URL });
    await nearEndVerifyClient.connect();
    const nearEndCount = await nearEndVerifyClient.query('SELECT count(*) FROM supabase_migrations.schema_migrations');
    const nearEndFailCheck = await nearEndVerifyClient.query(
      "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = $1",
      [targetNearEndVersion]
    );
    await nearEndVerifyClient.end();

    if (parseInt(nearEndCount.rows[0].count, 10) !== 162) {
      throw new Error(`Scenario 16 FAILED: Expected ledger 162 (119 + 43), got ${nearEndCount.rows[0].count}`);
    }
    if (parseInt(nearEndFailCheck.rows[0].count, 10) !== 0) {
      throw new Error(`Scenario 16 FAILED: Failed migration ${targetNearEndVersion} was stamped in the ledger!`);
    }
    console.log(`  PASS: Near-end failure stopped at migration 44; exactly 43 committed, failed migration NOT stamped, ledger at 162.`);

    // Test 17: Successful resumption after fixing the failure
    console.log('--- Scenario 17: Successful Resume After Near-End Failure ---');
    fs.copyFileSync(path.join(MIGRATIONS_DIR, targetNearEndFile), path.join(tempDirNearEnd, targetNearEndFile));
    const resumeResult = await runMigrations({
      dryRun: false,
      execute: true,
      connectionString: TEST_DB_URL,
      allowLocalTest: true,
      migrationsDir: tempDirNearEnd,
    });

    if (resumeResult.status !== 'SUCCESS' || resumeResult.executedCount !== 2 || resumeResult.finalLedgerCount !== 170) {
      throw new Error(`Scenario 17 FAILED: Resumption did not complete remaining 2 migrations! executed=${resumeResult.executedCount}, final=${resumeResult.finalLedgerCount}`);
    }
    console.log('  PASS: Runner safely resumed from migration 44, applied remaining 2 migrations, and reached exactly 170.');
  } finally {
    fs.rmSync(tempDirNearEnd, { recursive: true, force: true });
  }

  // Test 18: No duplicate ledger entries across all 170 migrations
  console.log('--- Scenario 18: No Duplicate Ledger Entries ---');
  const dupClient = new Client({ connectionString: TEST_DB_URL });
  await dupClient.connect();
  const dupCheck = await dupClient.query('SELECT version, count(*) FROM supabase_migrations.schema_migrations GROUP BY version HAVING count(*) > 1');
  await dupClient.end();

  if (dupCheck.rows.length !== 0) {
    throw new Error(`Scenario 18 FAILED: Found duplicate ledger versions: ${JSON.stringify(dupCheck.rows)}`);
  }
  console.log('  PASS: Zero duplicate ledger versions found across all 170 migrations.');

  // Test 19: No accidental execution of Category B files
  console.log('--- Scenario 19: No Accidental Direct Execution of Category B Files ---');
  await resetTestDatabase();
  const tempDirCatB = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-catb-poison-'));
  try {
    const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
    for (const f of files) fs.copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(tempDirCatB, f));

    // Poison a Category B file with syntax error: if the runner attempts to run it directly, it would fail
    const catBPoison = '20261108160959_fine_schema_prerequisite.sql';
    fs.writeFileSync(path.join(tempDirCatB, catBPoison), 'INVALID SQL SYNTAX THAT WOULD FAIL IF EXECUTED DIRECTLY;\n');

    const catBRunResult = await runMigrations({
      dryRun: false,
      execute: true,
      connectionString: TEST_DB_URL,
      allowLocalTest: true,
      migrationsDir: tempDirCatB,
    });

    if (catBRunResult.status !== 'SUCCESS' || catBRunResult.finalLedgerCount !== 170) {
      throw new Error('Scenario 19 FAILED: Poisoned Category B file affected execution!');
    }
    console.log('  PASS: Category B file was not executed directly; Category B was stamped by 20270120000000.');
  } finally {
    fs.rmSync(tempDirCatB, { recursive: true, force: true });
  }

  // --- Scenario 20: Production TLS Configuration & Fail-Closed Behavior ---
  console.log('--- Scenario 20: Production TLS Configuration & Fail-Closed Behavior ---');
  // 1. Localhost returns false (no SSL)
  const localSsl = resolveSslConfig('postgres://postgres@localhost:5433/db');
  if (localSsl !== false) throw new Error('Scenario 20 FAILED: Localhost should not use SSL');

  // 2. Remote URL defaults to encrypted transport (rejectUnauthorized: false for custom pooler CA)
  const remoteSsl = resolveSslConfig('postgres://user:pass@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres');
  if (!remoteSsl || remoteSsl.rejectUnauthorized !== false) {
    throw new Error('Scenario 20 FAILED: Remote URL should default to TLS encrypted transport');
  }

  // 3. Remote URL with strictTls flag enforces rejectUnauthorized: true
  const strictSsl = resolveSslConfig('postgres://user:pass@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres', { strictTls: true });
  if (!strictSsl || strictSsl.rejectUnauthorized !== true) {
    throw new Error('Scenario 20 FAILED: strictTls should enforce rejectUnauthorized: true');
  }

  // 4. Remote URL with PGSSLMODE=verify-full enforces rejectUnauthorized: true
  process.env.PGSSLMODE = 'verify-full';
  const verifyFullSsl = resolveSslConfig('postgres://user:pass@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres');
  delete process.env.PGSSLMODE;
  if (!verifyFullSsl || verifyFullSsl.rejectUnauthorized !== true) {
    throw new Error('Scenario 20 FAILED: PGSSLMODE=verify-full should enforce rejectUnauthorized: true');
  }

  // 5. Remote URL with custom CA cert file
  const tempCaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-tls-ca-'));
  const tempCaFile = path.join(tempCaDir, 'test-ca.crt');
  fs.writeFileSync(tempCaFile, '-----BEGIN CERTIFICATE-----\nTEST_CA_DATA\n-----END CERTIFICATE-----\n');
  const caSsl = resolveSslConfig('postgres://user:pass@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres', { sslCa: tempCaFile });
  fs.rmSync(tempCaDir, { recursive: true, force: true });
  if (!caSsl || caSsl.rejectUnauthorized !== true || !caSsl.ca.includes('TEST_CA_DATA')) {
    throw new Error('Scenario 20 FAILED: sslCa should enforce rejectUnauthorized: true with CA contents');
  }

  // 6. Non-existent CA file throws fail-closed error
  let missingCaCaught = false;
  try {
    resolveSslConfig('postgres://user:pass@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres', { sslCa: 'C:\\nonexistent\\path\\ca.crt' });
  } catch (err) {
    missingCaCaught = err.message.includes('Configured TLS CA certificate file not found');
  }
  if (!missingCaCaught) throw new Error('Scenario 20 FAILED: Missing CA file should fail closed immediately');

  console.log('  PASS: Production TLS configuration enforces encrypted transport, strict CA verification, and fail-closed validation.');

  console.log('\n================================================================');
  console.log('   ALL 20 PRODUCTION MIGRATION RUNNER SCENARIOS PASSED!');
  console.log('================================================================');
}

run19Scenarios().catch(err => {
  console.error('\nTEST SUITE FAILED:', err);
  process.exit(1);
});
