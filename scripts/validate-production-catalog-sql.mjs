#!/usr/bin/env node
// Validate production_catalog_reconciliation.sql for correctness and safety

import { readFileSync, realpathSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ALLOWED_SQL_PATHS = new Set([
  'production_catalog_reconciliation.sql',
  'scripts/verify-fine-dashboard-index-readonly.sql',
]);

const FORBIDDEN_PATTERNS = [
  { pattern: /\bINSERT\s+/i, name: 'INSERT statement' },
  { pattern: /\bUPDATE\s+/i, name: 'UPDATE statement' },
  { pattern: /\bDELETE\s+/i, name: 'DELETE statement' },
  { pattern: /\bALTER\s+/i, name: 'ALTER statement' },
  { pattern: /\bDROP\s+/i, name: 'DROP statement' },
  { pattern: /\bCREATE\s+/i, name: 'CREATE statement' },
  { pattern: /\bGRANT\s+/i, name: 'GRANT statement' },
  { pattern: /\bREVOKE\s+/i, name: 'REVOKE statement' },
  { pattern: /\bTRUNCATE\s+/i, name: 'TRUNCATE statement' },
  { pattern: /\bCOPY\s+/i, name: 'COPY statement' },
  { pattern: /\bVACUUM\s+/i, name: 'VACUUM statement' },
  { pattern: /\bANALYZE\s+/i, name: 'ANALYZE statement' },
  { pattern: /\bREINDEX\s+/i, name: 'REINDEX statement' },
  { pattern: /\bCLUSTER\s+/i, name: 'CLUSTER statement' },
  { pattern: /\bCOMMENT\s+ON\s+/i, name: 'COMMENT ON statement' },
  { pattern: /\bSECURITY\s+LABEL\s+/i, name: 'SECURITY LABEL statement' },
];

const SYNTAX_ERROR_PATTERNS = [
  { pattern: /IS\s+NOTNULL\b/i, name: 'IS NOTNULL (should be IS NOT NULL)' },
  { pattern: /information_schema\.columnsWHERE\b/i, name: 'information_schema.columnsWHERE (missing space)' },
  { pattern: /\\echo\s+['"][^'"]*\\n[^'"]*['"]/i, name: 'Literal \\n in \\echo command' },
];

const REQUIRED_SECTIONS = [
  '1. Migration History',
  '2. Tables and Columns',
  '3. Constraints',
  '4. Indexes',
  '4b. Fine dashboard index catalog identity',
  '5. Functions',
  '5b. Critical RPC definitions',
  '6. Function Grants',
  '6b. Default Privileges for Functions',
  '7. Triggers',
  '8. RLS Status',
  '9. Policies',
  '10. Table Grants',
  '10b. Default Privileges for Tables',
  '11. Schema/Sequence/Function Grants',
  '11b. Default Privileges for Sequences',
  '12. Views and Materialized Views',
  '13. Extensions',
  '14. Roles',
  '15. Critical Objects',
  '15b. Visitor notification type constraint',
  '15c. borrowed_book_counts RLS',
];

// Parse SQL content into statements, handling multiline statements
function parseStatements(content) {
  const lines = content.split('\n');
  const statements = [];
  let currentStmt = '';
  let inStatement = false;
  let parenDepth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inDollarQuote = false;
  let dollarTag = '';

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const rawLine = lines[lineNum];
    const trimmed = rawLine.trim();

    // Skip empty lines and comments, but track line numbers
    if (!trimmed || trimmed.startsWith('--')) {
      if (inStatement) {
        currentStmt += '\n' + rawLine;
      }
      continue;
    }

    // Skip psql meta-commands
    if (trimmed.startsWith('\\')) {
      if (inStatement) {
        statements.push({ sql: currentStmt.trim(), startLine: lineNum - currentStmt.split('\n').length + 1, endLine: lineNum });
        currentStmt = '';
        inStatement = false;
        parenDepth = 0;
      }
      continue;
    }

    if (!inStatement) {
      inStatement = true;
      currentStmt = rawLine;
    } else {
      currentStmt += '\n' + rawLine;
    }

    // Simple state machine to detect statement end (semicolon not in quotes)
    for (let i = 0; i < rawLine.length; i++) {
      const ch = rawLine[i];
      const next = rawLine[i + 1];

      if (inDollarQuote) {
        if (ch === '$' && rawLine.slice(i).startsWith(dollarTag + '$')) {
          inDollarQuote = false;
          i += dollarTag.length;
        }
        continue;
      }

      if (ch === '$' && next && /[A-Za-z0-9_]/.test(next)) {
        // Start of dollar quote
        let j = i + 1;
        while (j < rawLine.length && /[A-Za-z0-9_]/.test(rawLine[j])) j++;
        if (j < rawLine.length && rawLine[j] === '$') {
          dollarTag = rawLine.slice(i + 1, j);
          inDollarQuote = true;
          i = j;
        }
        continue;
      }

      if (ch === "'" && !inDoubleQuote) {
        inSingleQuote = !inSingleQuote;
        continue;
      }
      if (ch === '"' && !inSingleQuote) {
        inDoubleQuote = !inDoubleQuote;
        continue;
      }

      if (!inSingleQuote && !inDoubleQuote) {
        if (ch === '(') parenDepth++;
        else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1);
        else if (ch === ';' && parenDepth === 0) {
          statements.push({ sql: currentStmt.trim(), startLine: lineNum - currentStmt.split('\n').length + 1, endLine: lineNum });
          currentStmt = '';
          inStatement = false;
          parenDepth = 0;
        }
      }
    }
  }

  // Handle any remaining statement
  if (inStatement && currentStmt.trim()) {
    statements.push({ sql: currentStmt.trim(), startLine: lines.length - currentStmt.split('\n').length + 1, endLine: lines.length });
  }

  return statements;
}

function getStatementType(sql) {
  const trimmed = sql.trim().toUpperCase();
  if (/^BEGIN\s+TRANSACTION\s+READ\s+ONLY;?$/.test(trimmed)) return 'BEGIN READ ONLY';
  if (/^COMMIT;?$/.test(trimmed)) return 'COMMIT';
  if (trimmed.startsWith('SELECT')) return 'SELECT';
  if (trimmed.startsWith('WITH')) return 'WITH';
  if (trimmed.startsWith('(')) return 'SUBQUERY';
  return 'OTHER';
}

function resolveSqlFile(requestedPath) {
  const candidate = requestedPath || 'production_catalog_reconciliation.sql';
  const absoluteCandidate = resolve(PROJECT_ROOT, candidate);
  const relativeCandidate = relative(PROJECT_ROOT, absoluteCandidate).replaceAll('\\', '/');
  if (!ALLOWED_SQL_PATHS.has(relativeCandidate)) {
    throw new Error('SQL file is not on the read-only diagnostic allowlist.');
  }
  const realFile = realpathSync(absoluteCandidate);
  const relativeRealFile = relative(PROJECT_ROOT, realFile).replaceAll('\\', '/');
  if (relativeRealFile !== relativeCandidate) {
    throw new Error('SQL file resolves outside its approved repository path.');
  }
  return { absolutePath: realFile, relativePath: relativeCandidate };
}

function main() {
  let sqlFile;
  let relativeSqlPath;
  try {
    ({ absolutePath: sqlFile, relativePath: relativeSqlPath } = resolveSqlFile(process.argv[2]));
  } catch (error) {
    console.error(`RESULT: FAIL - ${error.message}`);
    process.exit(1);
  }
  const content = readFileSync(sqlFile, 'utf-8');
  let hasErrors = false;
  let hasWarnings = false;

  console.log(`=== Validating ${relativeSqlPath} ===\n`);

  // Check for forbidden write/DDL statements
  console.log('--- Checking for forbidden write/DDL statements ---');
  for (const { pattern, name } of FORBIDDEN_PATTERNS) {
    const matches = content.match(pattern);
    if (matches) {
      // Allow in comments only
      const lines = content.split('\n');
      let realMatch = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (pattern.test(line) && !line.trim().startsWith('--')) {
          console.error(`  FAIL: Found "${name}" on line ${i + 1}: ${line.trim()}`);
          realMatch = true;
          hasErrors = true;
        }
      }
      if (!realMatch) {
        console.log(`  OK: "${name}" only appears in comments`);
      }
    } else {
      console.log(`  OK: No "${name}" found`);
    }
  }

  // Check for known syntax errors
  console.log('\n--- Checking for known syntax errors ---');
  for (const { pattern, name } of SYNTAX_ERROR_PATTERNS) {
    const matches = content.match(pattern);
    if (matches) {
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (pattern.test(lines[i])) {
          console.error(`  FAIL: ${name} on line ${i + 1}: ${lines[i].trim()}`);
          hasErrors = true;
        }
      }
    } else {
      console.log(`  OK: No "${name}" found`);
    }
  }

  // Check required sections exist
  console.log('\n--- Checking required sections ---');
  const requiredSections = relativeSqlPath === 'production_catalog_reconciliation.sql'
    ? REQUIRED_SECTIONS
    : [];
  for (const section of requiredSections) {
    if (content.includes(section)) {
      console.log(`  OK: Section "${section}" found`);
    } else {
      console.error(`  FAIL: Section "${section}" NOT found`);
      hasErrors = true;
    }
  }

  // psql meta-commands can execute local commands or change the connection.
  // The approved full report uses only \echo; the index diagnostic uses none.
  console.log('\n--- Checking psql meta-commands ---');
  const unsupportedMetaCommands = content.split('\n')
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => /^\s*\\/.test(line) && !/^\s*\\echo(?:\s|$)/i.test(line));
  if (unsupportedMetaCommands.length > 0) {
    for (const item of unsupportedMetaCommands) {
      console.error(`  FAIL: Unsupported psql meta-command on line ${item.number}`);
    }
    hasErrors = true;
  } else {
    console.log('  OK: Only approved read-only psql meta-commands found');
  }

  // Check for proper \echo formatting (no literal \n)
  console.log('\n--- Checking \\echo formatting ---');
  const echoLines = content.split('\n').filter((line, idx) => line.trim().startsWith('\\echo') && line.includes('\\n'));
  if (echoLines.length > 0) {
    for (const line of echoLines) {
      const idx = content.split('\n').findIndex(l => l === line);
      console.error(`  FAIL: Literal \\n in \\echo on line ${idx + 1}: ${line.trim()}`);
      hasErrors = true;
    }
  } else {
    console.log('  OK: No literal \\n in \\echo commands');
  }

  // Check that ACL queries handle NULL (they use CROSS JOIN LATERAL aclexplode which returns no rows for NULL)
  console.log('\n--- Checking ACL NULL handling (informational) ---');
  const aclQueries = content.split('\n').filter(line => line.includes('aclexplode'));
  console.log(`  INFO: Found ${aclQueries.length} aclexplode queries (return no rows for NULL ACL = default privileges)`);
  console.log('  INFO: Added pg_default_acl queries (sections 6b, 10b, 11b) to inspect default privileges explicitly');
  if (aclQueries.length > 0) {
    hasWarnings = true;
  }

  // Check no sensitive data queries
  console.log('\n--- Checking for sensitive data exposure ---');
  const sensitivePatterns = [
    { pattern: /\bpassword\b/i, name: 'password column' },
    { pattern: /\botp\b/i, name: 'OTP column' },
    { pattern: /\bsecret\b/i, name: 'secret column' },
    { pattern: /\bvisitor.*email\b/i, name: 'visitor email' },
    { pattern: /\bfine_payment.*amount\b/i, name: 'fine payment amount' },
    { pattern: /SELECT\s+\*\s+FROM\s+(visitors|borrow_requests|community_book_requests|fine_payments)/i, name: 'SELECT * from sensitive table' },
  ];
  for (const { pattern, name } of sensitivePatterns) {
    const matches = content.match(pattern);
    if (matches) {
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (pattern.test(lines[i]) && !lines[i].trim().startsWith('--')) {
          console.error(`  FAIL: Potential ${name} exposure on line ${i + 1}: ${lines[i].trim()}`);
          hasErrors = true;
        }
      }
    } else {
      console.log(`  OK: No ${name} exposure`);
    }
  }

  // Verify read-only: only SELECT/WITH statements (properly parsed)
  console.log('\n--- Verifying read-only statements (parsed) ---');
  const statements = parseStatements(content);
  console.log(`  INFO: Parsed ${statements.length} SQL statements`);
  const requiresReadOnlyTransaction = true;
  if (requiresReadOnlyTransaction) {
    if (getStatementType(statements[0]?.sql ?? '') !== 'BEGIN READ ONLY'
        || getStatementType(statements.at(-1)?.sql ?? '') !== 'COMMIT') {
      console.error('  FAIL: Approved catalog SQL must start with BEGIN TRANSACTION READ ONLY and end with COMMIT');
      hasErrors = true;
    } else {
      console.log('  OK: Catalog SQL is enclosed in an explicit read-only transaction');
    }
  }
  for (let index = 0; index < statements.length; index++) {
    const stmt = statements[index];
    const type = getStatementType(stmt.sql);
    const isAllowedTransactionBoundary = requiresReadOnlyTransaction
      && ((index === 0 && type === 'BEGIN READ ONLY')
        || (index === statements.length - 1 && type === 'COMMIT'));
    if (isAllowedTransactionBoundary) {
      console.log(`  OK: Statement lines ${stmt.startLine}-${stmt.endLine} -> ${type}`);
      continue;
    }
    if (type === 'BEGIN READ ONLY' || type === 'COMMIT' || type === 'OTHER') {
      console.error(`  FAIL: Non-SELECT statement at lines ${stmt.startLine}-${stmt.endLine}: ${stmt.sql.slice(0, 80)}...`);
      hasErrors = true;
    } else {
      console.log(`  OK: Statement lines ${stmt.startLine}-${stmt.endLine} -> ${type}`);
    }
  }

  console.log('\n=== Validation Summary ===');
  if (hasErrors) {
    console.error('RESULT: FAIL - Fix errors before use');
    process.exit(1);
  } else if (hasWarnings) {
    console.log('RESULT: PASS with warnings');
    process.exit(0);
  } else {
    console.log('RESULT: PASS - All checks passed');
    process.exit(0);
  }
}

main();
