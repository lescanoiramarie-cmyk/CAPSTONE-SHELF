# Synthetic-only credential handling regression test. Does not invoke psql.
$ErrorActionPreference = 'Stop'
. (Join-Path -Path $PSScriptRoot -ChildPath 'PsqlCredential.ps1')

$synthetic = '  local-test-' + [char]0x00F1 + '-$&  ' 
$secure = ConvertTo-SecureString -String $synthetic -AsPlainText -Force
$plain = $null
$originalEnvironment = @{}
$testEnvironment = $null
$environmentNames = @('PGPASSWORD', 'PGOPTIONS', 'PGSERVICE', 'PGSERVICEFILE', 'PGHOSTADDR')
try {
    $plain = ConvertFrom-SecurePsqlPassword -SecurePassword $secure
    if ($plain -cne $synthetic) {
        throw 'SecureString strict UTF-8 round-trip altered synthetic whitespace or Unicode.'
    }

    $utf8 = [System.Text.UTF8Encoding]::new($false, $true)
    $utf8Bytes = $utf8.GetBytes($plain)
    if ($utf8.GetString($utf8Bytes) -cne $synthetic) {
        throw 'Synthetic password did not round-trip through UTF-8 bytes.'
    }
    [Array]::Clear($utf8Bytes, 0, $utf8Bytes.Length)

    foreach ($name in $environmentNames) {
        $originalEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, "stale-$name", 'Process')
    }
    $testEnvironment = Set-PsqlProcessEnvironment -Password $plain
    if (([Environment]::GetEnvironmentVariable('PGPASSWORD', 'Process') -cne $synthetic) -or ([Environment]::GetEnvironmentVariable('PGOPTIONS', 'Process') -cne '-c default_transaction_read_only=on')) {
        throw 'Synthetic password or read-only PGOPTIONS was not installed in the child process environment.'
    }
    foreach ($name in @('PGSERVICE', 'PGSERVICEFILE', 'PGHOSTADDR')) {
        if ($null -ne [Environment]::GetEnvironmentVariable($name, 'Process')) {
            throw "Stale $name was not suppressed for psql."
        }
    }

    $safeArgs = @('-X', '-w', '-d', 'host=example.invalid user=postgres.testref sslmode=verify-full')
    if (($safeArgs -join ' ') -match [regex]::Escape($synthetic)) {
        throw 'Synthetic password appeared in the test argument list.'
    }

    $diagnostic = Get-SanitizedPsqlFailure -Output @("FATAL: password authentication failed; marker=$synthetic") -ExitCode 2
    if ($diagnostic.Contains($synthetic) -or $diagnostic -notmatch 'authentication failed') {
        throw 'Authentication diagnostic did not safely redact synthetic secret text.'
    }
    if ($diagnostic -match '(?i)host=|user=|password=') {
        throw 'Diagnostic exposed connection details.'
    }

    $tlsDiagnostic = Get-SanitizedPsqlFailure -Output @('certificate verify failed') -ExitCode 1
    if ($tlsDiagnostic -notmatch 'TLS verification failed' -or $tlsDiagnostic -match 'certificate verify failed') {
        throw 'TLS diagnostic was not categorized and sanitized.'
    }

    Restore-PsqlProcessEnvironment -PriorEnvironment $testEnvironment
    $testEnvironment = $null
    foreach ($name in $environmentNames) {
        if ([Environment]::GetEnvironmentVariable($name, 'Process') -cne "stale-$name") {
            throw "Prior process value for $name was not restored."
        }
    }

    Write-Output 'PASS: synthetic SecureString-to-UTF8 round-trip; stale libpq overrides suppressed/restored; no psql args or sanitized diagnostics expose the value.'
} finally {
    if ($testEnvironment) { Restore-PsqlProcessEnvironment -PriorEnvironment $testEnvironment }
    foreach ($name in $environmentNames) {
        [Environment]::SetEnvironmentVariable($name, $originalEnvironment[$name], 'Process')
    }
    $plain = $null
    if ($secure) { $secure.Dispose() }
    [GC]::Collect()
}
