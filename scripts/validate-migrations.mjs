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
    migrations: manifest.migrations,
    validationErrors: manifest.errors,
    ...(comparison ? { historyComparison: comparison } : {}),
  };
  const output = `${JSON.stringify(result, null, 2)}\n`;
  if (options.output) await writeFile(resolve(options.output), output, { encoding: 'utf8', flag: 'wx' });
  else process.stdout.write(output);
  if (manifest.errors.length) return 2;
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