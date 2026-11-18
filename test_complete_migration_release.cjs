const fs = require('fs');
const path = require('path');
const pg = require('./node_modules/pg');

const { Client } = pg;
const MIGRATIONS_DIR = path.resolve(__dirname, 'supabase', 'migrations');

const CATEGORY_B_VERSIONS = [
  '20261108160959',
  '20261109130133',
  '20261129999998',
  '20261129999999',
  '20261226999999',
  '20261227000001',
];
const UNAPPLIED_START = '20270102000000';

async function setupBaseRolesAndSchemas(client) {
  await client.query('CREATE SCHEMA IF NOT EXISTS extensions');
  await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions');
  await client.query(`
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
}

async function executeSqlFile(client, filePath) {
  let sql = fs.readFileSync(filePath, 'utf8');
  if (sql.charCodeAt(0) === 0xFEFF) {
    sql = sql.slice(1);
  }
  sql = sql.replace(/\r\n/g, '\n');
  sql = sql.replace(/^\\.*$/gm, '');
  // Cloud extensions mock
  sql = sql.replace(/create\s+extension\s+(?:if\s+not\s+exists\s+)?["']?(?:pg_cron|pg_net)["']?[^;]*;/gi, '-- cloud extension mocked');
  // PG 18 compatibility for contype != 'n' in constraint check queries
  sql = sql.replace(/WHERE c\.conrelid = v_fine_oid;/g, "WHERE c.conrelid = v_fine_oid AND c.contype != 'n';");
  sql = sql.replace(/WHERE c\.conrelid = v_borrow_oid/g, "WHERE c.conrelid = v_borrow_oid AND c.contype != 'n'");
  sql = sql.replace(/AND c\.conname <> 'borrow_requests_fine_paid_amount_check'/g, "AND c.contype != 'n' AND c.conname <> 'borrow_requests_fine_paid_amount_check'");

  await client.query(sql);
}

async function run() {
  console.log('=== SHELF ILMS: COMPLETE MIGRATION RELEASE TEST ===');
  const adminClient = new Client({
    host: '127.0.0.1',
    port: 5433,
    user: 'postgres',
    database: 'postgres',
  });
  await adminClient.connect();

  console.log('Creating clean isolated test database: shelf_release_test...');
  await adminClient.query('DROP DATABASE IF EXISTS shelf_release_test WITH (FORCE)');
  await adminClient.query('CREATE DATABASE shelf_release_test');
  await adminClient.end();

  const client = new Client({
    host: '127.0.0.1',
    port: 5433,
    user: 'postgres',
    database: 'shelf_release_test',
  });
  await client.connect();
  await setupBaseRolesAndSchemas(client);

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  console.log(`Found ${files.length} migration files in repository.`);

  // Stage 1: Apply all baseline migrations in chronological order (< 20270102000000)
  console.log('\n--- Stage 1: Applying 125 baseline migrations in chronological order ---');
  let catACount = 0;
  let catBCount = 0;
  for (const f of files) {
    const version = f.slice(0, 14);
    if (version < UNAPPLIED_START) {
      await executeSqlFile(client, path.join(MIGRATIONS_DIR, f));
      if (CATEGORY_B_VERSIONS.includes(version)) {
        catBCount++;
        // Do NOT insert into ledger (simulating missing ledger entry)
      } else {
        await client.query(
          'INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [version, f.slice(15, -4)]
        );
        catACount++;
      }
    }
  }
  console.log(`Applied ${catACount} Category A migrations (recorded) and ${catBCount} Category B migrations (unrecorded in ledger).`);

  // Align with reviewed production catalog state where capture_shelf_audit_event was granted to service_role
  await client.query('GRANT EXECUTE ON FUNCTION public.capture_shelf_audit_event() TO service_role');

  const preLedgerRes = await client.query('SELECT count(*) FROM supabase_migrations.schema_migrations');
  console.log(`Pre-release ledger count (must be 119): ${preLedgerRes.rows[0].count}`);
  if (parseInt(preLedgerRes.rows[0].count, 10) !== 119) {
    throw new Error(`Pre-release ledger count mismatch! Expected 119, got ${preLedgerRes.rows[0].count}`);
  }

  // Stage 3: Execute the 45 unapplied Category C migrations sequentially
  console.log('\n--- Stage 3: Executing 45 unapplied migrations sequentially (20270102000000 - 20270120000000) ---');
  let catCCount = 0;
  for (const f of files) {
    const version = f.slice(0, 14);
    if (version >= UNAPPLIED_START) {
      process.stdout.write(`  Executing ${f}... `);
      await executeSqlFile(client, path.join(MIGRATIONS_DIR, f));
      await client.query(
        'INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [version, f.slice(15, -4)]
      );
      catCCount++;
      process.stdout.write('OK\n');
    }
  }
  console.log(`Executed all ${catCCount} unapplied migrations.`);

  // Stage 4: Verify ledger count and schema objects
  console.log('\n--- Stage 4: Verifying final database state and ledger count ---');
  const postLedgerRes = await client.query('SELECT count(*) FROM supabase_migrations.schema_migrations');
  console.log(`Final ledger count (must be 170): ${postLedgerRes.rows[0].count}`);
  if (parseInt(postLedgerRes.rows[0].count, 10) !== 170) {
    throw new Error(`Final ledger count mismatch! Expected 170, got ${postLedgerRes.rows[0].count}`);
  }

  // Check Category B versions in ledger
  const catBCheck = await client.query(
    'SELECT version FROM supabase_migrations.schema_migrations WHERE version = ANY($1::text[])',
    [CATEGORY_B_VERSIONS]
  );
  console.log(`Category B versions stamped in ledger (must be 6): ${catBCheck.rows.length}`);
  if (catBCheck.rows.length !== 6) {
    throw new Error(`Category B stamp count mismatch! Expected 6, got ${catBCheck.rows.length}`);
  }

  // Check specific objects
  const callNumCheck = await client.query(
    "SELECT data_type FROM information_schema.columns WHERE table_name = 'books' AND column_name = 'call_number'"
  );
  console.log(`books.call_number data_type: ${callNumCheck.rows[0]?.data_type} (must be text)`);
  if (callNumCheck.rows[0]?.data_type !== 'text') {
    throw new Error('books.call_number missing or not text!');
  }

  const notifRefCheck = await client.query(
    "SELECT data_type FROM information_schema.columns WHERE table_name = 'visitor_notifications' AND column_name = 'reference_id'"
  );
  console.log(`visitor_notifications.reference_id data_type: ${notifRefCheck.rows[0]?.data_type} (must be text)`);
  if (notifRefCheck.rows[0]?.data_type !== 'text') {
    throw new Error('visitor_notifications.reference_id missing or not text!');
  }

  const opacCountCheck = await client.query(
    "SELECT proname FROM pg_proc WHERE proname = 'get_opac_total_book_count'"
  );
  console.log(`get_opac_total_book_count RPC exists: ${opacCountCheck.rows.length > 0}`);
  if (opacCountCheck.rows.length === 0) {
    throw new Error('get_opac_total_book_count missing!');
  }

  // Verify custom trim was dropped
  const trimCheck = await client.query(
    "SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'pg_catalog' AND p.proname = 'trim' AND p.pronargs = 1"
  );
  console.log(`Custom pg_catalog.trim exists: ${trimCheck.rows.length > 0} (must be false)`);
  if (trimCheck.rows.length > 0) {
    throw new Error('Custom pg_catalog.trim still exists in pg_catalog!');
  }

  // Idempotency check: re-run 20270120000000
  console.log('\n--- Stage 5: Idempotency verification (re-running 20270120000000) ---');
  await executeSqlFile(client, path.join(MIGRATIONS_DIR, '20270120000000_release_reconciliation.sql'));
  const idempotencyLedger = await client.query('SELECT count(*) FROM supabase_migrations.schema_migrations');
  console.log(`Idempotent re-run ledger count: ${idempotencyLedger.rows[0].count} (must remain 170)`);
  if (parseInt(idempotencyLedger.rows[0].count, 10) !== 170) {
    throw new Error('Re-running release reconciliation altered ledger count!');
  }

  // Stage 6: Negative tests for Category B fail-closed preflights
  console.log('\n--- Stage 6: Category B fail-closed negative tests ---');
  const reconSql = fs.readFileSync(path.join(MIGRATIONS_DIR, '20270120000000_release_reconciliation.sql'), 'utf8');

  // Negative Test 1: Drop fine_payments.amount column
  await client.query('BEGIN');
  await client.query('ALTER TABLE public.fine_payments DROP COLUMN amount');
  try {
    await client.query(reconSql);
    throw new Error('Negative Test 1 FAILED: Expected preflight exception on missing fine_payments.amount, but none raised!');
  } catch (err) {
    if (err.message.includes('Category B verification failed: 20261108160959')) {
      console.log('  Negative Test 1 PASS: Dropping fine_payments.amount triggered fail-closed exception for 20261108160959.');
    } else {
      throw err;
    }
  }
  await client.query('ROLLBACK');

  // Negative Test 2: Drop trigger set_borrow_request_library_id
  await client.query('BEGIN');
  await client.query('DROP TRIGGER set_borrow_request_library_id ON public.borrow_requests');
  try {
    await client.query(reconSql);
    throw new Error('Negative Test 2 FAILED: Expected preflight exception on missing trigger, but none raised!');
  } catch (err) {
    if (err.message.includes('Category B verification failed: 20261109130133')) {
      console.log('  Negative Test 2 PASS: Dropping trigger triggered fail-closed exception for 20261109130133.');
    } else {
      throw err;
    }
  }
  await client.query('ROLLBACK');

  // Negative Test 3: Drop community_book_requests.fine_review_required
  await client.query('BEGIN');
  await client.query('ALTER TABLE public.community_book_requests DROP COLUMN fine_review_required');
  try {
    await client.query(reconSql);
    throw new Error('Negative Test 3 FAILED: Expected preflight exception on missing column, but none raised!');
  } catch (err) {
    if (err.message.includes('Category B verification failed: 20261129999998')) {
      console.log('  Negative Test 3 PASS: Dropping fine_review_required triggered fail-closed exception for 20261129999998.');
    } else {
      throw err;
    }
  }
  await client.query('ROLLBACK');

  // Negative Test 4: Delete ledger entry 20261130000000
  await client.query('BEGIN');
  await client.query("DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261130000000'");
  try {
    await client.query(reconSql);
    throw new Error('Negative Test 4 FAILED: Expected preflight exception on missing ledger 20261130000000, but none raised!');
  } catch (err) {
    if (err.message.includes('Category B verification failed: 20261129999999')) {
      console.log('  Negative Test 4 PASS: Missing 20261130000000 triggered fail-closed exception for 20261129999999.');
    } else {
      throw err;
    }
  }
  await client.query('ROLLBACK');

  // Negative Test 5: Delete ledger entry 20261227000000
  await client.query('BEGIN');
  await client.query("DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261227000000'");
  try {
    await client.query(reconSql);
    throw new Error('Negative Test 5 FAILED: Expected preflight exception on missing ledger 20261227000000, but none raised!');
  } catch (err) {
    if (err.message.includes('Category B verification failed: 20261226999999')) {
      console.log('  Negative Test 5 PASS: Missing 20261227000000 triggered fail-closed exception for 20261226999999.');
    } else {
      throw err;
    }
  }
  await client.query('ROLLBACK');

  // Negative Test 6: Drop alerted_today from get_fine_payment_alert_targets
  await client.query('BEGIN');
  await client.query('DROP FUNCTION public.get_fine_payment_alert_targets(text)');
  await client.query(`
    CREATE FUNCTION public.get_fine_payment_alert_targets(p_library_id text DEFAULT NULL)
    RETURNS TABLE(request_id text, visitor_id text)
    LANGUAGE plpgsql SECURITY DEFINER AS 'BEGIN RETURN QUERY SELECT NULL::text, NULL::text; END;';
  `);
  try {
    await client.query(reconSql);
    throw new Error('Negative Test 6 FAILED: Expected preflight exception on missing alerted_today, but none raised!');
  } catch (err) {
    if (err.message.includes('Category B verification failed: 20261227000001')) {
      console.log('  Negative Test 6 PASS: Missing alerted_today signature triggered fail-closed exception for 20261227000001.');
    } else {
      throw err;
    }
  }
  await client.query('ROLLBACK');

  // Negative Test 7: Grant EXECUTE on set_borrow_request_library_id() to anon
  await client.query('BEGIN');
  await client.query('GRANT EXECUTE ON FUNCTION public.set_borrow_request_library_id() TO anon');
  try {
    await client.query(reconSql);
    throw new Error('Negative Test 7 FAILED: Expected preflight exception on anon grant, but none raised!');
  } catch (err) {
    if (err.message.includes('Category B verification failed: 20261109130133')) {
      console.log('  Negative Test 7 PASS: anon grant triggered fail-closed exception for 20261109130133.');
    } else {
      throw err;
    }
  }
  await client.query('ROLLBACK');

  // Negative Test 8: Drop borrow_requests_fine_paid_amount_check
  await client.query('BEGIN');
  await client.query('ALTER TABLE public.borrow_requests DROP CONSTRAINT borrow_requests_fine_paid_amount_check');
  try {
    await client.query(reconSql);
    throw new Error('Negative Test 8 FAILED: Expected preflight exception on missing constraint, but none raised!');
  } catch (err) {
    if (err.message.includes('Category B verification failed: 20261108160959')) {
      console.log('  Negative Test 8 PASS: Dropping borrow_requests check constraint triggered fail-closed exception for 20261108160959.');
    } else {
      throw err;
    }
  }
  await client.query('ROLLBACK');

  // Negative Test 9: Drop index fine_payments_request_received_idx
  await client.query('BEGIN');
  await client.query('DROP INDEX public.fine_payments_request_received_idx');
  try {
    await client.query(reconSql);
    throw new Error('Negative Test 9 FAILED: Expected preflight exception on missing index, but none raised!');
  } catch (err) {
    if (err.message.includes('Category B verification failed: 20261108160959')) {
      console.log('  Negative Test 9 PASS: Dropping fine_payments index triggered fail-closed exception for 20261108160959.');
    } else {
      throw err;
    }
  }
  await client.query('ROLLBACK');

  // Negative Test 10: Grant SELECT on fine_payments to authenticated
  await client.query('BEGIN');
  await client.query('GRANT SELECT ON TABLE public.fine_payments TO authenticated');
  try {
    await client.query(reconSql);
    throw new Error('Negative Test 10 FAILED: Expected preflight exception on authenticated privilege, but none raised!');
  } catch (err) {
    if (err.message.includes('Category B verification failed: 20261108160959')) {
      console.log('  Negative Test 10 PASS: Permissive table grant triggered fail-closed exception for 20261108160959.');
    } else {
      throw err;
    }
  }
  await client.query('ROLLBACK');

  await client.end();
  console.log('\nALL 170 MIGRATION REPLAY AND 10/10 NEGATIVE TESTS PASSED SUCCESSFULLY!');
}

run().catch(err => {
  console.error('\nTEST FAILED:', err);
  process.exit(1);
});
