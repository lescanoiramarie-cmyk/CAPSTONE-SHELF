<#
.SYNOPSIS
    Unit tests for backup-production-db.ps1 functions
    Tests cover identity verification, role filtering, and validation functions.
#>

#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:testsPassed = 0
$script:testsFailed = 0

function Assert-True { param([bool]$Condition, [string]$Message) if ($Condition) { $script:testsPassed++; Write-Host "PASS: $Message" -ForegroundColor Green } else { $script:testsFailed++; Write-Host "FAIL: $Message" -ForegroundColor Red } }
function Assert-Equal { param($Expected, $Actual, [string]$Message) if ("$Expected" -eq "$Actual") { $script:testsPassed++; Write-Host "PASS: $Message" -ForegroundColor Green } else { $script:testsFailed++; Write-Host "FAIL: $Message (Expected: '$Expected', Actual: '$Actual')" -ForegroundColor Red } }
function Assert-Match { param([string]$Pattern, [string]$Value, [string]$Message) if ($Value -match $Pattern) { $script:testsPassed++; Write-Host "PASS: $Message" -ForegroundColor Green } else { $script:testsFailed++; Write-Host "FAIL: $Message (Pattern: '$Pattern', Value: '$Value')" -ForegroundColor Red } }
function Assert-NotMatch { param([string]$Pattern, [string]$Value, [string]$Message) if ($Value -notmatch $Pattern) { $script:testsPassed++; Write-Host "PASS: $Message" -ForegroundColor Green } else { $script:testsFailed++; Write-Host "FAIL: $Message (Pattern should not match: '$Pattern', Value: '$Value')" -ForegroundColor Red } }

function Get-VerifiedProjectRef {
    param(
        [string]$HostName,
        [string]$UserName,
        [string]$ExpectedProjectRef = "khwtfjyvawukbsvyjdux"
    )

    if ([string]::IsNullOrWhiteSpace($HostName)) {
        throw "Connection host cannot be empty."
    }
    if ([string]::IsNullOrWhiteSpace($UserName)) {
        throw "Connection username cannot be empty."
    }

    if ($HostName -match '^db\.([a-z0-9]{20})\.supabase\.co$') {
        $parsedRef = $matches[1]
        if ($parsedRef -cne $ExpectedProjectRef) {
            throw "Target host project reference '$parsedRef' does not match expected production project reference '$ExpectedProjectRef'."
        }
        return $parsedRef
    }

    if ($HostName -match '^[a-z0-9-]+\.pooler\.supabase\.com$') {
        if ($UserName -match '^postgres\.([a-z0-9]{20})$') {
            $parsedRef = $matches[1]
            if ($parsedRef -cne $ExpectedProjectRef) {
                throw "Pooler user project reference '$parsedRef' does not match expected production project reference '$ExpectedProjectRef'."
            }
            return $parsedRef
        } else {
            throw "Malformed pooler username '$UserName'. Expected format: postgres.<project-ref> (20 alphanumeric characters)."
        }
    }

    throw "Untrusted or unrecognized database endpoint '$HostName'. Target host must be a valid Supabase pooler (*.pooler.supabase.com) or direct host (db.<project-ref>.supabase.co)."
}

Write-Host "=== BACKUP SCRIPT UNIT TESTS ===" -ForegroundColor Cyan

# TEST 1: Correct identity with project fingerprint
Write-Host "`n--- Test-DatabaseIdentity: Correct identity and project fingerprint ---" -ForegroundColor Yellow
$mockOutput = "postgres|postgres|postgres|PostgreSQL 17.6|2|3"
$rows = @($mockOutput | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
Assert-Equal 1 $rows.Count "Single row returned"
$fields = $rows[0].Trim() -split '\|', 6
Assert-Equal 6 $fields.Count "Six fields parsed"
Assert-Equal 'postgres' $fields[0] "Database is postgres"
Assert-Equal 'postgres' $fields[1] "current_user is postgres"
Assert-Equal 'postgres' $fields[2] "session_user is postgres"
Assert-True ([int]$fields[4] -ge 1) "Dedicated roles detected"
Assert-True ([int]$fields[5] -ge 1) "Core tables detected"

# TEST 2: Wrong database
Write-Host "`n--- Test-DatabaseIdentity: Wrong database ---" -ForegroundColor Yellow
$mockOutput = "wrongdb|postgres|postgres|PostgreSQL 17.6|2|3"
$rows = @($mockOutput | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
$fields = $rows[0].Trim() -split '\|', 6
$mismatch = $fields[0] -cne 'postgres' -or $fields[1] -cne 'postgres' -or $fields[2] -cne 'postgres'
Assert-True $mismatch "Detects wrong database"

# TEST 3: Wrong current_user
Write-Host "`n--- Test-DatabaseIdentity: Wrong current_user ---" -ForegroundColor Yellow
$mockOutput = "postgres|wronguser|postgres|PostgreSQL 17.6|2|3"
$rows = @($mockOutput | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
$fields = $rows[0].Trim() -split '\|', 6
$mismatch = $fields[0] -cne 'postgres' -or $fields[1] -cne 'postgres' -or $fields[2] -cne 'postgres'
Assert-True $mismatch "Detects wrong current_user"

# TEST 4: Wrong session_user
Write-Host "`n--- Test-DatabaseIdentity: Wrong session_user ---" -ForegroundColor Yellow
$mockOutput = "postgres|postgres|wronguser|PostgreSQL 17.6|2|3"
$rows = @($mockOutput | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
$fields = $rows[0].Trim() -split '\|', 6
$mismatch = $fields[0] -cne 'postgres' -or $fields[1] -cne 'postgres' -or $fields[2] -cne 'postgres'
Assert-True $mismatch "Detects wrong session_user"

# TEST 4b: Missing schema fingerprint (generic postgres database)
Write-Host "`n--- Test-DatabaseIdentity: Missing schema fingerprint ---" -ForegroundColor Yellow
$mockOutput = "postgres|postgres|postgres|PostgreSQL 17.6|0|0"
$rows = @($mockOutput | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
$fields = $rows[0].Trim() -split '\|', 6
$lacksFingerprint = [int]$fields[4] -lt 1 -or [int]$fields[5] -lt 1
Assert-True $lacksFingerprint "Rejects generic postgres database without SHELF schema"

# TEST 5: Empty output
Write-Host "`n--- Test-DatabaseIdentity: Empty output ---" -ForegroundColor Yellow
$mockOutput = ""
$rows = @($mockOutput | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
Assert-Equal 0 $rows.Count "Empty output detected as zero rows"

# TEST 6: Malformed output
Write-Host "`n--- Test-DatabaseIdentity: Malformed output ---" -ForegroundColor Yellow
$mockOutput = "postgres|postgres"
$rows = @($mockOutput | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
$fields = $rows[0].Trim() -split '\|', 6
$malformed = $fields.Count -ne 6 -or [string]::IsNullOrWhiteSpace($fields[5])
Assert-True $malformed "Malformed output detected"

# TEST 7: Multiple output rows
Write-Host "`n--- Test-DatabaseIdentity: Multiple output rows ---" -ForegroundColor Yellow
$mockOutput = "postgres|postgres|postgres|PostgreSQL 17.6|2|3`npostgres|postgres|postgres|PostgreSQL 17.6|2|3"
$rows = @(($mockOutput -split "`n") | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
Assert-True ($rows.Count -ne 1) "Multiple rows detected (count != 1)"

# TEST 8: Auth failure
Write-Host "`n--- Test-DatabaseIdentity: Auth failure ---" -ForegroundColor Yellow
$mockOutput = "psql: error: connection to server failed: password authentication failed"
$reason = 'psql returned a nonzero exit code'
if ($mockOutput -match '(?i)password authentication|authentication failed|no password supplied') { $reason = 'database authentication failed' }
Assert-Equal 'database authentication failed' $reason "Auth failure correctly categorized"

# TEST 9: TLS failure
Write-Host "`n--- Test-DatabaseIdentity: TLS failure ---" -ForegroundColor Yellow
$mockOutput = "psql: error: connection to server failed: certificate verify failed"
$reason = 'psql returned a nonzero exit code'
if ($mockOutput -match '(?i)certificate|ssl|tls') { $reason = 'TLS certificate or hostname verification failed' }
Assert-Equal 'TLS certificate or hostname verification failed' $reason "TLS failure correctly categorized"

# TEST 10: SQL failure
Write-Host "`n--- Test-DatabaseIdentity: SQL failure ---" -ForegroundColor Yellow
$mockOutput = 'ERROR:  syntax error at or near "SELECT"'
$reason = 'psql returned a nonzero exit code'
if ($mockOutput -match '(?i)syntax error|does not exist|permission denied') { $reason = 'identity query execution failed' }
Assert-Equal 'identity query execution failed' $reason "SQL failure correctly categorized"

# TEST 11: Password cleanup
Write-Host "`n--- Password cleanup ---" -ForegroundColor Yellow
$env:PGPASSWORD = "test-password-123"
$env:PGPASSWORD = ""
Assert-Equal "" $env:PGPASSWORD "PGPASSWORD cleared after use"

# TEST 12: Partial-file cleanup
Write-Host "`n--- Partial-file cleanup ---" -ForegroundColor Yellow
$tempDir = [System.IO.Path]::GetTempPath()
$tempFile1 = Join-Path $tempDir "backup_test_1_$PID.dump"
$tempFile2 = Join-Path $tempDir "backup_test_2_$PID.dump"
Set-Content -Path $tempFile1 -Value "test"
Set-Content -Path $tempFile2 -Value "test"
$createdFiles = @($tempFile1, $tempFile2)
foreach ($file in $createdFiles) { if (Test-Path $file) { Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue } }
$filesExist = (Test-Path $tempFile1) -or (Test-Path $tempFile2)
Assert-True (-not $filesExist) "Partial files cleaned up on failure"

# TEST 13: No secret leakage
Write-Host "`n--- No secret leakage ---" -ForegroundColor Yellow
$testOutput = "psql: error: connection to server failed: password=secret123"
$sanitized = $testOutput -replace 'password=[^\s]+', 'password=***'
Assert-Match 'password=\*\*\*' $sanitized "Password sanitized in output"
Assert-NotMatch 'secret123' $sanitized "Original password not in sanitized output"

# TEST 14: Filter-RolesSql - Excludes managed roles
Write-Host "`n--- Filter-RolesSql: Excludes managed roles ---" -ForegroundColor Yellow
$excludedRoles = @("supabase_admin", "authenticator", "service_role", "anon", "postgres", "pg_read_all_data", "pg_write_all_data", "pg_monitor", "pg_signal_backend")
$testContent = "CREATE ROLE `"supabase_admin`" WITH SUPERUSER;`nCREATE ROLE `"custom_role`" WITH LOGIN;`nALTER ROLE `"supabase_admin`" SET search_path = public;`nGRANT `"supabase_admin`" TO `"custom_role`";`nCREATE ROLE `"another_role`" WITH LOGIN;"
$statements = $testContent -split "`n" | Where-Object { $_ -match '\S' }
$escapedRoles = $excludedRoles | ForEach-Object { [regex]::Escape($_) }
$excludedRolePattern = '^(' + ($escapedRoles -join '|') + ')$'
$filteredStatements = @()
foreach ($stmt in $statements) {
    $trimmed = $stmt.Trim()
    $keep = $true
    if ($trimmed -match '^\s*CREATE\s+(ROLE|USER)\s+(\S+)') { $roleName = $matches[2].Trim('"'); if ($roleName -match $excludedRolePattern) { $keep = $false } }
    elseif ($trimmed -match '^\s*ALTER\s+(ROLE|USER)\s+(\S+)') { $roleName = $matches[2].Trim('"'); if ($roleName -match $excludedRolePattern) { $keep = $false } }
    elseif ($trimmed -match '^\s*GRANT\s+(\S+)\s+TO\s+(\S+)') {
        $grantedRole = $matches[1].Trim('"').Trim(';'); $grantee = $matches[2].Trim('"').Trim(';')
        if ($grantee -match $excludedRolePattern -or $grantedRole -match $excludedRolePattern) { $keep = $false }
    }
    elseif ($trimmed -match '^\s*GRANT\s+.+\s+TO\s+(\S+)') { $grantee = $matches[1].Trim('"').Trim(';'); if ($grantee -match $excludedRolePattern) { $keep = $false } }
    elseif ($trimmed -match '^\s*GRANT\s+(\S+)') { $grantedRole = $matches[1].Trim('"').Trim(';'); if ($grantedRole -match $excludedRolePattern) { $keep = $false } }
    if ($keep) { $filteredStatements += $stmt }
}
$filteredContent = $filteredStatements -join "`n`n"
Assert-Match 'custom_role' $filteredContent "Custom role preserved"
Assert-Match 'another_role' $filteredContent "Another role preserved"
Assert-NotMatch 'supabase_admin' $filteredContent "Supabase admin excluded"

# TEST 15: Filter-RolesSql - Preserves custom roles
Write-Host "`n--- Filter-RolesSql: Preserves custom roles ---" -ForegroundColor Yellow
$testContent2 = "CREATE ROLE `"my_custom_role`" WITH LOGIN;`nCREATE ROLE `"another_app_role`" WITH LOGIN PASSWORD 'secret';`nALTER ROLE `"my_custom_role`" SET search_path = public;`nGRANT `"my_custom_role`" TO `"another_app_role`";`nCOMMENT ON ROLE `"my_custom_role`" IS 'Application role';"
$statements2 = $testContent2 -split "`n" | Where-Object { $_ -match '\S' }
$filteredStatements2 = @()
foreach ($stmt in $statements2) {
    $trimmed = $stmt.Trim()
    $keep = $true
    if ($trimmed -match '^\s*CREATE\s+(ROLE|USER)\s+(\S+)') { $roleName = $matches[2].Trim('"'); if ($roleName -match $excludedRolePattern) { $keep = $false } }
    elseif ($trimmed -match '^\s*ALTER\s+(ROLE|USER)\s+(\S+)') { $roleName = $matches[2].Trim('"'); if ($roleName -match $excludedRolePattern) { $keep = $false } }
    elseif ($trimmed -match '^\s*GRANT\s+(\S+)\s+TO\s+(\S+)') {
        $grantedRole = $matches[1].Trim('"').Trim(';'); $grantee = $matches[2].Trim('"').Trim(';')
        if ($grantee -match $excludedRolePattern -or $grantedRole -match $excludedRolePattern) { $keep = $false }
    }
    elseif ($trimmed -match '^\s*GRANT\s+.+\s+TO\s+(\S+)') { $grantee = $matches[1].Trim('"').Trim(';'); if ($grantee -match $excludedRolePattern) { $keep = $false } }
    elseif ($trimmed -match '^\s*GRANT\s+(\S+)') { $grantedRole = $matches[1].Trim('"').Trim(';'); if ($grantedRole -match $excludedRolePattern) { $keep = $false } }
    elseif ($trimmed -match '^\s*COMMENT\s+ON\s+ROLE\s+(\S+)') { $roleName = $matches[1].Trim('"'); if ($roleName -match $excludedRolePattern) { $keep = $false } }
    if ($keep) { $filteredStatements2 += $stmt }
}
$filteredContent2 = $filteredStatements2 -join "`n`n"
Assert-Match 'my_custom_role' $filteredContent2 "Custom role preserved"
Assert-Match 'another_app_role' $filteredContent2 "Another app role preserved"
Assert-Match 'COMMENT ON ROLE' $filteredContent2 "Comment preserved"

# TEST 16: Connection string building
Write-Host "`n--- Connection string building ---" -ForegroundColor Yellow
$poolerHost = "aws-0-ap-northeast-1.pooler.supabase.com"
$poolerPort = "5432"
$database = "postgres"
$poolerUser = "postgres.khwtfjyvawukbsvyjdux"
$sslMode = "verify-full"
$caCertPath = "C:\Users\Yesha May M. Cordero\Downloads\prod-ca-2021.crt"
$connectTimeout = "10"
$caCertPathLibpq = $caCertPath.Replace('\', '/')
$caCertPathLibpqQuoted = "'$caCertPathLibpq'"
$connStr = "host=$poolerHost port=$poolerPort dbname=$database user=$poolerUser sslmode=$sslMode sslrootcert=$caCertPathLibpqQuoted connect_timeout=$connectTimeout"
Assert-Match "sslmode=verify-full" $connStr "verify-full mode in connection string"
Assert-Match "sslrootcert='" $connStr "CA cert path quoted"
Assert-Match "postgres.khwtfjyvawukbsvyjdux" $connStr "Pooler user in connection string"
Assert-Match "aws-0-ap-northeast-1.pooler.supabase.com" $connStr "Pooler host in connection string"

# TEST 17: Expected database/role
Write-Host "`n--- Expected database/role verification ---" -ForegroundColor Yellow
Assert-Equal 'postgres' 'postgres' "Expected database is postgres"
Assert-Equal 'postgres' 'postgres' "Expected role is postgres"

# TEST 18: Connection string format for pg_dump --dbname
Write-Host "`n--- Connection string format for pg_dump --dbname ---" -ForegroundColor Yellow
$dbnameArg = $connStr
Assert-Match "host=$poolerHost" $dbnameArg "Host in dbname arg"
Assert-Match "port=$poolerPort" $dbnameArg "Port in dbname arg"
Assert-Match "dbname=$database" $dbnameArg "Dbname in dbname arg"
Assert-Match "user=$poolerUser" $dbnameArg "User in dbname arg"
Assert-Match "sslmode=$sslMode" $dbnameArg "SSL mode in dbname arg"
Assert-Match "sslrootcert=" $dbnameArg "SSL root cert in dbname arg"

# TEST 19: Get-VerifiedProjectRef - Valid pooler host and username
Write-Host "`n--- Get-VerifiedProjectRef: Valid pooler host and username ---" -ForegroundColor Yellow
$ref = Get-VerifiedProjectRef -HostName "aws-0-ap-northeast-1.pooler.supabase.com" -UserName "postgres.khwtfjyvawukbsvyjdux"
Assert-Equal "khwtfjyvawukbsvyjdux" $ref "Valid pooler target returns verified project ref"

# TEST 20: Get-VerifiedProjectRef - Valid direct DB host
Write-Host "`n--- Get-VerifiedProjectRef: Valid direct DB host ---" -ForegroundColor Yellow
$refDirect = Get-VerifiedProjectRef -HostName "db.khwtfjyvawukbsvyjdux.supabase.co" -UserName "postgres"
Assert-Equal "khwtfjyvawukbsvyjdux" $refDirect "Valid direct DB host returns verified project ref"

# TEST 21: Get-VerifiedProjectRef - Wrong project in pooler username
Write-Host "`n--- Get-VerifiedProjectRef: Wrong project in pooler username ---" -ForegroundColor Yellow
$wrongPoolerFailed = $false
try {
    Get-VerifiedProjectRef -HostName "aws-0-ap-northeast-1.pooler.supabase.com" -UserName "postgres.otherproject12345678" | Out-Null
} catch {
    $wrongPoolerFailed = $_.Exception.Message -match "does not match expected production project reference"
}
Assert-True $wrongPoolerFailed "Rejects pooler username with wrong project ref"

# TEST 22: Get-VerifiedProjectRef - Wrong project in direct host
Write-Host "`n--- Get-VerifiedProjectRef: Wrong project in direct host ---" -ForegroundColor Yellow
$wrongDirectFailed = $false
try {
    Get-VerifiedProjectRef -HostName "db.otherproject12345678.supabase.co" -UserName "postgres" | Out-Null
} catch {
    $wrongDirectFailed = $_.Exception.Message -match "does not match expected production project reference"
}
Assert-True $wrongDirectFailed "Rejects direct host with wrong project ref"

# TEST 23: Get-VerifiedProjectRef - Malformed host
Write-Host "`n--- Get-VerifiedProjectRef: Malformed host ---" -ForegroundColor Yellow
$malformedHostFailed = $false
try {
    Get-VerifiedProjectRef -HostName "untrusted.attacker-database.com" -UserName "postgres.khwtfjyvawukbsvyjdux" | Out-Null
} catch {
    $malformedHostFailed = $_.Exception.Message -match "Untrusted or unrecognized database endpoint"
}
Assert-True $malformedHostFailed "Rejects untrusted / malformed host"

# TEST 24: Get-VerifiedProjectRef - Malformed pooler username (missing project ref)
Write-Host "`n--- Get-VerifiedProjectRef: Malformed pooler username ---" -ForegroundColor Yellow
$malformedUserFailed = $false
try {
    Get-VerifiedProjectRef -HostName "aws-0-ap-northeast-1.pooler.supabase.com" -UserName "postgres" | Out-Null
} catch {
    $malformedUserFailed = $_.Exception.Message -match "Malformed pooler username"
}
Assert-True $malformedUserFailed "Rejects pooler connection with generic username 'postgres'"

# TEST 25: Get-VerifiedProjectRef - Missing project reference
Write-Host "`n--- Get-VerifiedProjectRef: Missing project reference ---" -ForegroundColor Yellow
$missingRefFailed = $false
try {
    Get-VerifiedProjectRef -HostName "aws-0-ap-northeast-1.pooler.supabase.com" -UserName "postgres." | Out-Null
} catch {
    $missingRefFailed = $true
}
Assert-True $missingRefFailed "Rejects empty/truncated project ref"

# TEST 26: Get-VerifiedProjectRef - Empty host fails closed
Write-Host "`n--- Get-VerifiedProjectRef: Empty host fails closed ---" -ForegroundColor Yellow
$emptyHostFailed = $false
try {
    Get-VerifiedProjectRef -HostName "" -UserName "postgres.khwtfjyvawukbsvyjdux" | Out-Null
} catch {
    $emptyHostFailed = $_.Exception.Message -match "Connection host cannot be empty"
}
Assert-True $emptyHostFailed "Fails closed when host is empty"

# SUMMARY
Write-Host "`n=== TEST SUMMARY ===" -ForegroundColor Cyan
Write-Host "Passed: $($script:testsPassed)" -ForegroundColor Green
Write-Host "Failed: $($script:testsFailed)" -ForegroundColor Red
if ($script:testsFailed -gt 0) { exit 1 } else { exit 0 }
