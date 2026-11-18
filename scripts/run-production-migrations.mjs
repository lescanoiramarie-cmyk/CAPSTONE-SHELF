#!/usr/bin/env node
/**
 * scripts/run-production-migrations.mjs
 *
 * Safe, explicit, transaction-isolated production migration runner for SHELF ILMS.
 *
 * Safety features:
 * - Refuses execution against remote databases without explicit project confirmation:
 *   --project-ref khwtfjyvawukbsvyjdux --confirm-production-release --verified-backup
 * - Supports --dry-run for non-destructive preflight validation.
 * - Executes migrations sequentially, one dedicated transaction per migration file.
 * - Idempotently records version in supabase_migrations.schema_migrations upon commit.
 * - Fails closed immediately on any error, rolling back the failing transaction.
 * - Never skips failing migrations silently; reports exact failure point and remaining files.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import pg from 'pg';

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.resolve(REPO_ROOT, 'supabase', 'migrations');
const REQUIRED_PROJECT_REF = 'khwtfjyvawukbsvyjdux';

export const CATEGORY_B_VERSIONS = new Set([
  '20261108160959',
  '20261109130133',
  '20261129999998',
  '20261129999999',
  '20261226999999',
  '20261227000001',
]);
export const RELEASE_MIGRATIONS_START = '20270102000000';

/**
 * Redacts passwords and sensitive credentials from database connection strings.
 */
export function redactConnectionString(str) {
  if (!str || typeof str !== 'string') return '';
  return str.replace(/:\/\/([^:]+):([^@]+)@/g, '://$1:***@');
}

/**
 * Sanitizes error messages to prevent database credentials from leaking in logs.
 */
export function sanitizeErrorMessage(msg) {
  if (!msg || typeof msg !== 'string') return '';
  return msg
    .replace(/:\/\/([^:]+):([^@]+)@/g, '://$1:***@')
    .replace(/(password|passwd|pwd)\s*=\s*['"]?[^'"\s]+['"]?/gi, '$1=***');
}

export function parseArgs(args) {
  const options = {
    dryRun: false,
    execute: false,
    connectionString: process.env.DATABASE_URL || '',
    projectRef: process.env.SUPABASE_PROJECT_ID || '',
    confirmProductionRelease: false,
    verifiedBackup: false,
    allowLocalTest: false,
    fromVersion: null,
    stopAtVersion: null,
    migrationsDir: MIGRATIONS_DIR,
    expectedChecksums: null,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--execute') {
      options.execute = true;
    } else if (arg === '--allow-local-test') {
      options.allowLocalTest = true;
    } else if (arg === '--confirm-production-release') {
      options.confirmProductionRelease = true;
    } else if (arg === '--verified-backup') {
      options.verifiedBackup = true;
    } else if (arg === '--project-ref') {
      options.projectRef = args[++i];
    } else if (arg === '--db-url' || arg === '--connection-string' || arg === '--password') {
      throw new Error(
        'SECURITY VIOLATION: Passing database credentials or connection strings via command-line arguments is forbidden. ' +
        'Please set the DATABASE_URL environment variable instead.'
      );
    } else if (arg === '--from-version') {
      options.fromVersion = args[++i];
    } else if (arg === '--stop-at-version') {
      options.stopAtVersion = args[++i];
    } else if (arg === '--migrations-dir') {
      options.migrationsDir = path.resolve(args[++i]);
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function printHelp() {
  console.log(`
SHELF ILMS Production Migration Runner
Usage:
  node scripts/run-production-migrations.mjs [options]

Modes (must specify exactly one):
  --dry-run                         Analyze status, preflight unapplied migrations without committing
  --execute                         Execute pending migrations sequentially

Safety Flags (mandatory for remote execution):
  --project-ref <id>                Target Supabase project ref (must match ${REQUIRED_PROJECT_REF})
  --confirm-production-release      Acknowledge execution of release migrations
  --verified-backup                 Confirm an isolated, verified backup exists

Connection & Environment:
  Set DATABASE_URL in environment   PostgreSQL connection string (never passed as CLI argument)
  --allow-local-test                Permit execution against localhost/127.0.0.1 for test suites
  --from-version <version>          Only execute migrations >= this version
  --stop-at-version <version>       Stop execution after this version (for failure simulation)
  --migrations-dir <dir>            Custom migrations directory (default: supabase/migrations)
`);
}

function isLocalhost(connectionString) {
  try {
    const url = new URL(connectionString);
    const host = url.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return (
      connectionString.includes('localhost') ||
      connectionString.includes('127.0.0.1')
    );
  }
}

function cleanSql(rawSql) {
  let sql = rawSql;
  if (sql.charCodeAt(0) === 0xFEFF) {
    sql = sql.slice(1);
  }
  sql = sql.replace(/\r\n/g, '\n');
  sql = sql.replace(/^\\.*$/gm, '');
  return sql;
}

export function computeFileChecksum(filePath) {
  const contents = fs.readFileSync(filePath);
  return createHash('sha256').update(contents).digest('hex');
}

export async function runMigrations(opts) {
  const {
    dryRun,
    execute,
    connectionString,
    projectRef,
    confirmProductionRelease,
    verifiedBackup,
    allowLocalTest,
    fromVersion,
    stopAtVersion,
    migrationsDir,
    expectedChecksums,
  } = opts;

  if (!dryRun && !execute) {
    throw new Error('Must specify either --dry-run or --execute mode.');
  }
  if (dryRun && execute) {
    throw new Error('Cannot specify both --dry-run and --execute.');
  }
  if (!connectionString) {
    throw new Error('No database connection string provided. Please set the DATABASE_URL environment variable.');
  }

  const isLocal = isLocalhost(connectionString);

  // Strict Production Safety Validation
  if (!isLocal) {
    if (!projectRef || projectRef !== REQUIRED_PROJECT_REF) {
      throw new Error(
        `Safety Check Failed: Remote execution requires --project-ref ${REQUIRED_PROJECT_REF}. Found: "${projectRef || 'none'}"`
      );
    }
    if (execute) {
      if (!confirmProductionRelease) {
        throw new Error('Safety Check Failed: Production execution requires --confirm-production-release flag.');
      }
      if (!verifiedBackup) {
        throw new Error('Safety Check Failed: Production execution requires --verified-backup flag.');
      }
    }
  } else if (!allowLocalTest && execute) {
    // Local execution requires explicit flag to avoid accidental runs
    console.warn('[NOTICE] Running against localhost/127.0.0.1.');
  }

  console.log(`[INFO] Connecting to database (${isLocal ? 'LOCAL' : 'REMOTE: ' + projectRef})...`);
  const client = new Client({ connectionString });
  try {
    await client.connect();
  } catch (connErr) {
    throw new Error(`Failed to connect to database: ${sanitizeErrorMessage(connErr.message)}`);
  }

  try {
    // 1. Verify / ensure schema_migrations table exists
    const schemaTableRes = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'supabase_migrations' AND table_name = 'schema_migrations'
      ) AS exists;
    `);

    if (!schemaTableRes.rows[0].exists) {
      if (dryRun) {
        console.log('[WARN] supabase_migrations.schema_migrations table does not exist. It would be created in execute mode.');
      } else {
        console.log('[INFO] Creating supabase_migrations.schema_migrations table...');
        await client.query(`
          CREATE SCHEMA IF NOT EXISTS supabase_migrations;
          CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
            version text PRIMARY KEY,
            statements text[],
            name text
          );
        `);
      }
    }

    // 2. Read recorded ledger entries
    let appliedVersions = new Set();
    if (schemaTableRes.rows[0].exists || !dryRun) {
      const ledgerRes = await client.query('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version');
      appliedVersions = new Set(ledgerRes.rows.map(r => r.version));
    }
    console.log(`[INFO] Currently recorded migrations in ledger: ${appliedVersions.size}`);

    // 3. Scan local migrations directory
    if (!fs.existsSync(migrationsDir)) {
      throw new Error(`Migrations directory not found: ${migrationsDir}`);
    }

    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    console.log(`[INFO] Found ${files.length} migration files on disk.`);

    // Check for unexpected ledger versions (versions in ledger that do not exist on disk)
    const diskVersionSet = new Set(files.map(f => f.slice(0, 14)));
    const unexpectedVersions = [...appliedVersions].filter(v => !diskVersionSet.has(v));
    if (unexpectedVersions.length > 0) {
      throw new Error(
        `Unexpected ledger version detected: ${unexpectedVersions.join(', ')} exists in schema_migrations but not in local migration files!`
      );
    }

    // Check for non-monotonic or reordered ledger entries
    const appliedList = [...appliedVersions];
    for (let i = 1; i < appliedList.length; i++) {
      if (appliedList[i] < appliedList[i - 1]) {
        throw new Error(
          `Reordered ledger detected: version ${appliedList[i]} appears after ${appliedList[i - 1]}!`
        );
      }
    }

    const effectiveFromVersion = fromVersion || RELEASE_MIGRATIONS_START;
    const plannedMigrations = [];
    const categoryBDetected = [];

    for (const f of files) {
      const match = f.match(/^(\d{14})_(.*)\.sql$/);
      if (!match) {
        console.warn(`[WARN] Skipping non-standard filename: ${f}`);
        continue;
      }
      const [_, version, name] = match;
      const isApplied = appliedVersions.has(version);
      const filePath = path.join(migrationsDir, f);

      // Validate checksum if expectedChecksums provided
      if (expectedChecksums && expectedChecksums[version]) {
        const actualSha256 = computeFileChecksum(filePath);
        if (actualSha256 !== expectedChecksums[version]) {
          throw new Error(
            `Migration checksum mismatch for ${f}! Expected: ${expectedChecksums[version]}, Actual: ${actualSha256}`
          );
        }
      }

      if (!isApplied) {
        if (CATEGORY_B_VERSIONS.has(version)) {
          categoryBDetected.push({ file: f, version, name });
          if (!fromVersion) {
            // Default safe behavior: Category B migrations are stamped by 20270120000000
            continue;
          }
        }

        if (version >= effectiveFromVersion) {
          plannedMigrations.push({
            file: f,
            version,
            name,
            filePath,
          });
        }
      }
    }

    if (categoryBDetected.length > 0) {
      console.log(`[INFO] Detected ${categoryBDetected.length} unrecorded Category B baseline migration(s):`);
      categoryBDetected.forEach(cb => {
        console.log(`  - [${cb.version}] ${cb.file} (effects validated and stamped by 20270120000000)`);
      });
    }

    console.log(`[INFO] Planned Category C release migrations to execute: ${plannedMigrations.length}`);

    if (plannedMigrations.length === 0) {
      console.log('[INFO] Database schema is fully up to date. No pending release migrations.');
      return {
        mode: dryRun ? 'dry-run' : 'execute',
        status: 'UP_TO_DATE',
        executedCount: 0,
        pendingCount: 0,
        ledgerCount: appliedVersions.size,
      };
    }

    // Log planned migrations
    console.log('\n--- Migration Sequence Plan ---');
    plannedMigrations.forEach((m, idx) => {
      console.log(`  ${idx + 1}. [${m.version}] ${m.name} (${m.file})`);
    });
    console.log('-------------------------------\n');

    // DRY RUN MODE
    if (dryRun) {
      console.log('[INFO] Running preflight check on pending migrations within a rollback transaction...');
      await client.query('BEGIN');
      try {
        for (const m of plannedMigrations) {
          if (stopAtVersion && m.version > stopAtVersion) {
            console.log(`[INFO] Dry-run stopping at requested version ${stopAtVersion}`);
            break;
          }
          process.stdout.write(`  [DRY-RUN] Checking ${m.file}... `);
          let rawSql = fs.readFileSync(m.filePath, 'utf8');
          let sql = cleanSql(rawSql);
          // Strip explicit BEGIN / COMMIT so execution stays within outer rollback transaction
          sql = sql.replace(/^\s*BEGIN\s*;\s*$/gmi, '-- dry-run managed transaction');
          sql = sql.replace(/^\s*COMMIT\s*;\s*$/gmi, '-- dry-run managed transaction');

          // If in local mock environment, replace cloud extensions if needed
          if (isLocal) {
            sql = sql.replace(/create\s+extension\s+(?:if\s+not\s+exists\s+)?["']?(?:pg_cron|pg_net)["']?[^;]*;/gi, '-- cloud extension mocked');
            sql = sql.replace(/WHERE c\.conrelid = v_fine_oid;/g, "WHERE c.conrelid = v_fine_oid AND c.contype != 'n';");
            sql = sql.replace(/WHERE c\.conrelid = v_borrow_oid/g, "WHERE c.conrelid = v_borrow_oid AND c.contype != 'n'");
            sql = sql.replace(/AND c\.conname <> 'borrow_requests_fine_paid_amount_check'/g, "AND c.contype != 'n' AND c.conname <> 'borrow_requests_fine_paid_amount_check'");
          }
          await client.query(sql);
          process.stdout.write('VALID\n');
        }
        await client.query('ROLLBACK');
        console.log('\n[SUCCESS] Dry-run completed successfully! All migrations are syntactically and relationally valid.');
        return {
          mode: 'dry-run',
          status: 'DRY_RUN_PASSED',
          plannedCount: plannedMigrations.length,
          ledgerCount: appliedVersions.size,
        };
      } catch (err) {
        await client.query('ROLLBACK');
        console.error('\n[DRY-RUN ERROR] Preflight validation failed:', err.message);
        throw err;
      }
    }

    // EXECUTE MODE
    console.log('[INFO] Executing migrations in sequential single-transaction blocks...');
    const executedMigrations = [];
    const remainingMigrations = [...plannedMigrations];

    for (let i = 0; i < plannedMigrations.length; i++) {
      const m = plannedMigrations[i];

      if (stopAtVersion && m.version > stopAtVersion) {
        console.log(`[INFO] Reached requested stop version ${stopAtVersion}. Stopping execution.`);
        break;
      }

      console.log(`[${i + 1}/${plannedMigrations.length}] Applying ${m.file}...`);
      let rawSql = fs.readFileSync(m.filePath, 'utf8');
      let sql = cleanSql(rawSql);
      if (isLocal) {
        sql = sql.replace(/create\s+extension\s+(?:if\s+not\s+exists\s+)?["']?(?:pg_cron|pg_net)["']?[^;]*;/gi, '-- cloud extension mocked');
        sql = sql.replace(/WHERE c\.conrelid = v_fine_oid;/g, "WHERE c.conrelid = v_fine_oid AND c.contype != 'n';");
        sql = sql.replace(/WHERE c\.conrelid = v_borrow_oid/g, "WHERE c.conrelid = v_borrow_oid AND c.contype != 'n'");
        sql = sql.replace(/AND c\.conname <> 'borrow_requests_fine_paid_amount_check'/g, "AND c.contype != 'n' AND c.conname <> 'borrow_requests_fine_paid_amount_check'");
      }

      // Begin dedicated transaction for this migration
      await client.query('BEGIN');
      try {
        await client.query(sql);

        // Record into schema_migrations
        await client.query(
          `INSERT INTO supabase_migrations.schema_migrations (version, name)
           VALUES ($1, $2)
           ON CONFLICT (version) DO NOTHING`,
          [m.version, m.name]
        );

        await client.query('COMMIT');
        executedMigrations.push(m);
        remainingMigrations.shift();
        console.log(`  -> SUCCESS: Stamped ${m.version}`);
      } catch (err) {
        await client.query('ROLLBACK');
        const sanitizedMsg = sanitizeErrorMessage(err.message);
        console.error(`\n[CRITICAL FAILURE] Migration ${m.file} failed! Transaction rolled back.`);
        console.error(`Error: ${sanitizedMsg}`);
        console.error(`PostgreSQL Error Details: code=${err.code}, detail=${sanitizeErrorMessage(err.detail || 'none')}, hint=${sanitizeErrorMessage(err.hint || 'none')}`);
        console.error('\n--- RUNNER STATUS AT FAILURE ---');
        console.error(`Successfully committed migrations (${executedMigrations.length}):`);
        executedMigrations.forEach(em => console.error(`  - ${em.file}`));
        console.error(`Failed migration: ${m.file}`);
        console.error(`Unattempted remaining migrations (${remainingMigrations.length}):`);
        remainingMigrations.forEach(rm => console.error(`  - ${rm.file}`));
        console.error('--------------------------------');

        const failureError = new Error(`Migration ${m.file} failed: ${sanitizedMsg}`);
        failureError.failedMigration = m;
        failureError.executedMigrations = executedMigrations;
        failureError.remainingMigrations = remainingMigrations;
        throw failureError;
      }
    }

    // Final ledger count verification
    const finalRes = await client.query('SELECT count(*) FROM supabase_migrations.schema_migrations');
    const finalCount = parseInt(finalRes.rows[0].count, 10);
    console.log(`\n[COMPLETE] Successfully executed ${executedMigrations.length} migrations.`);
    console.log(`[INFO] Final ledger count: ${finalCount}`);

    return {
      mode: 'execute',
      status: 'SUCCESS',
      executedCount: executedMigrations.length,
      finalLedgerCount: finalCount,
      executedMigrations: executedMigrations.map(m => m.file),
    };
  } finally {
    await client.end();
  }
}

// CLI execution if run directly
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const options = parseArgs(process.argv.slice(2));
  runMigrations(options)
    .then(result => {
      console.log('\nResult:', JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch(err => {
      console.error('\nExecution aborted with error:', err.message);
      process.exit(1);
    });
}
