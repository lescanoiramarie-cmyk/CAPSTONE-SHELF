import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  buildMigrationManifest,
  compareMigrationHistory,
  parseHistoryText,
} from '../../scripts/validate-migrations.mjs';

test('migration manifest validates ascending filenames and hashes exact file bytes', () => {
  const content = 'select 1;\n';
  const { migrations, errors } = buildMigrationManifest([
    { file: '20261001000001_first.sql', contents: content },
    { file: '20261001000002_second.sql', contents: Buffer.from('select 2;\n') },
  ]);
  assert.deepEqual(errors, []);
  assert.equal(migrations[0].sha256, createHash('sha256').update(content).digest('hex'));
  assert.deepEqual(migrations.map(({ version }) => version), ['20261001000001', '20261001000002']);
});

test('migration manifest reports malformed filenames, duplicate versions, and unordered input', () => {
  const { errors } = buildMigrationManifest([
    { file: '20261001000002_later.sql', contents: '' },
    { file: '20261001000002_duplicate.sql', contents: '' },
    { file: 'bad_name.sql', contents: '' },
    { file: '20261001000001_earlier.sql', contents: '' },
  ]);
  assert.deepEqual(errors.map(({ kind }) => kind), [
    'duplicate_version',
    'invalid_filename',
    'not_ascending',
  ]);
});

test('migration history comparison reports local-only, remote-only, duplicate, and name mismatch states', () => {
  const migrations = [
    { version: '20261001000001', name: 'first' },
    { version: '20261001000002', name: 'second' },
  ];
  const comparison = compareMigrationHistory(migrations, [
    { version: '20261001000001', name: 'renamed' },
    { version: '20261001000003', name: 'remote_only' },
    { version: '20261001000003', name: 'duplicate' },
    { version: 'not-a-version', name: '' },
  ]);
  assert.deepEqual(comparison.localOnly, ['20261001000002']);
  assert.deepEqual(comparison.historyOnly, ['20261001000003']);
  assert.deepEqual(comparison.nameMismatches, [
    { version: '20261001000001', local: 'first', history: 'renamed' },
  ]);
  assert.deepEqual(comparison.errors.map(({ kind }) => kind), [
    'duplicate_history_version',
    'invalid_history_version',
  ]);
});

test('migration history parser accepts CSV exports and plain version lists', () => {
  assert.deepEqual(parseHistoryText('version,name\n20261001000001,first\n'), [
    { version: '20261001000001', name: 'first', line: 2 },
  ]);
  assert.deepEqual(parseHistoryText('# exported versions\n20261001000001\n'), [
    { version: '20261001000001', name: '', line: 1 },
  ]);
});