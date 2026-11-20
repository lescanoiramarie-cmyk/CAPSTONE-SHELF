# Secure psql test for SHELF ILMS production database
# Prompts for password without exposing in command history, logs, process list, or output.
# Uses PGPASSWORD environment variable for libpq authentication.
#
# HOW TO RUN (from repository root):
#   cd CAPSTONE-SHELF-main
#   .\secure_psql_test.ps1
#
# Prerequisites:
#   - PostgreSQL 18 client at C:\Program Files\PostgreSQL\18\bin\psql.exe
#   - Network access to aws-0-ap-northeast-1.pooler.supabase.com:5432
#   - Valid database password for user: postgres.khwtfjyvawukbsvyjdux
#
# Security notes:
#   - Password read via Read-Host -AsSecureString (hidden input)
#   - Password passed to psql via PGPASSWORD environment variable (not CLI args)
#   - PGPASSWORD cleared in finally block
#   - SecureString converted to BSTR only for PGPASSWORD assignment; the BSTR
#     remains in unmanaged memory until process exit — unavoidable in PowerShell
#     without P/Invoke to SecureZeroMemory. Minimize exposure by running this
#     script in a dedicated short-lived PowerShell session.
#   - No Invoke-Expression; uses call operator (&) with explicit argument array

$ErrorActionPreference = 'Stop'

$psqlPath = "C:\Program Files\PostgreSQL\18\bin\psql.exe"
$server   = "aws-0-ap-northeast-1.pooler.supabase.com"
$port     = "5432"
$database = "postgres"
$user     = "postgres.khwtfjyvawukbsvyjdux"
$sslmode  = "verify-full"
$caCertPath = $env:SUPABASE_CA_CERT_PATH

Write-Host "SHELF ILMS Production Database Authentication Test"
Write-Host "Project: khwtfjyvawukbsvyjdux (Tokyo region)"
Write-Host ""

# Verify psql executable exists
if (-not (Test-Path -LiteralPath $psqlPath)) {
    Write-Host "❌ FAIL: psql not found at $psqlPath" -ForegroundColor Red
    Write-Host "   Install PostgreSQL 18 client or update \$psqlPath in this script."
    exit 1
}
Write-Host "✅ PASS: psql found at $psqlPath"

# Require a trusted CA before prompting for a production password.
if ([string]::IsNullOrWhiteSpace($caCertPath) -or -not (Test-Path -LiteralPath $caCertPath -PathType Leaf)) {
    Write-Host "FAIL: Set SUPABASE_CA_CERT_PATH to the trusted Supabase CA certificate file. No connection was attempted." -ForegroundColor Red
    exit 1
}
try {
    $null = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($caCertPath)
} catch {
    Write-Host "FAIL: SUPABASE_CA_CERT_PATH is not a readable certificate file. No connection was attempted." -ForegroundColor Red
    exit 1
}

# Prompt for password securely (hidden input, no echo)
$securePassword = Read-Host -AsSecureString "Enter database password for $user"
if (-not $securePassword -or $securePassword.Length -eq 0) {
    Write-Host "❌ FAIL: No password entered." -ForegroundColor Red
    exit 1
}

# Convert SecureString to plaintext ONLY for PGPASSWORD environment variable.
# This creates an unmanaged BSTR; it cannot be fully erased from memory in pure
# PowerShell. The variable is cleared and GC is forced in the finally block.
$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
$plainPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

$env:PGPASSWORD = $plainPassword
$previousPgOptions = $env:PGOPTIONS
$env:PGOPTIONS = "-c default_transaction_read_only=on"

try {
    # Common psql options:
    #   -X           Do not read .psqlrc
    #   -w           Never prompt for password (fail if PGPASSWORD missing)
    #   -v ON_ERROR_STOP=1  Stop on first SQL error
    #   --quiet      Suppress welcome messages
    #   connection timeout via connect_timeout in connection string (10s)
    $psqlOpts = "-X", "-w", "-v", "ON_ERROR_STOP=1", "--quiet"
    $escapedCaCertPath = $caCertPath.Replace('\', '\\').Replace("'", "\'")
    $connStr = "host=$server port=$port dbname=$database user=$user sslmode=$sslmode sslrootcert='$escapedCaCertPath' connect_timeout=10"

    function Invoke-PsqlQuery {
        param(
            [string]$Label,
            [string]$Sql
        )
        Write-Host "`n--- $Label ---"
        $args = @($psqlOpts) + @("-d", $connStr, "-c", $Sql)
        $output = & $psqlPath @args 2>&1
        $exitCode = $LASTEXITCODE

        if ($exitCode -eq 0) {
            Write-Host "✅ PASS (exit code $exitCode)"
            Write-Host $output
            return $true
        } else {
            Write-Host "❌ FAIL (exit code $exitCode)"
            Write-Host $output
            return $false
        }
    }

    $allPassed = $true

    # 1. PostgreSQL version
    $allPassed = Invoke-PsqlQuery "PostgreSQL version" "SELECT version();" -and $allPassed

    # 2. Current user
    $allPassed = Invoke-PsqlQuery "Current user" "SELECT current_user;" -and $allPassed

    # 3. pgcrypto extension
    $allPassed = Invoke-PsqlQuery "pgcrypto extension" "SELECT extname FROM pg_extension WHERE extname = 'pgcrypto';" -and $allPassed

    # 4. shelf_attendance_rpc_owner role
    $allPassed = Invoke-PsqlQuery "shelf_attendance_rpc_owner role" "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shelf_attendance_rpc_owner');" -and $allPassed

    if ($allPassed) {
        Write-Host "`n=== ALL CHECKS PASSED ===" -ForegroundColor Green
    } else {
        Write-Host "`n=== ONE OR MORE CHECKS FAILED ===" -ForegroundColor Red
    }
}
catch {
    Write-Host "`n❌ UNEXPECTED ERROR: $_" -ForegroundColor Red
    $allPassed = $false
}
finally {
    # Clear sensitive variables
    $plainPassword = ""
    $securePassword.Dispose()
    $env:PGPASSWORD = ""
    $env:PGOPTIONS = $previousPgOptions
    # Force garbage collection to reduce plaintext lifetime in managed heap
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}

# Exit with appropriate code for CI/CD consumption
if ($allPassed) {
    exit 0
}
exit 1
