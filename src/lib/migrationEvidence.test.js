import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileEvidence } from '../../scripts/reconcile-migration-evidence.mjs';

const migrations = [
  { version: '20261001000001', name: 'mfa_prerequisite', file: '20261001000001_mfa_prerequisite.sql', sha256: 'abc' },
  { version: '20261001000002', name: 'superadmin_prerequisite', file: '20261001000002_superadmin_prerequisite.sql', sha256: 'def' },
];

test('migration evidence comparison never infers applied status from matching history and catalog effects', () => {
  const result = reconcileEvidence({
    migrations,
    historyRows: [
      { version: migrations[0].version, name: migrations[0].name },
      { version: migrations[1].version, name: migrations[1].name },
    ],
    catalog: { objects: [{ key: 'function:public.helper()', owner: 'postgres', body: 'reviewed' }] },
    effects: { effects: [{
      version: migrations[0].version,
      objects: [{ key: 'function:public.helper()', expected: { key: 'function:public.helper()', owner: 'postgres', body: 'reviewed' } }],
    }] },
  });
  assert.equal(result.migrations[0].status, 'HISTORY_AND_EFFECTS_MATCH_REVIEW_REQUIRED');
  assert.equal(result.migrations[1].status, 'AMBIGUOUS');
  assert.equal(result.automaticAppliedConclusion, false);
  assert.equal(result.reviewRequired, true);
});

test('migration evidence comparison flags missing or conflicting catalog snapshots', () => {
  const result = reconcileEvidence({
    migrations: migrations.slice(0, 1),
    historyRows: [],
    catalog: { relations: [], functions: [{ key: 'function:public.helper()', owner: 'unexpected' }] },
    effects: { effects: [{
      version: migrations[0].version,
      objects: [{ key: 'function:public.helper()', expected: { key: 'function:public.helper()', owner: 'postgres' } }],
    }] },
  });
  assert.equal(result.migrations[0].status, 'CONFLICT_REVIEW_REQUIRED');
  assert.equal(result.migrations[0].effectChecks[0].status, 'CONFLICT');
});

test('migration evidence comparison marks schema-present/history-absent as manual review', () => {
  const snapshot = { key: 'column:public.visitors.registration_type', type: 'text', notNull: true };
  const result = reconcileEvidence({
    migrations: migrations.slice(0, 1),
    historyRows: [],
    catalog: { relations: [snapshot] },
    effects: { effects: [{ version: migrations[0].version, objects: [{ key: snapshot.key, expected: snapshot }] }] },
  });
  assert.equal(result.migrations[0].status, 'SCHEMA_PRESENT_HISTORY_ABSENT_REVIEW_REQUIRED');
  assert.equal(result.automaticAppliedConclusion, false);
});