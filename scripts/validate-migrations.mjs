#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MIGRATION_FILENAME = /^(\d{14})_(.+)\.sql$/;

export function parseHistoryText(input, sourceName = 'history export') {
  const trimmed = input.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed);
    const rows = Array.isArray(parsed) ? parsed : parsed.migrations;
    if (!Array.isArray(rows)) {
      throw new Error(`${sourceName} JSON must be an array or an object with a migrations array.`);
    }
    return rows.map((row) => {
      if (typeof row === 'string') return { version: row.trim(), name: '' };
      if (!row || typeof row !== 'object') throw new Error(`${sourceName} contains an invalid row.`);
      return {
        version: String(row.version ?? '').trim(),
        name: String(row.name ?? '').trim(),
      };
    });
  }

  const lines = trimmed.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith('#'));
  const first = parseCsvLine(lines[0]);
  const header = first.map((field) => field.trim().toLowerCase());
  if (header.includes('version')) {
    const versionIndex = header.indexOf('version');
    const nameIndex = header.indexOf('name');
    return lines.slice(1).map((line, index) => {
      const fields = parseCsvLine(line);
      return {
        version: String(fields[versionIndex] ?? '').trim(),
        name: nameIndex < 0 ? '' : String(fields[nameIndex] ?? '').trim(),
        line: index + 2,
      };
    });
  }

  return lines.map((line, index) => {
    const match = line.trim().match(/^(\d{14})(?:[\s,|]+(.*))?$/);
    if (!match) throw new Error(`${sourceName} line ${index + 1} is not a 14-digit version or version/name row.`);
    return { version: match[1], name: (match[2] ?? '').trim().replace(/^"|"$/g, ''), line: index + 1 };
  });
}

function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === ',' && !quoted) {
      fields.push(current);
      current = '';
    } else {
      current += character;
    }
  }
  if (quoted) throw new Error('History CSV contains an unterminated quoted field.');
  fields.push(current);
  return fields;
}

export function buildMigrationManifest(entries) {
  const migrations = [];
  const errors = [];
  const seen = new Map();

  for (const entry of entries) {
    const file = basename(entry.file);
    const match = file.match(MIGRATION_FILENAME);
    if (!match) {
      errors.push({ kind: 'invalid_filename', file });
      continue;
    }
    const [, version, name] = match;
    if (seen.has(version)) {
      errors.push({ kind: 'duplicate_version', version, files: [seen.get(version), file] });
    } else {
      seen.set(version, file);
    }
    const contents = Buffer.isBuffer(entry.contents) ? entry.contents : Buffer.from(entry.contents);
    migrations.push({ version, name, file, sha256: createHash('sha256').update(contents).digest('hex') });
  }

  const sorted = [...migrations].sort((left, right) => left.version.localeCompare(right.version));
  const inputOrder = migrations.map(({ version }) => version);
  const sortedOrder = sorted.map(({ version }) => version);
  if (inputOrder.some((version, index) => version !== sortedOrder[index])) {
    errors.push({ kind: 'not_ascending', versions: inputOrder });
  }

  return { migrations, errors };
}

export function compareMigrationHistory(migrations, historyRows) {
  const localByVersion = new Map(migrations.map((migration) => [migration.version, migration]));
  const historyByVersion = new Map();
  const errors = [];
  for (const row of historyRows) {
    if (!/^\d{14}$/.test(row.version)) {
      errors.push({ kind: 'invalid_history_version', version: row.version, line: row.line });
      continue;
    }
    if (historyByVersion.has(row.version)) {
      errors.push({ kind: 'duplicate_history_version', version: row.version, line: row.line });
      continue;
    }
    historyByVersion.set(row.version, row);
  }

  const localOnly = migrations.filter(({ version }) => !historyByVersion.has(version)).map(({ version }) => version);
  const historyOnly = [...historyByVersion.keys()].filter((version) => !localByVersion.has(version)).sort();
  const nameMismatches = [];
  for (const migration of migrations) {
    const history = historyByVersion.get(migration.version);
    if (history?.name && normalizeName(history.name) !== normalizeName(migration.name)) {
      nameMismatches.push({ version: migration.version, local: migration.name, history: history.name });
    }
  }

  return { localOnly, historyOnly, nameMismatches, errors };
}

function normalizeName(name) {
  return name.trim().replace(/\.sql$/i, '').toLowerCase();
}

async function readMigrationEntries(directory) {
  const names = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.sql'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  const entries = [];
  for (const file of names) entries.push({ file, contents: await readFile(join(directory, file)) });
  return entries;
}

function parseArguments(args) {
  const options = { directory: null, history: null, output: null };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') options.help = true;
    else if (['--migrations', '--history', '--out'].includes(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${argument} requires a path.`);
      options[{ '--migrations': 'directory', '--history': 'history', '--out': 'output' }[argument]] = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

const HELP = `Usage: node scripts/validate-migrations.mjs [options]

Options:
  --migrations <dir>  Migration directory (default: supabase/migrations)
  --history <file>    Optional owner-supplied JSON, CSV (version,name), or version-list export
  --out <file>        Write JSON manifest to this path (default: stdout)
  --help              Show this help

This tool is offline and read-only with respect to Supabase. It never connects to a project,
applies SQL, repairs history, or infers production migration history.`;

export function validateReleasePackage(entries, manifest) {
  const errors = [];
  const CATEGORY_B_VERSIONS = [
    '20261108160959',
    '20261109130133',
    '20261129999998',
    '20261129999999',
    '20261226999999',
    '20261227000001',
  ];
  const UNAPPLIED_START = '20270102000000';

  const allVersions = manifest.migrations.map((m) => m.version);
  const categoryA = allVersions.filter((v) => v < UNAPPLIED_START && !CATEGORY_B_VERSIONS.includes(v));
  const categoryB = allVersions.filter((v) => CATEGORY_B_VERSIONS.includes(v));
  const categoryC = allVersions.filter((v) => v >= UNAPPLIED_START);

  if (categoryA.length !== 119) {
    errors.push({ kind: 'invalid_category_a_count', expected: 119, actual: categoryA.length });
  }
  if (categoryB.length !== 6) {
    errors.push({ kind: 'invalid_category_b_count', expected: 6, actual: categoryB.length });
  }
  if (categoryC.length !== 48) {
    errors.push({ kind: 'invalid_category_c_count', expected: 48, actual: categoryC.length });
  }

  // Scan for SQL defects across all migration files (calls or definitions of invalid pg_catalog.trim, excluding DROP FUNCTION cleanup)
  for (const entry of entries) {
    const text = Buffer.isBuffer(entry.contents) ? entry.contents.toString('utf8') : String(entry.contents);
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      if (/pg_catalog\.trim\s*\(/i.test(line) && !/DROP\s+FUNCTION/i.test(line)) {
        errors.push({ kind: 'invalid_pg_catalog_trim', file: basename(entry.file) });
        break;
      }
    }
  }

  // Verify Category B fail-closed preflights and postflight assertions in 20270120000000
  const reconEntry = entries.find((e) => basename(e.file).startsWith('20270120000000'));
  if (!reconEntry) {
    errors.push({ kind: 'missing_release_reconciliation_migration', version: '20270120000000' });
  } else {
    const reconText = Buffer.isBuffer(reconEntry.contents) ? reconEntry.contents.toString('utf8') : String(reconEntry.contents);
    for (const bVer of CATEGORY_B_VERSIONS) {
      if (!reconText.includes(bVer)) {
        errors.push({ kind: 'missing_category_b_stamp', version: bVer });
      }
      const failPattern = new RegExp(`Category B verification failed:\\s*${bVer}`, 'i');
      if (!failPattern.test(reconText)) {
        errors.push({ kind: 'missing_fail_closed_preflight', version: bVer });
      }
    }
    if (!reconText.includes('$postflight_assertions$')) {
      errors.push({ kind: 'missing_postflight_assertions' });
    }
  }

  // Verify forward reconciliation 20270119000000
  const reviewsEntry = entries.find((e) => basename(e.file).startsWith('20270119000000'));
  if (!reviewsEntry) {
    errors.push({ kind: 'missing_reviews_reconciliation_migration', version: '20270119000000' });
  } else {
    const revText = Buffer.isBuffer(reviewsEntry.contents) ? reviewsEntry.contents.toString('utf8') : String(reviewsEntry.contents);
    if (!revText.includes('save_my_book_review') || !revText.includes('book_reviews_book_id_visitor_id_key')) {
      errors.push({ kind: 'incomplete_reviews_reconciliation' });
    }
  }

  return {
    categories: {
      categoryA: { count: categoryA.length, first: categoryA[0], last: categoryA.at(-1) },
      categoryB: { count: categoryB.length, versions: categoryB },
      categoryC: { count: categoryC.length, first: categoryC[0], last: categoryC.at(-1) },
      totalCount: allVersions.length,
    },
    errors,
  };
}

async function main(args) {
  const options = parseArguments(args);
  if (options.help) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = resolve(scriptDirectory, '..');
  const migrationDirectory = options.directory
    ? resolve(options.directory)
    : join(repositoryRoot, 'supabase', 'migrations');
  const entries = await readMigrationEntries(migrationDirectory);
  const manifest = buildMigrationManifest(entries);
  const releaseValidation = validateReleasePackage(entries, manifest);

  let comparison = null;
  if (options.history) {
    const historyPath = resolve(options.history);
    const rows = parseHistoryText(await readFile(historyPath, 'utf8'), historyPath);
    comparison = compareMigrationHistory(manifest.migrations, rows);
  }
  const result = {
    migrationDirectory: isAbsolute(migrationDirectory) ? migrationDirectory : resolve(migrationDirectory),
    count: manifest.migrations.length,
    firstVersion: manifest.migrations[0]?.version ?? null,
    lastVersion: manifest.migrations.at(-1)?.version ?? null,
    releaseSummary: releaseValidation.categories,
    migrations: manifest.migrations,
    validationErrors: [...manifest.errors, ...releaseValidation.errors],
    ...(comparison ? { historyComparison: comparison } : {}),
  };
  const output = `${JSON.stringify(result, null, 2)}\n`;
  if (options.output) await writeFile(resolve(options.output), output, { encoding: 'utf8', flag: 'wx' });
  else process.stdout.write(output);
  if (manifest.errors.length || releaseValidation.errors.length) return 2;
  if (comparison && (
    comparison.errors.length || comparison.localOnly.length || comparison.historyOnly.length || comparison.nameMismatches.length
  )) return 3;
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`Migration validation failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}