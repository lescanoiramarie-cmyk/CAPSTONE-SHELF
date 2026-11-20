#!/usr/bin/env node
// Test script for secure_psql_test.ps1 and run-production-catalog-reconciliation.ps1
// Validates argument handling, read-only validation, error handling, password cleanup patterns

import { readFileSync } from 'fs';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { resolve } from 'path';

const SECURE_TEST_PS1 = resolve('secure_psql_test.ps1');
const RECONCILIATION_PS1 = resolve('scripts/run-production-catalog-reconciliation.ps1');
const VALIDATOR = resolve('scripts/validate-production-catalog-sql.mjs');

function main() {
  let hasErrors = false;
  let hasWarnings = false;

  console.log('=== Testing PowerShell Secure Scripts ===\n');

  // Test secure_psql_test.ps1
  console.log('--- Testing secure_psql_test.ps1 ---');
  const secureTestContent = readFileSync(SECURE_TEST_PS1, 'utf-8');

  // Check no Invoke-Expression (excluding comments)
  const invokeExprLines = secureTestContent.split('\n').filter((line, i) =>
    line.includes('Invoke-Expression') && !line.trim().startsWith('#')
  );
  if (invokeExprLines.length > 0) {
    console.error('  FAIL: secure_psql_test.ps1 contains Invoke-Expression');
    hasErrors = true;
  } else {
    console.log('  OK: No Invoke-Expression found');
  }

  // Check call operator usage
  if (secureTestContent.includes('& $psqlPath @args')) {
    console.log('  OK: Uses call operator (&) with explicit argument array');
  } else {
    console.error('  FAIL: Does not use call operator with @args');
    hasErrors = true;
  }

  // Check SecureString handling
  if (secureTestContent.includes('Read-Host -AsSecureString')) {
    console.log('  OK: Uses Read-Host -AsSecureString for hidden password input');
  } else {
    console.error('  FAIL: Missing Read-Host -AsSecureString');
    hasErrors = true;
  }

  // Check PGPASSWORD usage
  if (secureTestContent.includes('$env:PGPASSWORD = $plainPassword')) {
    console.log('  OK: Uses PGPASSWORD environment variable');
  } else {
    console.error('  FAIL: Missing PGPASSWORD assignment');
    hasErrors = true;
  }
  if (secureTestContent.includes('$env:PGOPTIONS = "-c default_transaction_read_only=on"')
      && secureTestContent.includes('$env:PGOPTIONS = $previousPgOptions')) {
    console.log('  OK: Enforces read-only database transactions and restores prior PGOPTIONS');
  } else {
    console.error('  FAIL: Missing read-only transaction guard');
    hasErrors = true;
  }

  // Check password not on command line (look for -P or -password in actual command construction)
  const psqlCmdLines = secureTestContent.split('\n').filter(line =>
    line.includes('psql') && !line.trim().startsWith('#')
  );
  let passwordInArgs = false;
  for (const line of psqlCmdLines) {
    if (/\s-P\s/.test(line) || /\s--password\b/i.test(line) || /password\s*=/i.test(line)) {
      passwordInArgs = true;
      break;
    }
  }
  if (passwordInArgs) {
    console.error('  FAIL: Password may be passed in command line arguments');
    hasErrors = true;
  } else {
    console.log('  OK: Password not passed in command line arguments');
  }

  // Check finally block cleanup
  if (secureTestContent.includes('finally') &&
      secureTestContent.includes('$plainPassword = ""') &&
      secureTestContent.includes('$securePassword.Dispose()') &&
      secureTestContent.includes('$env:PGPASSWORD = ""')) {
    console.log('  OK: finally block clears password variables and disposes SecureString');
  } else {
    console.error('  FAIL: Missing password cleanup in finally block');
    hasErrors = true;
  }

  // Check SSL and connection options (excluding comments)
  const sslmodeLines = secureTestContent.split('\n').filter(line =>
    ((line.includes('sslmode=verify-full') || line.includes('$sslmode  = "verify-full"'))
      && !line.trim().startsWith('#'))
  );
  if (sslmodeLines.length > 0) {
    console.log('  OK: Uses sslmode=verify-full');
  } else {
    console.error('  FAIL: Missing sslmode=verify-full');
    hasErrors = true;
  }
  const secureExecutableLines = secureTestContent.split('\n').filter((line) => !line.trim().startsWith('#'));
  const secureCaConfigLine = secureExecutableLines.findIndex((line) => line.includes('$caCertPath = $env:SUPABASE_CA_CERT_PATH'));
  const secureCaGateLine = secureExecutableLines.findIndex((line) => line.includes('Set SUPABASE_CA_CERT_PATH'));
  const securePasswordPromptLine = secureExecutableLines.findIndex((line) => line.includes('$securePassword = Read-Host -AsSecureString'));
  if (secureCaConfigLine >= 0 && secureCaGateLine >= 0 && secureCaGateLine < securePasswordPromptLine
      && secureTestContent.includes('sslrootcert=')) {
    console.log('  OK: Requires the trusted CA certificate before password prompt and sets sslrootcert');
  } else {
    console.error('  FAIL: CA certificate validation must precede the password prompt');
    hasErrors = true;
  }
  const connectTimeoutLines = secureTestContent.split('\n').filter(line =>
    line.includes('connect_timeout=10') && !line.trim().startsWith('#')
  );
  if (connectTimeoutLines.length > 0) {
    console.log('  OK: Uses connect_timeout=10');
  } else {
    console.error('  FAIL: Missing connect_timeout');
    hasErrors = true;
  }

  const onErrorStopLines = secureTestContent.split('\n').filter(line =>
    line.includes('ON_ERROR_STOP=1') && !line.trim().startsWith('#')
  );
  if (onErrorStopLines.length > 0) {
    console.log('  OK: Uses ON_ERROR_STOP=1');
  } else {
    console.error('  FAIL: Missing ON_ERROR_STOP=1');
    hasErrors = true;
  }

  const xOptionLines = secureTestContent.split('\n').filter(line =>
    line.includes('-X') && !line.trim().startsWith('#')
  );
  const wOptionLines = secureTestContent.split('\n').filter(line =>
    line.includes('-w') && !line.trim().startsWith('#')
  );
  if (xOptionLines.length > 0 && wOptionLines.length > 0) {
    console.log('  OK: Uses -X and -w options');
  } else {
    console.error('  FAIL: Missing -X or -w');
    hasErrors = true;
  }

  // Check authentication queries preserved (excluding comments)
  const authQueries = [
    'SELECT version();',
    'SELECT current_user;',
    'pgcrypto',
    'shelf_attendance_rpc_owner'
  ];
  for (const query of authQueries) {
    const queryLines = secureTestContent.split('\n').filter(line =>
      line.includes(query) && !line.trim().startsWith('#')
    );
    if (queryLines.length > 0) {
      console.log(`  OK: Authentication check "${query}" preserved`);
    } else {
      console.error(`  FAIL: Authentication check "${query}" missing`);
      hasErrors = true;
    }
  }

  // Test run-production-catalog-reconciliation.ps1
  console.log('\n--- Testing run-production-catalog-reconciliation.ps1 ---');
  const reconContent = readFileSync(RECONCILIATION_PS1, 'utf-8');

  // Check no Invoke-Expression (excluding comments)
  const reconInvokeExprLines = reconContent.split('\n').filter((line, i) =>
    line.includes('Invoke-Expression') && !line.trim().startsWith('#')
  );
  if (reconInvokeExprLines.length > 0) {
    console.error('  FAIL: run-production-catalog-reconciliation.ps1 contains Invoke-Expression');
    hasErrors = true;
  } else {
    console.log('  OK: No Invoke-Expression found');
  }

  // Check call operator usage with $psqlArgs (excluding comments)
  const reconCallOpLines = reconContent.split('\n').filter(line =>
    line.includes('& $psqlPath @psqlArgs') && !line.trim().startsWith('#')
  );
  if (reconCallOpLines.length > 0) {
    console.log('  OK: Uses call operator (&) with explicit $psqlArgs argument array');
  } else {
    console.error('  FAIL: Does not use call operator with @psqlArgs');
    hasErrors = true;
  }

  // Check $psqlArgs variable defined
  const reconPsqlArgsLines = reconContent.split('\n').filter(line =>
    line.includes('$psqlArgs =') && !line.trim().startsWith('#')
  );
  if (reconPsqlArgsLines.length > 0) {
    console.log('  OK: Uses $psqlArgs variable for argument array');
  } else {
    console.error('  FAIL: Missing $psqlArgs variable');
    hasErrors = true;
  }

  // Check -f option for file execution
  const reconFOptionLines = reconContent.split('\n').filter(line =>
    line.includes('-f') && line.includes('$sqlFile') && !line.trim().startsWith('#')
  );
  if (reconFOptionLines.length > 0) {
    console.log('  OK: Uses -f option with SQL file path');
  } else {
    console.error('  FAIL: Missing -f option for file execution');
    hasErrors = true;
  }

  // Check validation step is MANDATORY (no SkipValidation parameter)
  // Look for actual parameter definition, not mentions in comments/release notes
  const reconSkipValLines = reconContent.split('\n').filter(line =>
    (line.includes('[switch]$SkipValidation') || line.includes('SkipValidation') && line.includes('Parameter')) && !line.trim().startsWith('#')
  );
  if (reconSkipValLines.length === 0) {
    console.log('  OK: No -SkipValidation bypass switch (mandatory validation)');
  } else {
    console.error('  FAIL: Contains -SkipValidation bypass switch (not allowed)');
    hasErrors = true;
  }

  // Check validator missing = abort
  const reconValidatorMissingLines = reconContent.split('\n').filter(line =>
    line.includes('Validator not found') && line.includes('Aborting') && !line.trim().startsWith('#')
  );
  if (reconValidatorMissingLines.length > 0) {
    console.log('  OK: Aborts if validator is missing');
  } else {
    console.error('  FAIL: Does not abort when validator is missing');
    hasErrors = true;
  }

  // Check validation runs BEFORE password prompt
  const validationBeforePassword = reconContent.indexOf('Validating SQL file is strictly read-only');
  const passwordPrompt = reconContent.indexOf('Enter database password');
  if (validationBeforePassword !== -1 && passwordPrompt !== -1 && validationBeforePassword < passwordPrompt) {
    console.log('  OK: Validation runs before password prompt');
  } else {
    console.error('  FAIL: Validation does not run before password prompt');
    hasErrors = true;
  }

  // Check no migration/DDL execution
  const reconReadOnlyLines = reconContent.split('\n').filter(line =>
    line.includes('READ-ONLY') && !line.trim().startsWith('#')
  );
  const reconNoMigrationLines = reconContent.split('\n').filter(line =>
    line.includes('No migrations or DDL') && !line.trim().startsWith('#')
  );
  if (reconReadOnlyLines.length > 0 && reconNoMigrationLines.length > 0) {
    console.log('  OK: Documents read-only operation, no migrations/DDL');
  } else {
    console.error('  FAIL: Missing read-only documentation');
    hasErrors = true;
  }

  // Check SecureString handling (excluding comments)
  const reconSecureLines = reconContent.split('\n').filter(line =>
    line.includes('Read-Host -AsSecureString') && !line.trim().startsWith('#')
  );
  if (reconSecureLines.length > 0) {
    console.log('  OK: Uses Read-Host -AsSecureString for hidden password input');
  } else {
    console.error('  FAIL: Missing Read-Host -AsSecureString');
    hasErrors = true;
  }

  // Check PGPASSWORD usage (excluding comments)
  const reconPgpassLines = reconContent.split('\n').filter(line =>
    line.includes('$env:PGPASSWORD = $plainPassword') && !line.trim().startsWith('#')
  );
  if (reconPgpassLines.length > 0) {
    console.log('  OK: Uses PGPASSWORD environment variable');
  } else {
    console.error('  FAIL: Missing PGPASSWORD assignment');
    hasErrors = true;
  }

  // Check finally block cleanup (excluding comments)
  const reconFinallyLines = reconContent.split('\n').filter(line =>
    line.includes('finally') && !line.trim().startsWith('#')
  );
  const reconClearPlainLines = reconContent.split('\n').filter(line =>
    line.includes('$plainPassword = ""') && !line.trim().startsWith('#')
  );
  const reconDisposeLines = reconContent.split('\n').filter(line =>
    line.includes('$securePassword.Dispose()') && !line.trim().startsWith('#')
  );
  const reconClearPgpassLines = reconContent.split('\n').filter(line =>
    line.includes('$env:PGPASSWORD = ""') && !line.trim().startsWith('#')
  );
  if (reconFinallyLines.length > 0 && reconClearPlainLines.length > 0 &&
      reconDisposeLines.length > 0 && reconClearPgpassLines.length > 0) {
    console.log('  OK: finally block clears password variables and disposes SecureString');
  } else {
    console.error('  FAIL: Missing password cleanup in finally block');
    hasErrors = true;
  }

  // Check SSL and connection options (excluding comments)
  const reconSslmodeLines = reconContent.split('\n').filter(line =>
    (line.includes('sslmode=$sslmode') || line.includes('$sslmode  = "verify-full"')) && !line.trim().startsWith('#')
  );
  if (reconSslmodeLines.length > 0) {
    console.log('  OK: Uses sslmode=verify-full');
  } else {
    console.error('  FAIL: Missing sslmode=verify-full');
    hasErrors = true;
  }
  const reconExecutableLines = reconContent.split('\n').filter((line) => !line.trim().startsWith('#'));
  const caConfigLine = reconExecutableLines.findIndex((line) => line.includes('$caCertPath = $env:SUPABASE_CA_CERT_PATH'));
  const caGateLine = reconExecutableLines.findIndex((line) => line.includes('Set SUPABASE_CA_CERT_PATH'));
  const passwordPromptLine = reconExecutableLines.findIndex((line) => line.includes('$securePassword = Read-Host -AsSecureString'));
  if (caConfigLine >= 0 && caGateLine >= 0 && caGateLine < passwordPromptLine
      && reconContent.includes('sslrootcert=')) {
    console.log('  OK: Requires the trusted CA certificate before password prompt and sets sslrootcert');
  } else {
    console.error('  FAIL: CA certificate validation must precede the password prompt');
    hasErrors = true;
  }
  if (reconContent.includes('& node $validatorPath $sqlFile')
      && reconContent.includes("'scripts\\verify-fine-dashboard-index-readonly.sql'")) {
    console.log('  OK: The selected SQL file is validated and SQL paths are allowlisted');
  } else {
    console.error('  FAIL: SQL execution could bypass validation or accept an arbitrary path');
    hasErrors = true;
  }
  if (reconContent.includes('$env:PGOPTIONS = "-c default_transaction_read_only=on"')
      && reconContent.includes('$env:PGOPTIONS = $previousPgOptions')) {
    console.log('  OK: Enforces read-only database transactions and restores prior PGOPTIONS');
  } else {
    console.error('  FAIL: Missing read-only transaction guard');
    hasErrors = true;
  }

  const reconConnectTimeoutLines = reconContent.split('\n').filter(line =>
    (line.includes('connect_timeout') || line.includes('connectTimeout')) && !line.trim().startsWith('#')
  );
  if (reconConnectTimeoutLines.length > 0) {
    console.log('  OK: Uses connect_timeout');
  } else {
    console.error('  FAIL: Missing connect_timeout');
    hasErrors = true;
  }

  const reconOnErrorLines = reconContent.split('\n').filter(line =>
    line.includes('ON_ERROR_STOP=1') && !line.trim().startsWith('#')
  );
  if (reconOnErrorLines.length > 0) {
    console.log('  OK: Uses ON_ERROR_STOP=1');
  } else {
    console.error('  FAIL: Missing ON_ERROR_STOP=1');
    hasErrors = true;
  }

  const reconXLines = reconContent.split('\n').filter(line =>
    line.includes('-X') && !line.trim().startsWith('#')
  );
  const reconWLines = reconContent.split('\n').filter(line =>
    line.includes('-w') && !line.trim().startsWith('#')
  );
  const reconQuietLines = reconContent.split('\n').filter(line =>
    line.includes('--quiet') && !line.trim().startsWith('#')
  );
  if (reconXLines.length > 0 && reconWLines.length > 0 && reconQuietLines.length > 0) {
    console.log('  OK: Uses -X, -w, --quiet options');
  } else {
    console.error('  FAIL: Missing -X, -w, or --quiet');
    hasErrors = true;
  }

  // Check non-zero exit on failure (excluding comments)
  const reconExitLines = reconContent.split('\n').filter(line =>
    line.includes('exit 1') && !line.trim().startsWith('#')
  );
  const reconExitCodeCheckLines = reconContent.split('\n').filter(line =>
    (line.includes('$exitCode -eq 0') || line.includes('$exitCode -ne 0') || line.includes('$exitCode') && line.includes('exitCode')) && !line.trim().startsWith('#')
  );
  if (reconExitLines.length > 0 && reconExitCodeCheckLines.length > 0) {
    console.log('  OK: Returns non-zero exit code on SQL failure');
  } else {
    console.error('  FAIL: May not return proper exit code on failure');
    hasErrors = true;
  }

  // Check output saved to timestamped report file
  const reconReportLines = reconContent.split('\n').filter(line =>
    (line.includes('production-reconciliation-reports') || line.includes('reconciliation_') || line.includes('Out-File')) && !line.trim().startsWith('#')
  );
  if (reconReportLines.length > 0) {
    console.log('  OK: Saves output to timestamped report file');
  } else {
    console.error('  FAIL: Does not save output to report file');
    hasErrors = true;
  }

  // Check report directory permissions restricted (icacls or .NET ACL APIs)
  const reconPermLines = reconContent.split('\n').filter(line =>
    (line.includes('SetAccessRuleProtection') || line.includes('FileSystemAccessRule') || line.includes('Set-Acl') || line.includes('icacls')) && !line.trim().startsWith('#')
  );
  if (reconPermLines.length > 0) {
    console.log('  OK: Restricts report directory/file permissions to current user');
  } else {
    console.error('  FAIL: Does not restrict report permissions');
    hasErrors = true;
  }

  // Check cleanup of incomplete report on failure
  const reconCleanupLines = reconContent.split('\n').filter(line =>
    (line.includes('Remove-Item') && line.includes('reportFile')) && !line.trim().startsWith('#')
  );
  if (reconCleanupLines.length > 0) {
    console.log('  OK: Cleans up incomplete report on failure');
  } else {
    console.error('  FAIL: Does not clean up incomplete report on failure');
    hasErrors = true;
  }

  // Check reportWritten flag for tracking success
  const reconReportWrittenLines = reconContent.split('\n').filter(line =>
    line.includes('$reportWritten') && !line.trim().startsWith('#')
  );
  if (reconReportWrittenLines.length > 0) {
    console.log('  OK: Tracks report write status for cleanup');
  } else {
    console.error('  FAIL: Missing report write status tracking');
    hasErrors = true;
  }

  // Check output not printed to console (only path printed)
  const reconOutputNotPrintedLines = reconContent.split('\n').filter(line =>
    (line.includes('NOT printed') || line.includes('Report saved to')) && !line.trim().startsWith('#')
  );
  if (reconOutputNotPrintedLines.length > 0) {
    console.log('  OK: Does not print full catalog output to console');
  } else {
    console.error('  FAIL: May print full catalog output to console');
    hasErrors = true;
  }

  for (const sqlPath of [
    'production_catalog_reconciliation.sql',
    'scripts/verify-fine-dashboard-index-readonly.sql',
  ]) {
    const validation = spawnSync(process.execPath, [VALIDATOR, sqlPath], { encoding: 'utf8' });
    if (validation.status !== 0) {
      console.error(`  FAIL: Approved SQL did not pass validation: ${sqlPath}`);
      hasErrors = true;
    }
  }
  const deniedPath = spawnSync(process.execPath, [VALIDATOR, 'supabase/migrations/20270129000000_support_text_borrow_request_ids.sql'], { encoding: 'utf8' });
  if (deniedPath.status !== 0 && /not on the read-only diagnostic allowlist/.test(deniedPath.stderr)) {
    console.log('  OK: Arbitrary SQL paths are rejected before execution');
  } else {
    console.error('  FAIL: Validator accepted a path outside the diagnostic allowlist');
    hasErrors = true;
  }

  console.log('\n=== Test Summary ===');
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
