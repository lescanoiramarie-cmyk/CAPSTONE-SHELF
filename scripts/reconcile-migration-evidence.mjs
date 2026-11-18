#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildMigrationManifest, compareMigrationHistory } from './validate-migrations.mjs';

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (name === '--help' || name === '-h') options.help = true;
    else if (['--history', '--catalog', '--effects', '--migrations', '--out'].includes(name)) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${name} requires a path.`);
      options[name.slice(2)] = value;
      index += 1;
    } else throw new Error(`Unknown argument: ${name}`);
  }
  return options;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizeHistory(exportValue) {
  const rows = Array.isArray(exportValue)
    ? exportValue
    : exportValue.migrationHistory ?? exportValue.migrations;
  if (!Array.isArray(rows)) throw new Error('History export must contain migrationHistory or migrations array.');
  return rows.map((row) => ({
    version: String(row.version ?? '').trim(),
    name: String(row.name ?? '').trim(),
    ...(row.sha256 ? { sha256: String(row.sha256).toLowerCase() } : {}),
  }));
}

export function reconcileEvidence({ migrations, historyRows, catalog, effects }) {
  const history = compareMigrationHistory(migrations, historyRows);
  const historyByVersion = new Map(historyRows.map((row) => [row.version, row]));
  const catalogObjects = catalog.objects ?? [
    'relations', 'constraints', 'indexes', 'policies', 'triggers', 'functions',
  ].flatMap((section) => catalog[section] ?? []);
  if (!Array.isArray(catalogObjects)) throw new Error('Catalog export objects must be arrays.');
  const catalogByKey = new Map();
  const duplicateCatalogKeys = [];
  for (const object of catalogObjects) {
    if (!object || typeof object.key !== 'string' || !object.key) {
      throw new Error('Every catalog object needs a non-empty key.');
    }
    if (catalogByKey.has(object.key)) duplicateCatalogKeys.push(object.key);
    else catalogByKey.set(object.key, object);
  }
  if (!Array.isArray(effects.effects)) throw new Error('Reviewed effects file must contain an effects array.');
  const effectsByVersion = new Map(effects.effects.map((entry) => [String(entry.version), entry]));
  const rows = migrations.map((migration) => {
    const historyRow = historyByVersion.get(migration.version);
    const reviewed = effectsByVersion.get(migration.version);
    const effectChecks = [];
    if (!reviewed || !Array.isArray(reviewed.objects) || reviewed.objects.length === 0) {
      effectChecks.push({ status: 'AMBIGUOUS', reason: 'No owner-reviewed expected catalog effects supplied.' });
    } else {
      for (const expected of reviewed.objects) {
        const actual = catalogByKey.get(expected.key);
        if (!actual) {
          effectChecks.push({ key: expected.key, status: 'CONFLICT', reason: 'Expected catalog object is absent.' });
        } else if (!Object.hasOwn(expected, 'expected')) {
          effectChecks.push({ key: expected.key, status: 'AMBIGUOUS', reason: 'Expected catalog definition is not pinned.' });
        } else if (canonical(actual) !== canonical(expected.expected)) {
          effectChecks.push({ key: expected.key, status: 'CONFLICT', reason: 'Catalog object differs from reviewed expected snapshot.' });
        } else {
          effectChecks.push({ key: expected.key, status: 'MATCH_NEEDS_REVIEW' });
        }
      }
    }

    const suppliedHash = historyRow?.sha256;
    const checksumStatus = suppliedHash
      ? (suppliedHash === migration.sha256 ? 'MATCH' : 'CONFLICT')
      : 'NOT_AVAILABLE';
    const hasConflict = effectChecks.some((check) => check.status === 'CONFLICT')
      || checksumStatus === 'CONFLICT';
    const allPinnedEffectsMatch = effectChecks.length > 0
      && effectChecks.every((check) => check.status === 'MATCH_NEEDS_REVIEW');
    let status = 'AMBIGUOUS';
    if (hasConflict) status = 'CONFLICT_REVIEW_REQUIRED';
    else if (!historyRow && allPinnedEffectsMatch) status = 'SCHEMA_PRESENT_HISTORY_ABSENT_REVIEW_REQUIRED';
    else if (historyRow && allPinnedEffectsMatch) status = 'HISTORY_AND_EFFECTS_MATCH_REVIEW_REQUIRED';
    else if (!historyRow && effectChecks.some((check) => check.status === 'CONFLICT')) status = 'SCHEMA_CONFLICT_HISTORY_ABSENT';

    return {
      version: migration.version,
      filename: migration.file,
      localSha256: migration.sha256,
      history: historyRow ? { name: historyRow.name, sha256: suppliedHash ?? null } : null,
      checksumStatus,
      status,
      effectChecks,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    mode: 'read-only-evidence-comparison',
    automaticAppliedConclusion: false,
    projectIdentity: catalog.projectIdentity ?? null,
    localMigrationCount: migrations.length,
    historyComparison: history,
    duplicateCatalogKeys: [...new Set(duplicateCatalogKeys)],
    migrations: rows,
    reviewRequired: true,
    note: 'Matching version and object snapshots are evidence for human review; this tool never marks a migration applied or proves every SQL side effect from existence alone.',
  };
}

async function main(args) {
  const options = parseArgs(args);
  if (options.help) {
    process.stdout.write('Usage: node scripts/reconcile-migration-evidence.mjs --history <json> --catalog <json> --effects <reviewed-json> [--migrations <dir>] [--out <path>]\n');
    return 0;
  }
  for (const required of ['history', 'catalog', 'effects']) {
    if (!options[required]) throw new Error(`--${required} is required.`);
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const directory = resolve(options.migrations ?? join(root, 'supabase', 'migrations'));
  const files = (await readdir(directory, { withFileTypes: true }))
    .filter((item) => item.isFile() && item.name.toLowerCase().endsWith('.sql'))
    .map((item) => item.name)
    .sort((left, right) => left.localeCompare(right));
  const entries = await Promise.all(files.map(async (file) => ({ file, contents: await readFile(join(directory, file)) })));
  const manifest = buildMigrationManifest(entries);
  if (manifest.errors.length) throw new Error(`Local migration inventory is invalid: ${JSON.stringify(manifest.errors)}`);

  const historyExport = JSON.parse(await readFile(resolve(options.history), 'utf8'));
  const catalog = JSON.parse(await readFile(resolve(options.catalog), 'utf8'));
  const effects = JSON.parse(await readFile(resolve(options.effects), 'utf8'));
  const result = reconcileEvidence({
    migrations: manifest.migrations,
    historyRows: normalizeHistory(historyExport),
    catalog,
    effects,
  });
  const output = `${JSON.stringify(result, null, 2)}\n`;
  if (options.out) {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(resolve(options.out), output, { encoding: 'utf8', flag: 'wx' });
  } else process.stdout.write(output);
  const hasDiscrepancy = result.historyComparison.errors.length
    || result.historyComparison.localOnly.length
    || result.historyComparison.historyOnly.length
    || result.historyComparison.nameMismatches.length
    || result.duplicateCatalogKeys.length
    || result.migrations.some((entry) => entry.status !== 'HISTORY_AND_EFFECTS_MATCH_REVIEW_REQUIRED');
  return hasDiscrepancy ? 2 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`Migration evidence reconciliation failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}