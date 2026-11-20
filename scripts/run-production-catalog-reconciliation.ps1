<#PSScriptInfo
.VERSION 1.1
.GUID 5a3c7f2e-8b4d-4f6a-9e2c-1d7b8f3a4c5d
.AUTHOR SHELF ILMS Team
.COMPANYNAME BatStateU JPLPC
.COPYRIGHT (c) 2025 BatStateU JPLPC. All rights reserved.
.TAGS SHELF, ILMS, production, reconciliation, catalog, psql, security
.LICENSEURI https://opensource.org/licenses/MIT
.PROJECTURI https://github.com/batstateu/shelf-ilms
.ICONURI
.EXTERNALMODULEDEPENDENCIES
.REQUIREDSCRIPTS
.EXTERNALSCRIPTDEPENDENCIES
.RELEASENOTES
v1.1: Removed -SkipValidation, mandatory validation before password prompt, output persisted to timestamped report file, restricted permissions, $psqlArgs variable, no silent discard of successful results.
#>

<#PSScriptInfo
.SYNOPSIS
Securely executes production_catalog_reconciliation.sql against SHELF ILMS production database.

.DESCRIPTION
This script runs the read-only production catalog reconciliation SQL script against the
production PostgreSQL database. It uses the same secure password handling as secure_psql_test.ps1:
- Password prompted via Read-Host -AsSecureString (hidden input)
- Password passed via PGPASSWORD environment variable (never on command line)
- PGPASSWORD restored to its prior process value in finally block; SecureString disposed
- Uses psql -f to execute the SQL file directly
- ON_ERROR_STOP=1 ensures non-zero exit on any SQL error
- Validates SQL file is strictly read-only BEFORE prompting for password (mandatory, no bypass)
- Saves complete reconciliation output to timestamped report file with restricted permissions
- Prints only report file path and execution status to console

.NOTES
File: run-production-catalog-reconciliation.ps1
Author: SHELF ILMS Team
Requires: PostgreSQL 18 client (psql.exe), network access to Supabase pooler
#>

#Requires -Version 5.1

[CmdletBinding()]
param(
    [Parameter(Mandatory=$false)]
    [ValidateSet('production_catalog_reconciliation.sql', 'scripts\verify-fine-dashboard-index-readonly.sql')]
    [string]$SqlFilePath = "production_catalog_reconciliation.sql",

    [Parameter(Mandatory=$false)]
    [ValidateSet('Production')]
    [string]$Environment = 'Production'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Configuration
$psqlPath = "C:\Program Files\PostgreSQL\18\bin\psql.exe"
$server   = "aws-0-ap-northeast-1.pooler.supabase.com"
$port     = "5432"
$database = "postgres"
$user     = "postgres.khwtfjyvawukbsvyjdux"
$sslmode  = "verify-full"
$caCertPath = $env:SUPABASE_CA_CERT_PATH
$connectTimeout = 10

# Resolve SQL file path
$scriptDir = Split-Path -Parent -Path $MyInvocation.MyCommand.Definition
$projectRoot = Split-Path -Parent -Path $scriptDir
$credentialHelperPath = Join-Path -Path $scriptDir -ChildPath 'PsqlCredential.ps1'
if (-not (Test-Path -LiteralPath $credentialHelperPath -PathType Leaf)) {
    Write-Host '[FAIL] Secure credential helper is missing. No connection was attempted.' -ForegroundColor Red
    exit 1
}
. $credentialHelperPath
$sqlFile = Join-Path -Path $projectRoot -ChildPath $SqlFilePath

Write-Host "SHELF ILMS Production Catalog Reconciliation Runner"
Write-Host "Environment: $Environment"
Write-Host "SQL File: $sqlFile"
Write-Host ""

# Validate SQL file exists
if (-not (Test-Path -LiteralPath $sqlFile)) {
    Write-Host "[FAIL] FAIL: SQL file not found at $sqlFile" -ForegroundColor Red
    exit 1
}
Write-Host "[PASS] PASS: SQL file found"

# Verify psql executable exists
if (-not (Test-Path -LiteralPath $psqlPath)) {
    Write-Host "[FAIL] FAIL: psql not found at $psqlPath" -ForegroundColor Red
    Write-Host "   Install PostgreSQL 18 client or update `$psqlPath in this script."
    exit 1
}
Write-Host "[PASS] PASS: psql found at $psqlPath"

# Do not prompt for a production password unless hostname-verified TLS is configured.
if ([string]::IsNullOrWhiteSpace($caCertPath) -or -not (Test-Path -LiteralPath $caCertPath -PathType Leaf)) {
    Write-Host "[FAIL] Set SUPABASE_CA_CERT_PATH to the trusted Supabase CA certificate file. No connection was attempted." -ForegroundColor Red
    exit 1
}
try {
    $null = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($caCertPath)
} catch {
    Write-Host "[FAIL] SUPABASE_CA_CERT_PATH is not a readable certificate file. No connection was attempted." -ForegroundColor Red
    exit 1
}

# Step 1: Run read-only validator (MANDATORY - no bypass)
Write-Host "`n--- Validating SQL file is strictly read-only ---"
$validatorPath = Join-Path -Path $projectRoot -ChildPath "scripts\validate-production-catalog-sql.mjs"
if (-not (Test-Path -LiteralPath $validatorPath)) {
    Write-Host "[FAIL] FAIL: Validator not found at $validatorPath. Aborting execution." -ForegroundColor Red
    exit 1
}
$validationResult = & node $validatorPath $sqlFile 2>&1
$validationExitCode = $LASTEXITCODE
Write-Host $validationResult
if ($validationExitCode -ne 0) {
    Write-Host "`n[FAIL] FAIL: SQL validation failed. Aborting execution." -ForegroundColor Red
    exit 1
}
Write-Host "[PASS] PASS: SQL validation passed (strictly read-only)"

# Step 2: Prepare and verify report ACLs before prompting or opening a database connection.
$aclHelperPath = Join-Path -Path $scriptDir -ChildPath 'ReportAcl.ps1'
if (-not (Test-Path -LiteralPath $aclHelperPath -PathType Leaf)) {
    Write-Host "[FAIL] Report ACL helper not found at $aclHelperPath. No connection was attempted." -ForegroundColor Red
    exit 1
}
. $aclHelperPath
$currentIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$currentUserSid = $currentIdentity.User
$currentUserName = $currentIdentity.Name
if (-not $currentUserSid) {
    Write-Host '[FAIL] Could not resolve the current Windows user SID. No connection was attempted.' -ForegroundColor Red
    exit 1
}

$reportDir = Join-Path -Path $projectRoot -ChildPath "production-reconciliation-reports"
if (-not (Test-Path -LiteralPath $reportDir)) {
    try {
        New-Item -ItemType Directory -Path $reportDir -Force | Out-Null
    } catch {
        Write-Host "FAIL: Could not create report directory ${reportDir}: $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    }
}
try {
    Set-RestrictedReportAcl -LiteralPath $reportDir -ItemType Directory -CurrentUserSid $currentUserSid
    Write-Host "[PASS] Directory DACL restricted to the current user SID, SYSTEM, and Administrators: $currentUserName"
} catch {
    Write-Host "[FAIL] Could not restrict report directory permissions: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$reportFile = Join-Path -Path $reportDir -ChildPath "reconciliation_${timestamp}.txt"
try {
    if (Test-Path -LiteralPath $reportFile) {
        throw 'A report with this timestamp already exists; refusing to overwrite it.'
    }
    New-Item -ItemType File -Path $reportFile -ErrorAction Stop | Out-Null
    Set-RestrictedReportAcl -LiteralPath $reportFile -ItemType File -CurrentUserSid $currentUserSid
    Write-Host '[PASS] Empty report file DACL verified before database connection.'
} catch {
    Write-Host "[FAIL] Could not create and secure report file: $($_.Exception.Message). No connection was attempted." -ForegroundColor Red
    if (Test-Path -LiteralPath $reportFile) {
        try { Remove-Item -LiteralPath $reportFile -Force -ErrorAction Stop } catch { }
    }
    exit 1
}

# Step 3: Prompt for password securely
$securePassword = Read-Host -AsSecureString "Enter database password for $user"
if (-not $securePassword -or $securePassword.Length -eq 0) {
    Write-Host "[FAIL] FAIL: No password entered." -ForegroundColor Red
    exit 1
}

# Convert SecureString to plaintext ONLY for PGPASSWORD environment variable.
# This creates an unmanaged BSTR; it cannot be fully erased from memory in pure
# PowerShell. The variable is cleared and GC is forced in the finally block.
$plainPassword = ConvertFrom-SecurePsqlPassword -SecurePassword $securePassword

$psqlEnvironmentState = $null
$reportWritten = $false
try {
    $psqlEnvironmentState = Set-PsqlProcessEnvironment -Password $plainPassword
    # psql options:
    #   -X           Do not read .psqlrc
    #   -w           Never prompt for password (fail if PGPASSWORD missing)
    #   -v ON_ERROR_STOP=1  Stop on first SQL error
    #   -f           Execute SQL file
    #   --quiet      Suppress welcome messages
    #   connection timeout via connect_timeout in connection string
    $psqlOpts = "-X", "-w", "-v", "ON_ERROR_STOP=1", "--quiet", "-f", $sqlFile
    $escapedCaCertPath = $caCertPath.Replace('\', '\\').Replace("'", "\'")
    $connStr = "host=$server port=$port dbname=$database user=$user sslmode=$sslmode sslrootcert='$escapedCaCertPath' connect_timeout=$connectTimeout"

    Write-Host "`n--- Executing production_catalog_reconciliation.sql ---"
    Write-Host "This is a READ-ONLY operation. No migrations or DDL will be executed."
    Write-Host ""

    $psqlArgs = @($psqlOpts) + @("-d", $connStr)
    $output = & $psqlPath @psqlArgs 2>&1
    $exitCode = $LASTEXITCODE

if ($exitCode -eq 0) {
        # Save complete output to timestamped report file
        try {
            $output | Out-File -FilePath $reportFile -Encoding UTF8 -Force
            Assert-RestrictedReportAcl -LiteralPath $reportFile -ItemType File -CurrentUserSid $currentUserSid
            Write-Host "[PASS] File DACL verified for the current user SID, SYSTEM, and Administrators: $currentUserName"
            $reportWritten = $true
        } catch {
            Write-Host "FAIL: Could not write or secure report file ${reportFile}: $($_.Exception.Message)" -ForegroundColor Red
            exit 1
        }
        Write-Host "[PASS] PASS: Reconciliation completed successfully (exit code $exitCode)"
        Write-Host "Report saved to: $reportFile"
    } else {
        Write-Host "[FAIL] $(Get-SanitizedPsqlFailure -Output $output -ExitCode $exitCode)" -ForegroundColor Red
        exit 1
    }
}
catch {
    Write-Host "`n[FAIL] Unexpected reconciliation error; detailed output withheld." -ForegroundColor Red
    exit 1
}
finally {
    # Clean up incomplete report if psql failed
    if (-not $reportWritten -and (Test-Path -LiteralPath $reportFile)) {
        try { Remove-Item -LiteralPath $reportFile -Force -ErrorAction SilentlyContinue } catch { }
    }
    # Clear sensitive variables
    $plainPassword = ""
    if ($securePassword) {
        $securePassword.Dispose()
    }
    if ($psqlEnvironmentState) {
        Restore-PsqlProcessEnvironment -PriorEnvironment $psqlEnvironmentState
    }
    $psqlEnvironmentState = $null
    # Force garbage collection to reduce plaintext lifetime in managed heap
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}

Write-Host "`n=== RECONCILIATION COMPLETE ===" -ForegroundColor Green
exit 0
