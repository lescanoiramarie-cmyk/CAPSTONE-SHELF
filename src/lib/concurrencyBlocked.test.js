import test from 'node:test';
import process from 'node:process';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const scenarios = [
  ['two visitors borrowing final copy', 1],
  ['two simultaneous pickup confirmations', 2],
  ['two simultaneous return confirmations', 3],
  ['overlapping fine payments cannot exceed balance', 4],
  ['two simultaneous attendance check-ins', 5],
  ['duplicate notification retry', 6],
  ['cross-visitor borrow isolation', 7],
  ['cross-library staff isolation', 8],
  ['full payment preserves return status and ledger history', 9],
  ['duplicate fine-payment retry is idempotent', 10],
  ['invalid fine-payment method is rejected', 11],
  ['inactive staff cannot record a fine payment', 12],
  ['cross-library staff cannot record a fine payment', 13],
];
const localDbConfigured = process.env.SHELF_TEST_LOCAL_SUPABASE === '1';

for (const [name, scenarioId] of scenarios) {
  test(`concurrency: ${name}`, { skip: !localDbConfigured && 'set SHELF_TEST_LOCAL_SUPABASE=1 after supabase db reset --local' }, () => {
    const result = spawnSync(process.execPath, ['scripts/concurrency-harness.mjs'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        PGHOST: process.env.PGHOST ?? '127.0.0.1',
        PGPORT: process.env.PGPORT ?? '54322',
        PGDATABASE: process.env.PGDATABASE ?? 'postgres',
        PGUSER: process.env.PGUSER ?? 'postgres',
        PGPASSWORD: process.env.PGPASSWORD ?? 'postgres',
        TEST_ONLY: String(scenarioId),
      },
      timeout: 60_000,
      windowsHide: true,
    });
    assert.equal(result.error, undefined, `scenario ${scenarioId} runner error: ${result.error?.message}`);
    assert.equal(result.status, 0, `scenario ${scenarioId} failed:\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, new RegExp(`Test ${scenarioId}:`));
    assert.match(result.stdout, /Failed: 0/);
  });
}
