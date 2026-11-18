<#
.SYNOPSIS
    SHELF ILMS Production Database Backup via Supabase Pooler
    Creates three separate dumps: roles (plain SQL), schema (custom format), data (custom format).
    Uses secure password prompt, TLS verification, and validates each dump.

.DESCRIPTION
    This script performs a read-only logical backup of the production PostgreSQL database
    via the Supabase pooler endpoint (session mode). It does NOT use Docker, WSL, or
    the Supabase CLI. It requires PostgreSQL 18 client tools installed locally.

    Backup scope (intentional inclusions):
    - Application schemas: public
    - Custom roles (excluding Supabase-managed roles)
    - All tables, indexes, constraints, functions, triggers, policies in application schemas
    - All data in application schemas

    Explicit exclusions (Supabase-managed):
    - auth schema (Supabase Auth users, sessions, MFA)
    - storage schema (Supabase Storage objects, buckets)
    - realtime schema (Supabase Realtime)
    - supabase_functions schema (Edge Functions)
    - pg_catalog, information_schema (system catalogs)
    - Supabase internal roles: supabase_admin, authenticator, service_role, anon,
      postgres, pg_read_all_data, pg_write_all_data, pg_monitor, pg_signal_backend
    - Vector/embedding tables managed by Supabase (if any)
    - Vault secrets, project configuration, API keys

.NOTES
    Prerequisites:
    - PostgreSQL 18 client at C:\Program Files\PostgreSQL\18\bin\
    - Network access to aws-0-ap-northeast-1.pooler.supabase.com:5432 (IPv4)
    - Valid database password for user: postgres.khwtfjyvawukbsvyjdux
    - Write access to $env:USERPROFILE\Documents\SHELF-SECURE-BACKUPS

    Security:
    - Password read via Read-Host -AsSecureString (hidden input)
    - Password passed via PGPASSWORD environment variable only
    - PGPASSWORD cleared after each pg_dump/pg_dumpall invocation
    - No credentials in command line, history, logs, or output
    - TLS required (sslmode=verify-full with Supabase CA when available; sslmode=require fallback)
    - connect_timeout=10

    Output:
    - Three timestamped files in Documents\SHELF-SECURE-BACKUPS
    - SHA-256 hashes recorded in manifest file
    - Validation via pg_restore --list for custom-format dumps; text validation for roles SQL

    SENSITIVE DATA NOTICE:
    The following tables in 'public' schema contain sensitive data and WILL be included:
    - password_reset_codes (reset tokens, expiry)
    - login_attempt_lockouts (failed login tracking)
    - fine_payments (payment records)
    - visitors (PII: email, name, address)
    - staff_profiles (PII: email, name, photo)
    - audit_logs (activity records)

    These files MUST be protected with filesystem ACLs (owner-only) and encrypted at rest.
    Do NOT commit to version control. Do NOT upload to public locations.

.LINK
    Supabase Pooler: https://supabase.com/docs/guides/platform/pooler
    pg_dump documentation: https://www.postgresql.org/docs/current/app-pgdump.html
#>

#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ======== CONFIGURATION ========
$pgBinPath       = "C:\Program Files\PostgreSQL\18\bin"
$pgDumpPath      = Join-Path $pgBinPath "pg_dump.exe"
$pgDumpAllPath   = Join-Path $pgBinPath "pg_dumpall.exe"
$pgRestorePath   = Join-Path $pgBinPath "pg_restore.exe"
$psqlPath        = Join-Path $pgBinPath "psql.exe"

$poolerHost      = "aws-0-ap-northeast-1.pooler.supabase.com"
$poolerPort      = "5432"
$poolerPortInt   = [int]$poolerPort
$database        = "postgres"
$poolerUser      = "postgres.khwtfjyvawukbsvyjdux"  # Session mode: postgres.<project-ref>

# TLS Configuration: verify-full with Supabase Root CA certificate
# Supabase pooler presents certificates signed by their internal CA (Supabase Root 2021 CA).
# Certificate path: C:\Users\Yesha May M. Cordero\Downloads\prod-ca-2021.crt
# Subject: CN=Supabase Root 2021 CA, O=Supabase Inc, L=New Castle, S=Delware, C=US
# Valid: 2021-04-28 to 2031-04-26
# SHA-256: 128:112:37:173:80:212:237:33:157:44:156:125:41:156:0:79:130:78:176:12:247:246:90:254:246:7:208:123:114:230:202:250
# If Supabase rotates the CA, download new cert from Dashboard -> Settings -> Database -> SSL Configuration -> "Download Certificate"
# and update $caCertPath below.
$sslMode         = "verify-full"
$caCertPath      = "C:\Users\Yesha May M. Cordero\Downloads\prod-ca-2021.crt"
$connectTimeout  = "10"

# Application schemas to include (exclude Supabase-managed schemas)
$appSchemas      = @("public")

# Supabase-managed schemas to EXCLUDE from schema/data dumps
$excludedSchemas = @(
    "auth",
    "storage",
    "realtime",
    "supabase_functions",
    "pg_catalog",
    "information_schema",
    "pg_toast",
    "pg_temp_*",
    "pg_toast_temp_*"
)

# Supabase-managed roles to EXCLUDE from roles dump
# These are platform-managed; recreating them during restore would fail or break Supabase internals
$excludedRoles   = @(
    "supabase_admin",
    "authenticator",
    "service_role",
    "anon",
    "postgres",
    "pg_read_all_data",
    "pg_write_all_data",
    "pg_monitor",
    "pg_signal_backend",
    "dashboard_user",
    "supabase_realtime_admin",
    "supabase_storage_admin",
    "pg_read_all_settings",
    "pg_read_all_stats",
    "pg_stat_scan_tables",
    "pg_execute_server_program",
    "pg_write_server_files",
    "pg_read_server_files"
)

$backupRoot      = Join-Path $env:USERPROFILE "Documents\SHELF-SECURE-BACKUPS"
$timestamp       = Get-Date -Format "yyyyMMdd_HHmmss"
$manifestPath    = Join-Path $backupRoot "backup_manifest_$timestamp.txt"

# Convert Windows path to forward slashes for libpq connection string
# Use single quotes in connection string for paths with spaces (Yesha May M. Cordero)
$caCertPathLibpq = $caCertPath.Replace('\', '/')
$caCertPathLibpqQuoted = "'$caCertPathLibpq'"

# Helper: safe string for pooler endpoint in messages
$poolerEndpoint  = "${poolerHost}:$poolerPort"

# Track files created during this run for cleanup on failure
$script:createdFiles = @()

# ======== HELPER FUNCTIONS ========
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

    # Case A: Direct database host connection (format: db.<project-ref>.supabase.co)
    if ($HostName -match '^db\.([a-z0-9]{20})\.supabase\.co
    Write-Host "=== PREFLIGHT CHECKS ===" -ForegroundColor Cyan

    # 0. Trustworthy endpoint and project reference verification (fail-closed)
    try {
        $verifiedRef = Get-VerifiedProjectRef -HostName $poolerHost -UserName $poolerUser -ExpectedProjectRef "khwtfjyvawukbsvyjdux"
        Write-Host "PASS: Verified trustworthy Supabase connection endpoint format and project reference '$verifiedRef'."
    } catch {
        Write-Host "FAIL: Endpoint project identity verification failed: $_" -ForegroundColor Red
        return $false
    }

    # 1. PostgreSQL binaries
    foreach ($tool in @($pgDumpPath, $pgDumpAllPath, $pgRestorePath, $psqlPath)) {
        if (-not (Test-Path -LiteralPath $tool)) {
            Write-Host "FAIL: Required tool not found: $tool" -ForegroundColor Red
            return $false
        }
    }
    Write-Host "PASS: PostgreSQL 18 binaries found"

    # 1b. TLS Certificate validation (verify-full mode)
    Write-Host "`n--- TLS Certificate Validation ---" -ForegroundColor Cyan
    if (-not (Test-Path -LiteralPath $caCertPath)) {
        Write-Host "FAIL: CA certificate not found at: $caCertPath" -ForegroundColor Red
        return $false
    }
    Write-Host "PASS: CA certificate file exists: $caCertPath"

    try {
        $cert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($caCertPath)
        Write-Host "PASS: CA certificate is readable"
        Write-Host "   Subject: $($cert.Subject)"
        Write-Host "   Issuer: $($cert.Issuer)"
        Write-Host "   Valid From: $($cert.NotBefore.ToString('yyyy-MM-dd HH:mm:ss'))"
        Write-Host "   Valid To:   $($cert.NotAfter.ToString('yyyy-MM-dd HH:mm:ss'))"
        $sha256 = [System.Security.Cryptography.SHA256]::Create().ComputeHash($cert.RawData)
        Write-Host "   SHA-256: $($sha256 -join ':')"
        if (-not $cert.HasPrivateKey) {
            Write-Host "   PASS: Certificate has no private key (expected for CA cert)"
        } else {
            Write-Host "   WARNING: Certificate has private key (unexpected for CA cert)" -ForegroundColor Yellow
        }
        # Check validity
        $now = Get-Date
        if ($now -lt $cert.NotBefore) {
            Write-Host "FAIL: Certificate not yet valid (future date)" -ForegroundColor Red
            return $false
        }
        if ($now -gt $cert.NotAfter) {
            Write-Host "FAIL: Certificate EXPIRED" -ForegroundColor Red
            return $false
        }
        Write-Host "PASS: Certificate is currently valid"
        # Show hostname that will be verified
        Write-Host "`n=== TLS MODE: $sslMode ===" -ForegroundColor Green
        Write-Host "Hostname to be verified: $poolerHost" -ForegroundColor Cyan
        Write-Host "Note: verify-full requires certificate SAN to match pooler hostname." -ForegroundColor Gray
        Write-Host "Supavisor (Supabase pooler) certs are signed by Supabase internal CA." -ForegroundColor Gray
        Write-Host "Offline inspection cannot confirm SAN match; runtime will verify." -ForegroundColor Gray
    } catch {
        Write-Host "FAIL: Cannot read/parse certificate: $_" -ForegroundColor Red
        return $false
    }

    # 2. Backup directory
    if (-not (Test-Path -LiteralPath $backupRoot)) {
        try {
            New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
            Write-Host "PASS: Created backup directory: $backupRoot"
        } catch {
            Write-Host "FAIL: Cannot create backup directory: $_" -ForegroundColor Red
            return $false
        }
    } else {
        Write-Host "PASS: Backup directory exists: $backupRoot"
    }

    # Restrict backup directory permissions to current user (Windows ACL via icacls)
    try {
        $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        icacls $backupRoot /inheritance:d | Out-Null
        icacls $backupRoot /remove:g * | Out-Null
        icacls $backupRoot /grant:r "${identity}:(OI)(CI)F" | Out-Null
        # Allow SYSTEM and Administrators to keep access (required by Windows)
        icacls $backupRoot /grant:r "NT AUTHORITY\SYSTEM:(OI)(CI)F" | Out-Null
        icacls $backupRoot /grant:r "BUILTIN\Administrators:(OI)(CI)F" | Out-Null
        $verify = icacls $backupRoot 2>&1
        $identityRegex = [regex]::Escape($identity)
        # Verify current user has full control (icacls shows as (OI)(CI)(F))
        if (-not ($verify -match "$identityRegex.*\(OI\)\(CI\)\(F\)")) {
            throw "DACL verification failed for backup directory (current user). Output: $verify"
        }
        # Verify SYSTEM has full control
        if (-not ($verify -match "NT AUTHORITY\\SYSTEM.*\(OI\)\(CI\)\(F\)")) {
            throw "DACL verification failed for backup directory (SYSTEM). Output: $verify"
        }
        # Verify Administrators have full control
        if (-not ($verify -match "BUILTIN\\Administrators.*\(OI\)\(CI\)\(F\)")) {
            throw "DACL verification failed for backup directory (Administrators). Output: $verify"
        }
        Write-Host "PASS: Backup directory DACL restricted to current user, SYSTEM, and Administrators: $identity"
    } catch {
        Write-Host "FAIL: Could not restrict backup directory permissions: $_" -ForegroundColor Red
        return $false
    }

    # 3. Disk space (require > 5 GB free)
    $driveQualifier = (Split-Path $backupRoot -Qualifier).TrimEnd(':')
    $drive = Get-PSDrive -Name $driveQualifier
    $freeGB = [math]::Round($drive.Free / 1GB, 2)
    if ($freeGB -lt 5) {
        Write-Host "FAIL: Insufficient disk space: ${freeGB} GB free (need > 5 GB)" -ForegroundColor Red
        return $false
    }
    Write-Host "PASS: Disk space: ${freeGB} GB free"

    # 4. Network connectivity to pooler (TCP port 5432)
    Write-Host "`nTesting TCP connectivity to $poolerEndpoint ..."
    $tcpTest = Test-NetConnection -ComputerName $poolerHost -Port $poolerPortInt -InformationLevel Quiet
    if (-not $tcpTest) {
        Write-Host "FAIL: Cannot reach $poolerEndpoint" -ForegroundColor Red
        return $false
    }
    Write-Host "PASS: TCP connection to pooler successful"

    # 5. DNS resolution
    try {
        $dns = Resolve-DnsName $poolerHost -Type A -ErrorAction Stop
        $aRecords = $dns | Where-Object { $_.Type -eq 'A' }
        Write-Host "PASS: DNS resolves to: $($aRecords.IP4Address -join ', ')"
    } catch {
        Write-Host "FAIL: DNS resolution failed: $_" -ForegroundColor Red
        return $false
    }

    return $true
}

function Restrict-FilePermissions {
    param([string]$FilePath)
    try {
        $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        icacls $FilePath /inheritance:d | Out-Null
        icacls $FilePath /remove:g * | Out-Null
        icacls $FilePath /grant:r "${identity}:F" | Out-Null
        # Allow SYSTEM and Administrators to keep access (required by Windows)
        icacls $FilePath /grant:r "NT AUTHORITY\SYSTEM:F" | Out-Null
        icacls $FilePath /grant:r "BUILTIN\Administrators:F" | Out-Null
        $verify = icacls $FilePath 2>&1
        # Escape identity for regex (contains backslash)
        $identityRegex = [regex]::Escape($identity)
        if (-not ($verify -match "$identityRegex.*\(F\)")) {
            throw "DACL verification failed for file (current user). Output: $verify"
        }
        if (-not ($verify -match "NT AUTHORITY\\SYSTEM.*\(F\)")) {
            throw "DACL verification failed for file (SYSTEM). Output: $verify"
        }
        if (-not ($verify -match "BUILTIN\\Administrators.*\(F\)")) {
            throw "DACL verification failed for file (Administrators). Output: $verify"
        }
        Write-Host "  PASS: File DACL restricted: $FilePath" -ForegroundColor Gray
        return $true
    } catch {
        Write-Host "  WARNING: Could not restrict file permissions: $_" -ForegroundColor Yellow
        return $false
    }
}

function Get-SecurePassword {
    Write-Host "`n=== SECURE PASSWORD ENTRY ===" -ForegroundColor Cyan
    Write-Host "Enter database password for user: $poolerUser"
    Write-Host "Input is hidden (no echo). Paste is allowed." -ForegroundColor Gray

    $secure = Read-Host -AsSecureString "Database password"
    if (-not $secure -or $secure.Length -eq 0) {
        Write-Host "FAIL: No password entered." -ForegroundColor Red
        exit 1
    }

    # Convert SecureString to plaintext ONLY for PGPASSWORD env var
    # This creates an unmanaged BSTR; we zero it immediately after use
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        $plain = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
        return $plain
    }
    finally {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
        $secure.Dispose()
    }
}

function Clear-Password {
    param([ref]$PasswordRef)
    if ($PasswordRef.Value) {
        $PasswordRef.Value = ""
        [GC]::Collect()
        [GC]::WaitForPendingFinalizers()
    }
}

function Register-CreatedFile {
    param([string]$FilePath)
    $script:createdFiles += $FilePath
}

function Cleanup-CreatedFiles {
    foreach ($file in $script:createdFiles) {
        if (Test-Path -LiteralPath $file) {
            try {
                Remove-Item -LiteralPath $file -Force -ErrorAction Stop
                Write-Host "  Cleaned up partial file: $file" -ForegroundColor Gray
            } catch {
                Write-Host "  WARNING: Failed to clean up: $file" -ForegroundColor Yellow
            }
        }
    }
    $script:createdFiles = @()
}

function Invoke-PgCommand {
    param(
        [string]$ToolPath,
        [string[]]$Args,
        [string]$Description,
        [string]$Password
    )
    Write-Host "`n--- $Description ---" -ForegroundColor Yellow
    $env:PGPASSWORD = $Password
    try {
        $output = & $ToolPath @Args 2>&1
        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 0) {
            # Sanitize output before display (remove potential connection strings)
            $sanitized = $output -replace 'password=[^\s]+', 'password=***'
            Write-Host "FAIL (exit code $exitCode)" -ForegroundColor Red
            Write-Host $sanitized
            return $false
        }
        Write-Host "PASS (exit code $exitCode)"
        return $true
    }
    catch {
        Write-Host "EXCEPTION: $_" -ForegroundColor Red
        return $false
    }
    finally {
        $env:PGPASSWORD = ""
    }
}

function Validate-CustomDump {
    param(
        [string]$DumpPath,
        [string]$Description
    )
    Write-Host "`n--- Validating $Description (custom format) ---" -ForegroundColor Cyan
    if (-not (Test-Path -LiteralPath $DumpPath)) {
        Write-Host "FAIL: Dump file not found: $DumpPath" -ForegroundColor Red
        return $false
    }

    $fileInfo = Get-Item -LiteralPath $DumpPath
    if ($fileInfo.Length -eq 0) {
        Write-Host "FAIL: Dump file is empty: $DumpPath" -ForegroundColor Red
        return $false
    }

    # Test readability with pg_restore --list (only for custom format)
    $env:PGPASSWORD = ""  # pg_restore --list doesn't need password
    try {
        $listOutput = & $pgRestorePath --list -v $DumpPath 2>&1
        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 0) {
            Write-Host "FAIL: pg_restore --list failed (exit code $exitCode)" -ForegroundColor Red
            Write-Host $listOutput
            return $false
        }

        $entryCount = ($listOutput -split "`n" | Where-Object { $_ -match '^\s*\d+;' }).Count
        $sizeMB = [math]::Round($fileInfo.Length / 1MB, 2)
        $sha256 = Get-FileHash -LiteralPath $DumpPath -Algorithm SHA256 | Select-Object -ExpandProperty Hash

        Write-Host "PASS: $Description"
        Write-Host "   File: $DumpPath"
        Write-Host "   Size: ${sizeMB} MB"
        Write-Host "   Entries: $entryCount"
        Write-Host "   SHA-256: $sha256"
        Write-Host "   Modified: $($fileInfo.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'))"

        # Append to manifest
        $manifestEntry = @"
=== $Description ===
File: $DumpPath
Size: ${sizeMB} MB
Entries: $entryCount
SHA-256: $sha256
Timestamp: $($fileInfo.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'))
"@
        Add-Content -Path $manifestPath -Value $manifestEntry -Encoding UTF8

        # Restrict file permissions to current user only
        Restrict-FilePermissions -FilePath $DumpPath

        return $true
    }
    catch {
        Write-Host "EXCEPTION during validation: $_" -ForegroundColor Red
        return $false
    }
}

function Validate-RolesSql {
    param(
        [string]$DumpPath,
        [string]$Description
    )
    Write-Host "`n--- Validating $Description (plain SQL) ---" -ForegroundColor Cyan
    if (-not (Test-Path -LiteralPath $DumpPath)) {
        Write-Host "FAIL: Dump file not found: $DumpPath" -ForegroundColor Red
        return $false
    }

    $fileInfo = Get-Item -LiteralPath $DumpPath
    if ($fileInfo.Length -eq 0) {
        Write-Host "FAIL: Dump file is empty: $DumpPath" -ForegroundColor Red
        return $false
    }

    # Basic validation: check it's valid SQL with role definitions
    # Also verify no excluded roles remain
    try {
        $content = Get-Content -LiteralPath $DumpPath -Raw -Encoding UTF8
        # pg_dumpall outputs role names with double quotes, count both quoted and unquoted
        $roleCount = ($content -split "`n" | Where-Object { $_ -match '^\s*CREATE\s+ROLE\s+"' -or $_ -match '^\s*CREATE\s+ROLE\s+\w' -or $_ -match '^\s*CREATE\s+USER\s+"' -or $_ -match '^\s*CREATE\s+USER\s+\w' }).Count

        # Verify excluded roles are not present
        $excludedFound = @()
        foreach ($role in $excludedRoles) {
            # pg_dumpall outputs role names with double quotes
            $pattern = 'CREATE\s+(ROLE|USER)\s+"' + [regex]::Escape($role) + '"'
            if ($content -match $pattern) {
                $excludedFound += $role
            }
        }
        if ($excludedFound.Count -gt 0) {
            Write-Host "FAIL: Excluded roles found in filtered output: $($excludedFound -join ', ')" -ForegroundColor Red
            return $false
        }

        $sizeMB = [math]::Round($fileInfo.Length / 1MB, 2)
        $sha256 = Get-FileHash -LiteralPath $DumpPath -Algorithm SHA256 | Select-Object -ExpandProperty Hash

        Write-Host "PASS: $Description"
        Write-Host "   File: $DumpPath"
        Write-Host "   Size: ${sizeMB} MB"
        Write-Host "   Role definitions found: $roleCount"
        Write-Host "   Excluded roles verified absent: $($excludedRoles.Count)"
        Write-Host "   SHA-256: $sha256"
        Write-Host "   Modified: $($fileInfo.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'))"

        # Append to manifest
        $manifestEntry = @"
=== $Description ===
File: $DumpPath
Size: ${sizeMB} MB
Role definitions: $roleCount
Excluded roles verified absent: $($excludedRoles.Count)
SHA-256: $sha256
Timestamp: $($fileInfo.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'))
"@
        Add-Content -Path $manifestPath -Value $manifestEntry -Encoding UTF8

        # Restrict file permissions to current user only
        Restrict-FilePermissions -FilePath $DumpPath

        return $true
    }
    catch {
        Write-Host "EXCEPTION during validation: $_" -ForegroundColor Red
        return $false
    }
}

function Test-DatabaseIdentity {
    param(
        [string]$Password,
        [string]$ConnectionString
    )
    Write-Host "`n=== DATABASE IDENTITY & PROJECT VERIFICATION ===" -ForegroundColor Cyan
    $expectedProjectRef = "khwtfjyvawukbsvyjdux"
    try {
        $verifiedRef = Get-VerifiedProjectRef -HostName $poolerHost -UserName $poolerUser -ExpectedProjectRef $expectedProjectRef
        Write-Host "PASS: Verified endpoint project reference matches production '$verifiedRef'."
    } catch {
        Write-Host "FAIL: Endpoint project identity check failed: $_" -ForegroundColor Red
        return $false
    }

    $sql = @"
SELECT current_database(), current_user, session_user, version(),
       (SELECT pg_catalog.count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('shelf_attendance_rpc_owner', 'shelf_book_reviews_rpc_owner')),
       (SELECT pg_catalog.count(*) FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename IN ('visitors', 'libraries', 'books'));
"@
    $env:PGPASSWORD = $Password
    try {
        $output = & $psqlPath -X -w -v ON_ERROR_STOP=1 --quiet -A -t -F '|' -d $ConnectionString -c $sql 2>&1
        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 0) {
            $reason = 'psql returned a nonzero exit code'
            if ($output -match '(?i)certificate|ssl|tls') { $reason = 'TLS certificate or hostname verification failed' }
            elseif ($output -match '(?i)password authentication|authentication failed|no password supplied') { $reason = 'database authentication failed' }
            elseif ($output -match '(?i)syntax error|does not exist|permission denied') { $reason = 'identity query execution failed' }
            Write-Host "FAIL: Database identity query failed ($reason; exit code $exitCode). Raw psql output was suppressed." -ForegroundColor Red
            return $false
        }
        $rows = @($output | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
        if ($rows.Count -ne 1) {
            Write-Host 'FAIL: Identity query returned empty or malformed output.' -ForegroundColor Red
            return $false
        }
        $fields = ([string]$rows[0]).Trim() -split '\|', 6
        if ($fields.Count -ne 6 -or [string]::IsNullOrWhiteSpace($fields[3])) {
            Write-Host 'FAIL: Identity query returned empty or malformed output.' -ForegroundColor Red
            return $false
        }
        $expectedDatabase = 'postgres'
        $expectedRole = 'postgres'
        if ($fields[0] -cne $expectedDatabase -or $fields[1] -cne $expectedRole -or $fields[2] -cne $expectedRole) {
            Write-Host 'FAIL: Connected database or role does not match the intended production identity.' -ForegroundColor Red
            Write-Host "Observed database='$($fields[0])', current_user='$($fields[1])', session_user='$($fields[2])'"
            return $false
        }

        # Project fingerprint check: verify custom SHELF roles and core tables
        $roleMatches = [int]($fields[4] || 0)
        $tableMatches = [int]($fields[5] || 0)
        if ($roleMatches -lt 1 -or $tableMatches -lt 1) {
            Write-Host 'FAIL: Target database lacks SHELF ILMS project schema fingerprint (roles/tables mismatch).' -ForegroundColor Red
            return $false
        }

        Write-Host "PASS: Verified project ref '$expectedProjectRef', database '$expectedDatabase', role '$expectedRole', TLS mode '$sslMode'."
        Write-Host "PASS: Verified SHELF ILMS schema fingerprint (found $roleMatches dedicated roles, $tableMatches core tables)."
        Write-Host "Database engine: $($fields[3])"
        return $true
    }
    catch {
        Write-Host 'FAIL: Identity verification encountered a local process or output handling error; details suppressed.' -ForegroundColor Red
        return $false
    }
    finally {
        $env:PGPASSWORD = ''
    }
}

function List-ApplicationTables {
    param(
        [string]$Password,
        [string]$ConnectionString
    )
    Write-Host "`n=== APPLICATION TABLES IN SCOPE ===" -ForegroundColor Cyan
    $schemaList = $appSchemas -join "','"
    $excludedList = $excludedSchemas -join "','"
    $sql = @"
SELECT
    n.nspname AS schema,
    c.relname AS table,
    CASE c.relkind
        WHEN 'r' THEN 'table'
        WHEN 'v' THEN 'view'
        WHEN 'm' THEN 'materialized view'
        WHEN 'i' THEN 'index'
        WHEN 'S' THEN 'sequence'
        WHEN 'f' THEN 'foreign table'
        ELSE c.relkind::text
    END AS type,
    pg_size_pretty(pg_total_relation_size(c.oid)) AS size
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('$schemaList')
  AND n.nspname NOT IN ('$excludedList')
  AND c.relkind IN ('r','v','m','S','f')
ORDER BY n.nspname, c.relname;
"@
    $env:PGPASSWORD = $Password
    try {
        $output = & $psqlPath -X -w -v ON_ERROR_STOP=1 --quiet -d $ConnectionString -c $sql 2>&1
        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 0) {
            Write-Host "FAIL: Cannot list application tables" -ForegroundColor Red
            Write-Host $output
            return $false
        }
        Write-Host "Tables/views/sequences in application schemas ($($appSchemas -join ', ')):"
        Write-Host $output
        return $true
    }
    catch {
        Write-Host "EXCEPTION: $_" -ForegroundColor Red
        return $false
    }
    finally {
        $env:PGPASSWORD = ""
    }
}

function Filter-RolesSql {
    param(
        [string]$InputPath,
        [string]$OutputPath
    )
    Write-Host "`n--- Filtering roles dump to exclude Supabase-managed roles ---" -ForegroundColor Cyan

    try {
        $content = Get-Content -LiteralPath $InputPath -Raw -Encoding UTF8

        # Split into statements (by semicolon) to handle multiline statements properly
        # pg_dumpall --roles-only output consists of CREATE ROLE, ALTER ROLE, GRANT, COMMENT statements
        # Each terminated by semicolon
        $statements = $content -split '(?<=;)\s*\r?\n' | Where-Object { $_ -match '\S' }

        $filteredStatements = @()
        $excludedRolePattern = '^(' + ($excludedRoles | ForEach-Object { [regex]::Escape($_) } -join '|') + ')$'

        foreach ($stmt in $statements) {
            $trimmed = $stmt.Trim()
            $keep = $true

            # Check for CREATE ROLE/USER for excluded roles
            if ($trimmed -match '^\s*CREATE\s+(ROLE|USER)\s+(\S+)') {
                $roleName = $matches[2].Trim('"')
                if ($roleName -match $excludedRolePattern) {
                    $keep = $false
                    Write-Host "  Excluding: $trimmed" -ForegroundColor Gray
                }
            }
            # Check for ALTER ROLE/USER for excluded roles
            elseif ($trimmed -match '^\s*ALTER\s+(ROLE|USER)\s+(\S+)') {
                $roleName = $matches[2].Trim('"')
                if ($roleName -match $excludedRolePattern) {
                    $keep = $false
                    Write-Host "  Excluding: $trimmed" -ForegroundColor Gray
                }
            }
            # Check for GRANT ... TO excluded_role or GRANT excluded_role TO ...
            elseif ($trimmed -match '^\s*GRANT\s+(\S+)\s+TO\s+(\S+)') {
                $grantedRole = $matches[1].Trim('"').Trim(';')
                $grantee = $matches[2].Trim('"').Trim(';')
                if ($grantee -match $excludedRolePattern -or $grantedRole -match $excludedRolePattern) {
                    $keep = $false
                    Write-Host "  Excluding: $trimmed" -ForegroundColor Gray
                }
            }
            elseif ($trimmed -match '^\s*GRANT\s+.+\s+TO\s+(\S+)') {
                $grantee = $matches[1].Trim('"').Trim(';')
                if ($grantee -match $excludedRolePattern) {
                    $keep = $false
                    Write-Host "  Excluding: $trimmed" -ForegroundColor Gray
                }
            }
            elseif ($trimmed -match '^\s*GRANT\s+(\S+)') {
                $grantedRole = $matches[1].Trim('"').Trim(';')
                if ($grantedRole -match $excludedRolePattern) {
                    $keep = $false
                    Write-Host "  Excluding: $trimmed" -ForegroundColor Gray
                }
            }
            # Check for COMMENT ON ROLE for excluded roles
            elseif ($trimmed -match '^\s*COMMENT\s+ON\s+ROLE\s+(\S+)') {
                $roleName = $matches[1].Trim('"')
                if ($roleName -match $excludedRolePattern) {
                    $keep = $false
                    Write-Host "  Excluding: $trimmed" -ForegroundColor Gray
                }
            }
            # Check for ALTER DEFAULT PRIVILEGES FOR ROLE
            elseif ($trimmed -match '^\s*ALTER\s+DEFAULT\s+PRIVILEGES\s+FOR\s+ROLE\s+(\S+)') {
                $roleName = $matches[1].Trim('"')
                if ($roleName -match $excludedRolePattern) {
                    $keep = $false
                    Write-Host "  Excluding: $trimmed" -ForegroundColor Gray
                }
            }

            if ($keep) {
                $filteredStatements += $stmt
            }
        }

        $filteredContent = $filteredStatements -join "`n`n"
        Set-Content -LiteralPath $OutputPath -Value $filteredContent -Encoding UTF8

        $originalCount = ($content -split '(?<=;)\s*\r?\n' | Where-Object { $_ -match '^\s*CREATE\s+(ROLE|USER)\s' }).Count
        $filteredCount = ($filteredContent -split '(?<=;)\s*\r?\n' | Where-Object { $_ -match '^\s*CREATE\s+(ROLE|USER)\s' }).Count
        Write-Host "  Original role definitions: $originalCount"
        Write-Host "  After filtering: $filteredCount"
        Write-Host "  Excluded: $($originalCount - $filteredCount)"

        return $true
    }
    catch {
        Write-Host "EXCEPTION during role filtering: $_" -ForegroundColor Red
        return $false
    }
}

# ======== MAIN EXECUTION ========
Write-Host "================================================================" -ForegroundColor Green
Write-Host "SHELF ILMS Production Database Backup via Supabase Pooler" -ForegroundColor Green
Write-Host "Project: khwtfjyvawukbsvyjdux (Tokyo region)" -ForegroundColor Green
Write-Host "Timestamp: $timestamp" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host ""

# Preflight checks
if (-not (Test-Prerequisites)) {
    Write-Host "`nPREFLIGHT CHECKS FAILED - ABORTING" -ForegroundColor Red
    exit 1
}

# Get password securely
$password = Get-SecurePassword

# Build the verified TLS connection string BEFORE identity verification uses it.
# Uses sslmode=verify-full with CA certificate and quoted path for spaces.
$connStr = "host=$poolerHost port=$poolerPort dbname=$database user=$poolerUser sslmode=$sslMode sslrootcert=$caCertPathLibpqQuoted connect_timeout=$connectTimeout"
# For pg_dump/pg_dumpall --dbname argument, use the same connection string format
$dbnameArg = $connStr

try {
    # Verify database identity
    if (-not (Test-DatabaseIdentity -Password $password -ConnectionString $connStr)) {
        throw "Database identity verification failed"
    }

    # List tables in scope
    if (-not (List-ApplicationTables -Password $password -ConnectionString $connStr)) {
        throw "Application table listing failed"
    }

    # Confirm before proceeding
    Write-Host "`n=== CONFIRM BACKUP SCOPE ===" -ForegroundColor Cyan
    Write-Host "The following will be backed up:" -ForegroundColor Yellow
    Write-Host "  1. ROLES (custom only, excluding Supabase-managed roles) -> pg_dumpall --roles-only --no-role-passwords (plain SQL)"
    Write-Host "  2. SCHEMA (application schemas: $($appSchemas -join ', '), EXCLUDING: $($excludedSchemas -join ', ')) -> pg_dump -Fc --schema-only"
    Write-Host "  3. DATA   (application schemas: $($appSchemas -join ', '), EXCLUDING: $($excludedSchemas -join ', ')) -> pg_dump -Fc --data-only"
    Write-Host ""
    Write-Host "Explicitly EXCLUDED (Supabase-managed):" -ForegroundColor Red
    Write-Host "  - Schemas: auth, storage, realtime, supabase_functions, pg_catalog, information_schema"
    Write-Host "  - Roles: supabase_admin, authenticator, service_role, anon, postgres, and other Supabase internal roles"
    Write-Host "  - Auth users, Storage objects, Edge Functions, Vault secrets, Project config"
    Write-Host ""
    Write-Host "SENSITIVE DATA INCLUDED (public schema):" -ForegroundColor Yellow
    Write-Host "  - password_reset_codes, login_attempt_lockouts, fine_payments" -ForegroundColor Yellow
    Write-Host "  - visitors, staff_profiles, audit_logs" -ForegroundColor Yellow
    Write-Host "  These files require owner-only filesystem ACLs and encryption at rest." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Backup directory: $backupRoot" -ForegroundColor Cyan
    Write-Host "Manifest file: $manifestPath" -ForegroundColor Cyan
    Write-Host ""

    $confirm = Read-Host "Proceed with backup? [y/N]"
    if ($confirm -notmatch '^[yY]$') {
        Write-Host "Backup cancelled by user." -ForegroundColor Yellow
        return  # Exit try block to finally
    }

    # Initialize manifest
    $manifestHeader = @"
SHELF ILMS Production Backup Manifest
=====================================
Project: khwtfjyvawukbsvyjdux (shelf-ilms)
Region: Tokyo (ap-northeast-1)
Timestamp: $timestamp
Pooler: $poolerEndpoint (session mode)
Database: $database
User: $poolerUser
Application Schemas: $($appSchemas -join ', ')
Excluded Schemas: $($excludedSchemas -join ', ')
Excluded Roles: $($excludedRoles -join ', ')
PostgreSQL Client: 18.6
Backup Tools: pg_dumpall --roles-only --no-role-passwords; pg_dump -Fc --schema-only/--data-only (custom format)
TLS: $sslMode
CA Certificate: $caCertPath
=====================================
"@
    Set-Content -Path $manifestPath -Value $manifestHeader -Encoding UTF8
    Register-CreatedFile $manifestPath
    Restrict-FilePermissions -FilePath $manifestPath

    # ======== 1. ROLES DUMP ========
    $rolesDumpRaw = Join-Path $backupRoot "shelf_roles_${timestamp}_raw.dump"
    $rolesDump = Join-Path $backupRoot "shelf_roles_$timestamp.dump"
    Register-CreatedFile $rolesDumpRaw
    Register-CreatedFile $rolesDump

    $rolesArgs = @(
        "--roles-only",
        "--no-role-passwords",
        "--file", $rolesDumpRaw,
        "--host", $poolerHost,
        "--port", $poolerPort,
        "--username", $poolerUser,
        "--dbname", $dbnameArg
    )
    if (-not (Invoke-PgCommand -ToolPath $pgDumpAllPath -Args $rolesArgs `
        -Description "ROLES DUMP (pg_dumpall --roles-only --no-role-passwords)" `
        -Password $password)) {
        throw "ROLES DUMP failed"
    }

    # Filter out Supabase-managed roles
    if (-not (Filter-RolesSql -InputPath $rolesDumpRaw -OutputPath $rolesDump)) {
        throw "ROLES FILTERING failed"
    }

    # Remove raw file only after successful filtering
    if (Test-Path -LiteralPath $rolesDumpRaw) {
        Remove-Item -LiteralPath $rolesDumpRaw -Force -ErrorAction SilentlyContinue
        $script:createdFiles = $script:createdFiles | Where-Object { $_ -ne $rolesDumpRaw }
    }

    # Validate filtered roles SQL
    if (-not (Validate-RolesSql -DumpPath $rolesDump -Description "ROLES DUMP")) {
        throw "ROLES VALIDATION failed"
    }

    # ======== 2. SCHEMA DUMP ========
    $schemaDump = Join-Path $backupRoot "shelf_schema_$timestamp.dump"
    Register-CreatedFile $schemaDump

    # Build --exclude-schema arguments
    $excludeSchemaArgs = @()
    foreach ($schema in $excludedSchemas) {
        $excludeSchemaArgs += "--exclude-schema", $schema
    }
    # Build --schema arguments for application schemas
    $schemaArgs = @()
    foreach ($schema in $appSchemas) {
        $schemaArgs += "--schema", $schema
    }

    $schemaDumpArgs = @(
        "-Fc",                    # Custom format
        "--schema-only",          # Schema only
        "--no-owner",             # Don't output ownership commands
        "--no-privileges",        # Don't output privilege commands
        "--file", $schemaDump,
        "--host", $poolerHost,
        "--port", $poolerPort,
        "--username", $poolerUser,
        "--dbname", $dbnameArg
    ) + $excludeSchemaArgs + $schemaArgs

    if (-not (Invoke-PgCommand -ToolPath $pgDumpPath -Args $schemaDumpArgs `
        -Description "SCHEMA DUMP (pg_dump -Fc --schema-only)" `
        -Password $password)) {
        throw "SCHEMA DUMP failed"
    }

    if (-not (Validate-CustomDump -DumpPath $schemaDump -Description "SCHEMA DUMP")) {
        throw "SCHEMA VALIDATION failed"
    }

    # ======== 3. DATA DUMP ========
    $dataDump = Join-Path $backupRoot "shelf_data_$timestamp.dump"
    Register-CreatedFile $dataDump

    $dataDumpArgs = @(
        "-Fc",                    # Custom format
        "--data-only",            # Data only
        "--no-owner",
        "--no-privileges",
        "--file", $dataDump,
        "--host", $poolerHost,
        "--port", $poolerPort,
        "--username", $poolerUser,
        "--dbname", $dbnameArg
    ) + $excludeSchemaArgs + $schemaArgs

    if (-not (Invoke-PgCommand -ToolPath $pgDumpPath -Args $dataDumpArgs `
        -Description "DATA DUMP (pg_dump -Fc --data-only)" `
        -Password $password)) {
        throw "DATA DUMP failed"
    }

    if (-not (Validate-CustomDump -DumpPath $dataDump -Description "DATA DUMP")) {
        throw "DATA VALIDATION failed"
    }

    # ======== FINALIZATION ========
    Write-Host "`n================================================================" -ForegroundColor Green
    Write-Host "=== BACKUP COMPLETED SUCCESSFULLY ===" -ForegroundColor Green
    Write-Host "Manifest: $manifestPath" -ForegroundColor Cyan
    Write-Host "`nBackup files created:" -ForegroundColor Cyan
    Get-ChildItem -LiteralPath $backupRoot -Filter "*_$timestamp.dump" | ForEach-Object {
        $sizeMB = [math]::Round($_.Length / 1MB, 2)
        Write-Host "  $($_.Name)  (${sizeMB} MB)"
    }
    Write-Host "`nProduction database was NOT modified." -ForegroundColor Green
    Write-Host "Docker/WSL containers and volumes were NOT touched." -ForegroundColor Green
    Write-Host "No credentials exposed in command history, logs, or output." -ForegroundColor Green
    Write-Host "`nBACKUP SCOPE LIMITATIONS:" -ForegroundColor Yellow
    Write-Host "  This backup does NOT include:" -ForegroundColor Yellow
    Write-Host "    - Auth users, sessions, MFA data (Supabase Auth)" -ForegroundColor Yellow
    Write-Host "    - Storage objects and buckets (Supabase Storage)" -ForegroundColor Yellow
    Write-Host "    - Realtime state (Supabase Realtime)" -ForegroundColor Yellow
    Write-Host "    - Edge Function source and secrets" -ForegroundColor Yellow
    Write-Host "    - Vault secrets" -ForegroundColor Yellow
    Write-Host "    - Project configuration and API keys" -ForegroundColor Yellow
    Write-Host "    - External frontend hosting configuration" -ForegroundColor Yellow
    Write-Host "`nSENSITIVE DATA PROTECTION REQUIRED:" -ForegroundColor Yellow
    Write-Host "  Backup files contain PII and auth tokens. Apply owner-only ACLs and encrypt at rest." -ForegroundColor Yellow
    Write-Host "`nNEXT STEPS (per owner checklist):" -ForegroundColor Yellow
    Write-Host "  1. Verify manifest file contents" -ForegroundColor Yellow
    Write-Host "  2. Perform restore test to a SEPARATE Supabase project" -ForegroundColor Yellow
    Write-Host "  3. Verify schema matches production" -ForegroundColor Yellow
    Write-Host "  4. Confirm backup covers required scope for rollback" -ForegroundColor Yellow
    exit 0
}
catch {
    Write-Host "`n=== BACKUP FAILED ===" -ForegroundColor Red
    Write-Host "Error: $_" -ForegroundColor Red
    Write-Host "Cleaning up partial files..." -ForegroundColor Yellow
    Cleanup-CreatedFiles
    Write-Host "`nProduction database was NOT modified." -ForegroundColor Green
    Write-Host "Docker/WSL containers and volumes were NOT touched." -ForegroundColor Green
    exit 1
}
finally {
    # ALWAYS clear password, even on success
    Clear-Password ([ref]$password)
}) {
        $parsedRef = $matches[1]
        if ($parsedRef -cne $ExpectedProjectRef) {
            throw "Target host project reference '$parsedRef' does not match expected production project reference '$ExpectedProjectRef'."
        }
        return $parsedRef
    }

    # Case B: Supabase connection pooler (format: *.pooler.supabase.com with user postgres.<project-ref>)
    if ($HostName -match '^[a-z0-9-]+\.pooler\.supabase\.com
    Write-Host "=== PREFLIGHT CHECKS ===" -ForegroundColor Cyan

    # 1. PostgreSQL binaries
    foreach ($tool in @($pgDumpPath, $pgDumpAllPath, $pgRestorePath, $psqlPath)) {
        if (-not (Test-Path -LiteralPath $tool)) {
            Write-Host "FAIL: Required tool not found: $tool" -ForegroundColor Red
            return $false
        }
    }
    Write-Host "PASS: PostgreSQL 18 binaries found"

    # 1b. TLS Certificate validation (verify-full mode)
    Write-Host "`n--- TLS Certificate Validation ---" -ForegroundColor Cyan
    if (-not (Test-Path -LiteralPath $caCertPath)) {
        Write-Host "FAIL: CA certificate not found at: $caCertPath" -ForegroundColor Red
        return $false
    }
    Write-Host "PASS: CA certificate file exists: $caCertPath"

    try {
        $cert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($caCertPath)
        Write-Host "PASS: CA certificate is readable"
        Write-Host "   Subject: $($cert.Subject)"
        Write-Host "   Issuer: $($cert.Issuer)"
        Write-Host "   Valid From: $($cert.NotBefore.ToString('yyyy-MM-dd HH:mm:ss'))"
        Write-Host "   Valid To:   $($cert.NotAfter.ToString('yyyy-MM-dd HH:mm:ss'))"
        $sha256 = [System.Security.Cryptography.SHA256]::Create().ComputeHash($cert.RawData)
        Write-Host "   SHA-256: $($sha256 -join ':')"
        if (-not $cert.HasPrivateKey) {
            Write-Host "   PASS: Certificate has no private key (expected for CA cert)"
        } else {
            Write-Host "   WARNING: Certificate has private key (unexpected for CA cert)" -ForegroundColor Yellow
        }
        # Check validity
        $now = Get-Date
        if ($now -lt $cert.NotBefore) {
            Write-Host "FAIL: Certificate not yet valid (future date)" -ForegroundColor Red
            return $false
        }
        if ($now -gt $cert.NotAfter) {
            Write-Host "FAIL: Certificate EXPIRED" -ForegroundColor Red
            return $false
        }
        Write-Host "PASS: Certificate is currently valid"
        # Show hostname that will be verified
        Write-Host "`n=== TLS MODE: $sslMode ===" -ForegroundColor Green
        Write-Host "Hostname to be verified: $poolerHost" -ForegroundColor Cyan
        Write-Host "Note: verify-full requires certificate SAN to match pooler hostname." -ForegroundColor Gray
        Write-Host "Supavisor (Supabase pooler) certs are signed by Supabase internal CA." -ForegroundColor Gray
        Write-Host "Offline inspection cannot confirm SAN match; runtime will verify." -ForegroundColor Gray
    } catch {
        Write-Host "FAIL: Cannot read/parse certificate: $_" -ForegroundColor Red
        return $false
    }

    # 2. Backup directory
    if (-not (Test-Path -LiteralPath $backupRoot)) {
        try {
            New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
            Write-Host "PASS: Created backup directory: $backupRoot"
        } catch {
            Write-Host "FAIL: Cannot create backup directory: $_" -ForegroundColor Red
            return $false
        }
    } else {
        Write-Host "PASS: Backup directory exists: $backupRoot"
    }

    # Restrict backup directory permissions to current user (Windows ACL via icacls)
    try {
        $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        icacls $backupRoot /inheritance:d | Out-Null
        icacls $backupRoot /remove:g * | Out-Null
        icacls $backupRoot /grant:r "${identity}:(OI)(CI)F" | Out-Null
        # Allow SYSTEM and Administrators to keep access (required by Windows)
        icacls $backupRoot /grant:r "NT AUTHORITY\SYSTEM:(OI)(CI)F" | Out-Null
        icacls $backupRoot /grant:r "BUILTIN\Administrators:(OI)(CI)F" | Out-Null
        $verify = icacls $backupRoot 2>&1
        $identityRegex = [regex]::Escape($identity)
        # Verify current user has full control (icacls shows as (OI)(CI)(F))
        if (-not ($verify -match "$identityRegex.*\(OI\)\(CI\)\(F\)")) {
            throw "DACL verification failed for backup directory (current user). Output: $verify"
        }
        # Verify SYSTEM has full control
        if (-not ($verify -match "NT AUTHORITY\\SYSTEM.*\(OI\)\(CI\)\(F\)")) {
            throw "DACL verification failed for backup directory (SYSTEM). Output: $verify"
        }
        # Verify Administrators have full control
        if (-not ($verify -match "BUILTIN\\Administrators.*\(OI\)\(CI\)\(F\)")) {
            throw "DACL verification failed for backup directory (Administrators). Output: $verify"
        }
        Write-Host "PASS: Backup directory DACL restricted to current user, SYSTEM, and Administrators: $identity"
    } catch {
        Write-Host "FAIL: Could not restrict backup directory permissions: $_" -ForegroundColor Red
        return $false
    }

    # 3. Disk space (require > 5 GB free)
    $driveQualifier = (Split-Path $backupRoot -Qualifier).TrimEnd(':')
    $drive = Get-PSDrive -Name $driveQualifier
    $freeGB = [math]::Round($drive.Free / 1GB, 2)
    if ($freeGB -lt 5) {
        Write-Host "FAIL: Insufficient disk space: ${freeGB} GB free (need > 5 GB)" -ForegroundColor Red
        return $false
    }
    Write-Host "PASS: Disk space: ${freeGB} GB free"

    # 4. Network connectivity to pooler (TCP port 5432)
    Write-Host "`nTesting TCP connectivity to $poolerEndpoint ..."
    $tcpTest = Test-NetConnection -ComputerName $poolerHost -Port $poolerPortInt -InformationLevel Quiet
    if (-not $tcpTest) {
        Write-Host "FAIL: Cannot reach $poolerEndpoint" -ForegroundColor Red
        return $false
    }
    Write-Host "PASS: TCP connection to pooler successful"

    # 5. DNS resolution
    try {
        $dns = Resolve-DnsName $poolerHost -Type A -ErrorAction Stop
        $aRecords = $dns | Where-Object { $_.Type -eq 'A' }
        Write-Host "PASS: DNS resolves to: $($aRecords.IP4Address -join ', ')"
    } catch {
        Write-Host "FAIL: DNS resolution failed: $_" -ForegroundColor Red
        return $false
    }

    return $true
}

function Restrict-FilePermissions {
    param([string]$FilePath)
    try {
        $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        icacls $FilePath /inheritance:d | Out-Null
        icacls $FilePath /remove:g * | Out-Null
        icacls $FilePath /grant:r "${identity}:F" | Out-Null
        # Allow SYSTEM and Administrators to keep access (required by Windows)
        icacls $FilePath /grant:r "NT AUTHORITY\SYSTEM:F" | Out-Null
        icacls $FilePath /grant:r "BUILTIN\Administrators:F" | Out-Null
        $verify = icacls $FilePath 2>&1
        # Escape identity for regex (contains backslash)
        $identityRegex = [regex]::Escape($identity)
        if (-not ($verify -match "$identityRegex.*\(F\)")) {
            throw "DACL verification failed for file (current user). Output: $verify"
        }
        if (-not ($verify -match "NT AUTHORITY\\SYSTEM.*\(F\)")) {
            throw "DACL verification failed for file (SYSTEM). Output: $verify"
        }
        if (-not ($verify -match "BUILTIN\\Administrators.*\(F\)")) {
            throw "DACL verification failed for file (Administrators). Output: $verify"
        }
        Write-Host "  PASS: File DACL restricted: $FilePath" -ForegroundColor Gray
        return $true
    } catch {
        Write-Host "  WARNING: Could not restrict file permissions: $_" -ForegroundColor Yellow
        return $false
    }
}

function Get-SecurePassword {
    Write-Host "`n=== SECURE PASSWORD ENTRY ===" -ForegroundColor Cyan
    Write-Host "Enter database password for user: $poolerUser"
    Write-Host "Input is hidden (no echo). Paste is allowed." -ForegroundColor Gray

    $secure = Read-Host -AsSecureString "Database password"
    if (-not $secure -or $secure.Length -eq 0) {
        Write-Host "FAIL: No password entered." -ForegroundColor Red
        exit 1
    }

    # Convert SecureString to plaintext ONLY for PGPASSWORD env var
    # This creates an unmanaged BSTR; we zero it immediately after use
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        $plain = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
        return $plain
    }
    finally {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
        $secure.Dispose()
    }
}

function Clear-Password {
    param([ref]$PasswordRef)
    if ($PasswordRef.Value) {
        $PasswordRef.Value = ""
        [GC]::Collect()
        [GC]::WaitForPendingFinalizers()
    }
}

function Register-CreatedFile {
    param([string]$FilePath)
    $script:createdFiles += $FilePath
}

function Cleanup-CreatedFiles {
    foreach ($file in $script:createdFiles) {
        if (Test-Path -LiteralPath $file) {
            try {
                Remove-Item -LiteralPath $file -Force -ErrorAction Stop
                Write-Host "  Cleaned up partial file: $file" -ForegroundColor Gray
            } catch {
                Write-Host "  WARNING: Failed to clean up: $file" -ForegroundColor Yellow
            }
        }
    }
    $script:createdFiles = @()
}

function Invoke-PgCommand {
    param(
        [string]$ToolPath,
        [string[]]$Args,
        [string]$Description,
        [string]$Password
    )
    Write-Host "`n--- $Description ---" -ForegroundColor Yellow
    $env:PGPASSWORD = $Password
    try {
        $output = & $ToolPath @Args 2>&1
        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 0) {
            # Sanitize output before display (remove potential connection strings)
            $sanitized = $output -replace 'password=[^\s]+', 'password=***'
            Write-Host "FAIL (exit code $exitCode)" -ForegroundColor Red
            Write-Host $sanitized
            return $false
        }
        Write-Host "PASS (exit code $exitCode)"
        return $true
    }
    catch {
        Write-Host "EXCEPTION: $_" -ForegroundColor Red
        return $false
    }
    finally {
        $env:PGPASSWORD = ""
    }
}

function Validate-CustomDump {
    param(
        [string]$DumpPath,
        [string]$Description
    )
    Write-Host "`n--- Validating $Description (custom format) ---" -ForegroundColor Cyan
    if (-not (Test-Path -LiteralPath $DumpPath)) {
        Write-Host "FAIL: Dump file not found: $DumpPath" -ForegroundColor Red
        return $false
    }

    $fileInfo = Get-Item -LiteralPath $DumpPath
    if ($fileInfo.Length -eq 0) {
        Write-Host "FAIL: Dump file is empty: $DumpPath" -ForegroundColor Red
        return $false
    }

    # Test readability with pg_restore --list (only for custom format)
    $env:PGPASSWORD = ""  # pg_restore --list doesn't need password
    try {
        $listOutput = & $pgRestorePath --list -v $DumpPath 2>&1
        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 0) {
            Write-Host "FAIL: pg_restore --list failed (exit code $exitCode)" -ForegroundColor Red
            Write-Host $listOutput
            return $false
        }

        $entryCount = ($listOutput -split "`n" | Where-Object { $_ -match '^\s*\d+;' }).Count
        $sizeMB = [math]::Round($fileInfo.Length / 1MB, 2)
        $sha256 = Get-FileHash -LiteralPath $DumpPath -Algorithm SHA256 | Select-Object -ExpandProperty Hash

        Write-Host "PASS: $Description"
        Write-Host "   File: $DumpPath"
        Write-Host "   Size: ${sizeMB} MB"
        Write-Host "   Entries: $entryCount"
        Write-Host "   SHA-256: $sha256"
        Write-Host "   Modified: $($fileInfo.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'))"

        # Append to manifest
        $manifestEntry = @"
=== $Description ===
File: $DumpPath
Size: ${sizeMB} MB
Entries: $entryCount
SHA-256: $sha256
Timestamp: $($fileInfo.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'))
"@
        Add-Content -Path $manifestPath -Value $manifestEntry -Encoding UTF8

        # Restrict file permissions to current user only
        Restrict-FilePermissions -FilePath $DumpPath

        return $true
    }
    catch {
        Write-Host "EXCEPTION during validation: $_" -ForegroundColor Red
        return $false
    }
}

function Validate-RolesSql {
    param(
        [string]$DumpPath,
        [string]$Description
    )
    Write-Host "`n--- Validating $Description (plain SQL) ---" -ForegroundColor Cyan
    if (-not (Test-Path -LiteralPath $DumpPath)) {
        Write-Host "FAIL: Dump file not found: $DumpPath" -ForegroundColor Red
        return $false
    }

    $fileInfo = Get-Item -LiteralPath $DumpPath
    if ($fileInfo.Length -eq 0) {
        Write-Host "FAIL: Dump file is empty: $DumpPath" -ForegroundColor Red
        return $false
    }

    # Basic validation: check it's valid SQL with role definitions
    # Also verify no excluded roles remain
    try {
        $content = Get-Content -LiteralPath $DumpPath -Raw -Encoding UTF8
        # pg_dumpall outputs role names with double quotes, count both quoted and unquoted
        $roleCount = ($content -split "`n" | Where-Object { $_ -match '^\s*CREATE\s+ROLE\s+"' -or $_ -match '^\s*CREATE\s+ROLE\s+\w' -or $_ -match '^\s*CREATE\s+USER\s+"' -or $_ -match '^\s*CREATE\s+USER\s+\w' }).Count

        # Verify excluded roles are not present
        $excludedFound = @()
        foreach ($role in $excludedRoles) {
            # pg_dumpall outputs role names with double quotes
            $pattern = 'CREATE\s+(ROLE|USER)\s+"' + [regex]::Escape($role) + '"'
            if ($content -match $pattern) {
                $excludedFound += $role
            }
        }
        if ($excludedFound.Count -gt 0) {
            Write-Host "FAIL: Excluded roles found in filtered output: $($excludedFound -join ', ')" -ForegroundColor Red
            return $false
        }

        $sizeMB = [math]::Round($fileInfo.Length / 1MB, 2)
        $sha256 = Get-FileHash -LiteralPath $DumpPath -Algorithm SHA256 | Select-Object -ExpandProperty Hash

        Write-Host "PASS: $Description"
        Write-Host "   File: $DumpPath"
        Write-Host "   Size: ${sizeMB} MB"
        Write-Host "   Role definitions found: $roleCount"
        Write-Host "   Excluded roles verified absent: $($excludedRoles.Count)"
        Write-Host "   SHA-256: $sha256"
        Write-Host "   Modified: $($fileInfo.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'))"

        # Append to manifest
        $manifestEntry = @"
=== $Description ===
File: $DumpPath
Size: ${sizeMB} MB
Role definitions: $roleCount
Excluded roles verified absent: $($excludedRoles.Count)
SHA-256: $sha256
Timestamp: $($fileInfo.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'))
"@
        Add-Content -Path $manifestPath -Value $manifestEntry -Encoding UTF8

        # Restrict file permissions to current user only
        Restrict-FilePermissions -FilePath $DumpPath

        return $true
    }
    catch {
        Write-Host "EXCEPTION during validation: $_" -ForegroundColor Red
        return $false
    }
}

function Test-DatabaseIdentity {
    param(
        [string]$Password,
        [string]$ConnectionString
    )
    Write-Host "`n=== DATABASE IDENTITY & PROJECT VERIFICATION ===" -ForegroundColor Cyan
    $expectedProjectRef = "khwtfjyvawukbsvyjdux"
    if ($poolerUser -notmatch [regex]::Escape($expectedProjectRef)) {
        Write-Host "FAIL: Configured pooler user does not match the expected production project reference '$expectedProjectRef'." -ForegroundColor Red
        return $false
    }

    $sql = @"
SELECT current_database(), current_user, session_user, version(),
       (SELECT pg_catalog.count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('shelf_attendance_rpc_owner', 'shelf_book_reviews_rpc_owner')),
       (SELECT pg_catalog.count(*) FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename IN ('visitors', 'libraries', 'books'));
"@
    $env:PGPASSWORD = $Password
    try {
        $output = & $psqlPath -X -w -v ON_ERROR_STOP=1 --quiet -A -t -F '|' -d $ConnectionString -c $sql 2>&1
        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 0) {
            $reason = 'psql returned a nonzero exit code'
            if ($output -match '(?i)certificate|ssl|tls') { $reason = 'TLS certificate or hostname verification failed' }
            elseif ($output -match '(?i)password authentication|authentication failed|no password supplied') { $reason = 'database authentication failed' }
            elseif ($output -match '(?i)syntax error|does not exist|permission denied') { $reason = 'identity query execution failed' }
            Write-Host "FAIL: Database identity query failed ($reason; exit code $exitCode). Raw psql output was suppressed." -ForegroundColor Red
            return $false
        }
        $rows = @($output | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
        if ($rows.Count -ne 1) {
            Write-Host 'FAIL: Identity query returned empty or malformed output.' -ForegroundColor Red
            return $false
        }
        $fields = ([string]$rows[0]).Trim() -split '\|', 6
        if ($fields.Count -ne 6 -or [string]::IsNullOrWhiteSpace($fields[3])) {
            Write-Host 'FAIL: Identity query returned empty or malformed output.' -ForegroundColor Red
            return $false
        }
        $expectedDatabase = 'postgres'
        $expectedRole = 'postgres'
        if ($fields[0] -cne $expectedDatabase -or $fields[1] -cne $expectedRole -or $fields[2] -cne $expectedRole) {
            Write-Host 'FAIL: Connected database or role does not match the intended production identity.' -ForegroundColor Red
            Write-Host "Observed database='$($fields[0])', current_user='$($fields[1])', session_user='$($fields[2])'"
            return $false
        }

        # Project fingerprint check: verify custom SHELF roles and core tables
        $roleMatches = [int]($fields[4] || 0)
        $tableMatches = [int]($fields[5] || 0)
        if ($roleMatches -lt 1 -or $tableMatches -lt 1) {
            Write-Host 'FAIL: Target database lacks SHELF ILMS project schema fingerprint (roles/tables mismatch).' -ForegroundColor Red
            return $false
        }

        Write-Host "PASS: Verified project ref '$expectedProjectRef', database '$expectedDatabase', role '$expectedRole', TLS mode '$sslMode'."
        Write-Host "PASS: Verified SHELF ILMS schema fingerprint (found $roleMatches dedicated roles, $tableMatches core tables)."
        Write-Host "Database engine: $($fields[3])"
        return $true
    }
    catch {
        Write-Host 'FAIL: Identity verification encountered a local process or output handling error; details suppressed.' -ForegroundColor Red
        return $false
    }
    finally {
        $env:PGPASSWORD = ''
    }
}

function List-ApplicationTables {
    param(
        [string]$Password,
        [string]$ConnectionString
    )
    Write-Host "`n=== APPLICATION TABLES IN SCOPE ===" -ForegroundColor Cyan
    $schemaList = $appSchemas -join "','"
    $excludedList = $excludedSchemas -join "','"
    $sql = @"
SELECT
    n.nspname AS schema,
    c.relname AS table,
    CASE c.relkind
        WHEN 'r' THEN 'table'
        WHEN 'v' THEN 'view'
        WHEN 'm' THEN 'materialized view'
        WHEN 'i' THEN 'index'
        WHEN 'S' THEN 'sequence'
        WHEN 'f' THEN 'foreign table'
        ELSE c.relkind::text
    END AS type,
    pg_size_pretty(pg_total_relation_size(c.oid)) AS size
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('$schemaList')
  AND n.nspname NOT IN ('$excludedList')
  AND c.relkind IN ('r','v','m','S','f')
ORDER BY n.nspname, c.relname;
"@
    $env:PGPASSWORD = $Password
    try {
        $output = & $psqlPath -X -w -v ON_ERROR_STOP=1 --quiet -d $ConnectionString -c $sql 2>&1
        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 0) {
            Write-Host "FAIL: Cannot list application tables" -ForegroundColor Red
            Write-Host $output
            return $false
        }
        Write-Host "Tables/views/sequences in application schemas ($($appSchemas -join ', ')):"
        Write-Host $output
        return $true
    }
    catch {
        Write-Host "EXCEPTION: $_" -ForegroundColor Red
        return $false
    }
    finally {
        $env:PGPASSWORD = ""
    }
}

function Filter-RolesSql {
    param(
        [string]$InputPath,
        [string]$OutputPath
    )
    Write-Host "`n--- Filtering roles dump to exclude Supabase-managed roles ---" -ForegroundColor Cyan

    try {
        $content = Get-Content -LiteralPath $InputPath -Raw -Encoding UTF8

        # Split into statements (by semicolon) to handle multiline statements properly
        # pg_dumpall --roles-only output consists of CREATE ROLE, ALTER ROLE, GRANT, COMMENT statements
        # Each terminated by semicolon
        $statements = $content -split '(?<=;)\s*\r?\n' | Where-Object { $_ -match '\S' }

        $filteredStatements = @()
        $excludedRolePattern = '^(' + ($excludedRoles | ForEach-Object { [regex]::Escape($_) } -join '|') + ')$'

        foreach ($stmt in $statements) {
            $trimmed = $stmt.Trim()
            $keep = $true

            # Check for CREATE ROLE/USER for excluded roles
            if ($trimmed -match '^\s*CREATE\s+(ROLE|USER)\s+(\S+)') {
                $roleName = $matches[2].Trim('"')
                if ($roleName -match $excludedRolePattern) {
                    $keep = $false
                    Write-Host "  Excluding: $trimmed" -ForegroundColor Gray
                }
            }
            # Check for ALTER ROLE/USER for excluded roles
            elseif ($trimmed -match '^\s*ALTER\s+(ROLE|USER)\s+(\S+)') {
                $roleName = $matches[2].Trim('"')
                if ($roleName -match $excludedRolePattern) {
                    $keep = $false
                    Write-Host "  Excluding: $trimmed" -ForegroundColor Gray
                }
            }
            # Check for GRANT ... TO excluded_role or GRANT excluded_role TO ...
            elseif ($trimmed -match '^\s*GRANT\s+(\S+)\s+TO\s+(\S+)') {
                $grantedRole = $matches[1].Trim('"').Trim(';')
                $grantee = $matches[2].Trim('"').Trim(';')
                if ($grantee -match $excludedRolePattern -or $grantedRole -match $excludedRolePattern) {
                    $keep = $false
                    Write-Host "  Excluding: $trimmed" -ForegroundColor Gray
                }
            }
            elseif ($trimmed -match '^\s*GRANT\s+.+\s+TO\s+(\S+)') {
                $grantee = $matches[1].Trim('"').Trim(';')
                if ($grantee -match $excludedRolePattern) {
                    $keep = $false
                    Write-Host "  Excluding: $trimmed" -ForegroundColor Gray
                }
            }
            elseif ($trimmed -match '^\s*GRANT\s+(\S+)') {
                $grantedRole = $matches[1].Trim('"').Trim(';')
                if ($grantedRole -match $excludedRolePattern) {
                    $keep = $false
                    Write-Host "  Excluding: $trimmed" -ForegroundColor Gray
                }
            }
            # Check for COMMENT ON ROLE for excluded roles
            elseif ($trimmed -match '^\s*COMMENT\s+ON\s+ROLE\s+(\S+)') {
                $roleName = $matches[1].Trim('"')
                if ($roleName -match $excludedRolePattern) {
                    $keep = $false
                    Write-Host "  Excluding: $trimmed" -ForegroundColor Gray
                }
            }
            # Check for ALTER DEFAULT PRIVILEGES FOR ROLE
            elseif ($trimmed -match '^\s*ALTER\s+DEFAULT\s+PRIVILEGES\s+FOR\s+ROLE\s+(\S+)') {
                $roleName = $matches[1].Trim('"')
                if ($roleName -match $excludedRolePattern) {
                    $keep = $false
                    Write-Host "  Excluding: $trimmed" -ForegroundColor Gray
                }
            }

            if ($keep) {
                $filteredStatements += $stmt
            }
        }

        $filteredContent = $filteredStatements -join "`n`n"
        Set-Content -LiteralPath $OutputPath -Value $filteredContent -Encoding UTF8

        $originalCount = ($content -split '(?<=;)\s*\r?\n' | Where-Object { $_ -match '^\s*CREATE\s+(ROLE|USER)\s' }).Count
        $filteredCount = ($filteredContent -split '(?<=;)\s*\r?\n' | Where-Object { $_ -match '^\s*CREATE\s+(ROLE|USER)\s' }).Count
        Write-Host "  Original role definitions: $originalCount"
        Write-Host "  After filtering: $filteredCount"
        Write-Host "  Excluded: $($originalCount - $filteredCount)"

        return $true
    }
    catch {
        Write-Host "EXCEPTION during role filtering: $_" -ForegroundColor Red
        return $false
    }
}

# ======== MAIN EXECUTION ========
Write-Host "================================================================" -ForegroundColor Green
Write-Host "SHELF ILMS Production Database Backup via Supabase Pooler" -ForegroundColor Green
Write-Host "Project: khwtfjyvawukbsvyjdux (Tokyo region)" -ForegroundColor Green
Write-Host "Timestamp: $timestamp" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host ""

# Preflight checks
if (-not (Test-Prerequisites)) {
    Write-Host "`nPREFLIGHT CHECKS FAILED - ABORTING" -ForegroundColor Red
    exit 1
}

# Get password securely
$password = Get-SecurePassword

# Build the verified TLS connection string BEFORE identity verification uses it.
# Uses sslmode=verify-full with CA certificate and quoted path for spaces.
$connStr = "host=$poolerHost port=$poolerPort dbname=$database user=$poolerUser sslmode=$sslMode sslrootcert=$caCertPathLibpqQuoted connect_timeout=$connectTimeout"
# For pg_dump/pg_dumpall --dbname argument, use the same connection string format
$dbnameArg = $connStr

try {
    # Verify database identity
    if (-not (Test-DatabaseIdentity -Password $password -ConnectionString $connStr)) {
        throw "Database identity verification failed"
    }

    # List tables in scope
    if (-not (List-ApplicationTables -Password $password -ConnectionString $connStr)) {
        throw "Application table listing failed"
    }

    # Confirm before proceeding
    Write-Host "`n=== CONFIRM BACKUP SCOPE ===" -ForegroundColor Cyan
    Write-Host "The following will be backed up:" -ForegroundColor Yellow
    Write-Host "  1. ROLES (custom only, excluding Supabase-managed roles) -> pg_dumpall --roles-only --no-role-passwords (plain SQL)"
    Write-Host "  2. SCHEMA (application schemas: $($appSchemas -join ', '), EXCLUDING: $($excludedSchemas -join ', ')) -> pg_dump -Fc --schema-only"
    Write-Host "  3. DATA   (application schemas: $($appSchemas -join ', '), EXCLUDING: $($excludedSchemas -join ', ')) -> pg_dump -Fc --data-only"
    Write-Host ""
    Write-Host "Explicitly EXCLUDED (Supabase-managed):" -ForegroundColor Red
    Write-Host "  - Schemas: auth, storage, realtime, supabase_functions, pg_catalog, information_schema"
    Write-Host "  - Roles: supabase_admin, authenticator, service_role, anon, postgres, and other Supabase internal roles"
    Write-Host "  - Auth users, Storage objects, Edge Functions, Vault secrets, Project config"
    Write-Host ""
    Write-Host "SENSITIVE DATA INCLUDED (public schema):" -ForegroundColor Yellow
    Write-Host "  - password_reset_codes, login_attempt_lockouts, fine_payments" -ForegroundColor Yellow
    Write-Host "  - visitors, staff_profiles, audit_logs" -ForegroundColor Yellow
    Write-Host "  These files require owner-only filesystem ACLs and encryption at rest." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Backup directory: $backupRoot" -ForegroundColor Cyan
    Write-Host "Manifest file: $manifestPath" -ForegroundColor Cyan
    Write-Host ""

    $confirm = Read-Host "Proceed with backup? [y/N]"
    if ($confirm -notmatch '^[yY]$') {
        Write-Host "Backup cancelled by user." -ForegroundColor Yellow
        return  # Exit try block to finally
    }

    # Initialize manifest
    $manifestHeader = @"
SHELF ILMS Production Backup Manifest
=====================================
Project: khwtfjyvawukbsvyjdux (shelf-ilms)
Region: Tokyo (ap-northeast-1)
Timestamp: $timestamp
Pooler: $poolerEndpoint (session mode)
Database: $database
User: $poolerUser
Application Schemas: $($appSchemas -join ', ')
Excluded Schemas: $($excludedSchemas -join ', ')
Excluded Roles: $($excludedRoles -join ', ')
PostgreSQL Client: 18.6
Backup Tools: pg_dumpall --roles-only --no-role-passwords; pg_dump -Fc --schema-only/--data-only (custom format)
TLS: $sslMode
CA Certificate: $caCertPath
=====================================
"@
    Set-Content -Path $manifestPath -Value $manifestHeader -Encoding UTF8
    Register-CreatedFile $manifestPath
    Restrict-FilePermissions -FilePath $manifestPath

    # ======== 1. ROLES DUMP ========
    $rolesDumpRaw = Join-Path $backupRoot "shelf_roles_${timestamp}_raw.dump"
    $rolesDump = Join-Path $backupRoot "shelf_roles_$timestamp.dump"
    Register-CreatedFile $rolesDumpRaw
    Register-CreatedFile $rolesDump

    $rolesArgs = @(
        "--roles-only",
        "--no-role-passwords",
        "--file", $rolesDumpRaw,
        "--host", $poolerHost,
        "--port", $poolerPort,
        "--username", $poolerUser,
        "--dbname", $dbnameArg
    )
    if (-not (Invoke-PgCommand -ToolPath $pgDumpAllPath -Args $rolesArgs `
        -Description "ROLES DUMP (pg_dumpall --roles-only --no-role-passwords)" `
        -Password $password)) {
        throw "ROLES DUMP failed"
    }

    # Filter out Supabase-managed roles
    if (-not (Filter-RolesSql -InputPath $rolesDumpRaw -OutputPath $rolesDump)) {
        throw "ROLES FILTERING failed"
    }

    # Remove raw file only after successful filtering
    if (Test-Path -LiteralPath $rolesDumpRaw) {
        Remove-Item -LiteralPath $rolesDumpRaw -Force -ErrorAction SilentlyContinue
        $script:createdFiles = $script:createdFiles | Where-Object { $_ -ne $rolesDumpRaw }
    }

    # Validate filtered roles SQL
    if (-not (Validate-RolesSql -DumpPath $rolesDump -Description "ROLES DUMP")) {
        throw "ROLES VALIDATION failed"
    }

    # ======== 2. SCHEMA DUMP ========
    $schemaDump = Join-Path $backupRoot "shelf_schema_$timestamp.dump"
    Register-CreatedFile $schemaDump

    # Build --exclude-schema arguments
    $excludeSchemaArgs = @()
    foreach ($schema in $excludedSchemas) {
        $excludeSchemaArgs += "--exclude-schema", $schema
    }
    # Build --schema arguments for application schemas
    $schemaArgs = @()
    foreach ($schema in $appSchemas) {
        $schemaArgs += "--schema", $schema
    }

    $schemaDumpArgs = @(
        "-Fc",                    # Custom format
        "--schema-only",          # Schema only
        "--no-owner",             # Don't output ownership commands
        "--no-privileges",        # Don't output privilege commands
        "--file", $schemaDump,
        "--host", $poolerHost,
        "--port", $poolerPort,
        "--username", $poolerUser,
        "--dbname", $dbnameArg
    ) + $excludeSchemaArgs + $schemaArgs

    if (-not (Invoke-PgCommand -ToolPath $pgDumpPath -Args $schemaDumpArgs `
        -Description "SCHEMA DUMP (pg_dump -Fc --schema-only)" `
        -Password $password)) {
        throw "SCHEMA DUMP failed"
    }

    if (-not (Validate-CustomDump -DumpPath $schemaDump -Description "SCHEMA DUMP")) {
        throw "SCHEMA VALIDATION failed"
    }

    # ======== 3. DATA DUMP ========
    $dataDump = Join-Path $backupRoot "shelf_data_$timestamp.dump"
    Register-CreatedFile $dataDump

    $dataDumpArgs = @(
        "-Fc",                    # Custom format
        "--data-only",            # Data only
        "--no-owner",
        "--no-privileges",
        "--file", $dataDump,
        "--host", $poolerHost,
        "--port", $poolerPort,
        "--username", $poolerUser,
        "--dbname", $dbnameArg
    ) + $excludeSchemaArgs + $schemaArgs

    if (-not (Invoke-PgCommand -ToolPath $pgDumpPath -Args $dataDumpArgs `
        -Description "DATA DUMP (pg_dump -Fc --data-only)" `
        -Password $password)) {
        throw "DATA DUMP failed"
    }

    if (-not (Validate-CustomDump -DumpPath $dataDump -Description "DATA DUMP")) {
        throw "DATA VALIDATION failed"
    }

    # ======== FINALIZATION ========
    Write-Host "`n================================================================" -ForegroundColor Green
    Write-Host "=== BACKUP COMPLETED SUCCESSFULLY ===" -ForegroundColor Green
    Write-Host "Manifest: $manifestPath" -ForegroundColor Cyan
    Write-Host "`nBackup files created:" -ForegroundColor Cyan
    Get-ChildItem -LiteralPath $backupRoot -Filter "*_$timestamp.dump" | ForEach-Object {
        $sizeMB = [math]::Round($_.Length / 1MB, 2)
        Write-Host "  $($_.Name)  (${sizeMB} MB)"
    }
    Write-Host "`nProduction database was NOT modified." -ForegroundColor Green
    Write-Host "Docker/WSL containers and volumes were NOT touched." -ForegroundColor Green
    Write-Host "No credentials exposed in command history, logs, or output." -ForegroundColor Green
    Write-Host "`nBACKUP SCOPE LIMITATIONS:" -ForegroundColor Yellow
    Write-Host "  This backup does NOT include:" -ForegroundColor Yellow
    Write-Host "    - Auth users, sessions, MFA data (Supabase Auth)" -ForegroundColor Yellow
    Write-Host "    - Storage objects and buckets (Supabase Storage)" -ForegroundColor Yellow
    Write-Host "    - Realtime state (Supabase Realtime)" -ForegroundColor Yellow
    Write-Host "    - Edge Function source and secrets" -ForegroundColor Yellow
    Write-Host "    - Vault secrets" -ForegroundColor Yellow
    Write-Host "    - Project configuration and API keys" -ForegroundColor Yellow
    Write-Host "    - External frontend hosting configuration" -ForegroundColor Yellow
    Write-Host "`nSENSITIVE DATA PROTECTION REQUIRED:" -ForegroundColor Yellow
    Write-Host "  Backup files contain PII and auth tokens. Apply owner-only ACLs and encrypt at rest." -ForegroundColor Yellow
    Write-Host "`nNEXT STEPS (per owner checklist):" -ForegroundColor Yellow
    Write-Host "  1. Verify manifest file contents" -ForegroundColor Yellow
    Write-Host "  2. Perform restore test to a SEPARATE Supabase project" -ForegroundColor Yellow
    Write-Host "  3. Verify schema matches production" -ForegroundColor Yellow
    Write-Host "  4. Confirm backup covers required scope for rollback" -ForegroundColor Yellow
    exit 0
}
catch {
    Write-Host "`n=== BACKUP FAILED ===" -ForegroundColor Red
    Write-Host "Error: $_" -ForegroundColor Red
    Write-Host "Cleaning up partial files..." -ForegroundColor Yellow
    Cleanup-CreatedFiles
    Write-Host "`nProduction database was NOT modified." -ForegroundColor Green
    Write-Host "Docker/WSL containers and volumes were NOT touched." -ForegroundColor Green
    exit 1
}
finally {
    # ALWAYS clear password, even on success
    Clear-Password ([ref]$password)
}) {
        if ($UserName -match '^postgres\.([a-z0-9]{20})
    Write-Host "=== PREFLIGHT CHECKS ===" -ForegroundColor Cyan

    # 1. PostgreSQL binaries
    foreach ($tool in @($pgDumpPath, $pgDumpAllPath, $pgRestorePath, $psqlPath)) {
        if (-not (Test-Path -LiteralPath $tool)) {
            Write-Host "FAIL: Required tool not found: $tool" -ForegroundColor Red
            return $false
        }
    }
    Write-Host "PASS: PostgreSQL 18 binaries found"

    # 1b. TLS Certificate validation (verify-full mode)
    Write-Host "`n--- TLS Certificate Validation ---" -ForegroundColor Cyan
    if (-not (Test-Path -LiteralPath $caCertPath)) {
        Write-Host "FAIL: CA certificate not found at: $caCertPath" -ForegroundColor Red
        return $false
    }
    Write-Host "PASS: CA certificate file exists: $caCertPath"

    try {
        $cert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($caCertPath)
        Write-Host "PASS: CA certificate is readable"
        Write-Host "   Subject: $($cert.Subject)"
        Write-Host "   Issuer: $($cert.Issuer)"
        Write-Host "   Valid From: $($cert.NotBefore.ToString('yyyy-MM-dd HH:mm:ss'))"
        Write-Host "   Valid To:   $($cert.NotAfter.ToString('yyyy-MM-dd HH:mm:ss'))"
        $sha256 = [System.Security.Cryptography.SHA256]::Create().ComputeHash($cert.RawData)
        Write-Host "   SHA-256: $($sha256 -join ':')"
        if (-not $cert.HasPrivateKey) {
            Write-Host "   PASS: Certificate has no private key (expected for CA cert)"
        } else {
            Write-Host "   WARNING: Certificate has private key (unexpected for CA cert)" -ForegroundColor Yellow
        }
        # Check validity
        $now = Get-Date
        if ($now -lt $cert.NotBefore) {
            Write-Host "FAIL: Certificate not yet valid (future date)" -ForegroundColor Red
            return $false
        }
        if ($now -gt $cert.NotAfter) {
            Write-Host "FAIL: Certificate EXPIRED" -ForegroundColor Red
            return $false
        }
        Write-Host "PASS: Certificate is currently valid"
        # Show hostname that will be verified
        Write-Host "`n=== TLS MODE: $sslMode ===" -ForegroundColor Green
        Write-Host "Hostname to be verified: $poolerHost" -ForegroundColor Cyan
        Write-Host "Note: verify-full requires certificate SAN to match pooler hostname." -ForegroundColor Gray
        Write-Host "Supavisor (Supabase pooler) certs are signed by Supabase internal CA." -ForegroundColor Gray
        Write-Host "Offline inspection cannot confirm SAN match; runtime will verify." -ForegroundColor Gray
    } catch {
        Write-Host "FAIL: Cannot read/parse certificate: $_" -ForegroundColor Red
        return $false
    }

    # 2. Backup directory
    if (-not (Test-Path -LiteralPath $backupRoot)) {
        try {
            New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
            Write-Host "PASS: Created backup directory: $backupRoot"
        } catch {
            Write-Host "FAIL: Cannot create backup directory: $_" -ForegroundColor Red
            return $false
        }
    } else {
        Write-Host "PASS: Backup directory exists: $backupRoot"
    }

    # Restrict backup directory permissions to current user (Windows ACL via icacls)
    try {
        $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        icacls $backupRoot /inheritance:d | Out-Null
        icacls $backupRoot /remove:g * | Out-Null
        icacls $backupRoot /grant:r "${identity}:(OI)(CI)F" | Out-Null
        # Allow SYSTEM and Administrators to keep access (required by Windows)
        icacls $backupRoot /grant:r "NT AUTHORITY\SYSTEM:(OI)(CI)F" | Out-Null
        icacls $backupRoot /grant:r "BUILTIN\Administrators:(OI)(CI)F" | Out-Null
        $verify = icacls $backupRoot 2>&1
        $identityRegex = [regex]::Escape($identity)
        # Verify current user has full control (icacls shows as (OI)(CI)(F))
        if (-not ($verify -match "$identityRegex.*\(OI\)\(CI\)\(F\)")) {
            throw "DACL verification failed for backup directory (current user). Output: $verify"
        }
        # Verify SYSTEM has full control
        if (-not ($verify -match "NT AUTHORITY\\SYSTEM.*\(OI\)\(CI\)\(F\)")) {
            throw "DACL verification failed for backup directory (SYSTEM). Output: $verify"
        }
        # Verify Administrators have full control
        if (-not ($verify -match "BUILTIN\\Administrators.*\(OI\)\(CI\)\(F\)")) {
            throw "DACL verification failed for backup directory (Administrators). Output: $verify"
        }
        Write-Host "PASS: Backup directory DACL restricted to current user, SYSTEM, and Administrators: $identity"
    } catch {
        Write-Host "FAIL: Could not restrict backup directory permissions: $_" -ForegroundColor Red
        return $false
    }

    # 3. Disk space (require > 5 GB free)
    $driveQualifier = (Split-Path $backupRoot -Qualifier).TrimEnd(':')
    $drive = Get-PSDrive -Name $driveQualifier
    $freeGB = [math]::Round($drive.Free / 1GB, 2)
    if ($freeGB -lt 5) {
        Write-Host "FAIL: Insufficient disk space: ${freeGB} GB free (need > 5 GB)" -ForegroundColor Red
        return $false
    }
    Write-Host "PASS: Disk space: ${freeGB} GB free"

    # 4. Network connectivity to pooler (TCP port 5432)
    Write-Host "`nTesting TCP connectivity to $poolerEndpoint ..."
    $tcpTest = Test-NetConnection -ComputerName $poolerHost -Port $poolerPortInt -InformationLevel Quiet
    if (-not $tcpTest) {
        Write-Host "FAIL: Cannot reach $poolerEndpoint" -ForegroundColor Red
        return $false
    }
    Write-Host "PASS: TCP connection to pooler successful"

    # 5. DNS resolution
    try {
        $dns = Resolve-DnsName $poolerHost -Type A -ErrorAction Stop
        $aRecords = $dns | Where-Object { $_.Type -eq 'A' }
        Write-Host "PASS: DNS resolves to: $($aRecords.IP4Address -join ', ')"
    } catch {
        Write-Host "FAIL: DNS resolution failed: $_" -ForegroundColor Red
        return $false
    }

    return $true
}

function Restrict-FilePermissions {
    param([string]$FilePath)
    try {
        $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        icacls $FilePath /inheritance:d | Out-Null
        icacls $FilePath /remove:g * | Out-Null
        icacls $FilePath /grant:r "${identity}:F" | Out-Null
        # Allow SYSTEM and Administrators to keep access (required by Windows)
        icacls $FilePath /grant:r "NT AUTHORITY\SYSTEM:F" | Out-Null
        icacls $FilePath /grant:r "BUILTIN\Administrators:F" | Out-Null
        $verify = icacls $FilePath 2>&1
        # Escape identity for regex (contains backslash)
        $identityRegex = [regex]::Escape($identity)
        if (-not ($verify -match "$identityRegex.*\(F\)")) {
            throw "DACL verification failed for file (current user). Output: $verify"
        }
        if (-not ($verify -match "NT AUTHORITY\\SYSTEM.*\(F\)")) {
            throw "DACL verification failed for file (SYSTEM). Output: $verify"
        }
        if (-not ($verify -match "BUILTIN\\Administrators.*\(F\)")) {
            throw "DACL verification failed for file (Administrators). Output: $verify"
        }
        Write-Host "  PASS: File DACL restricted: $FilePath" -ForegroundColor Gray
        return $true
    } catch {
        Write-Host "  WARNING: Could not restrict file permissions: $_" -ForegroundColor Yellow
        return $false
    }
}

function Get-SecurePassword {
    Write-Host "`n=== SECURE PASSWORD ENTRY ===" -ForegroundColor Cyan
    Write-Host "Enter database password for user: $poolerUser"
    Write-Host "Input is hidden (no echo). Paste is allowed." -ForegroundColor Gray

    $secure = Read-Host -AsSecureString "Database password"
    if (-not $secure -or $secure.Length -eq 0) {
        Write-Host "FAIL: No password entered." -ForegroundColor Red
        exit 1
    }

    # Convert SecureString to plaintext ONLY for PGPASSWORD env var
    # This creates an unmanaged BSTR; we zero it immediately after use
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        $plain = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
        return $plain
    }
    finally {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
        $secure.Dispose()
    }
}

function Clear-Password {
    param([ref]$PasswordRef)
    if ($PasswordRef.Value) {
        $PasswordRef.Value = ""
        [GC]::Collect()
        [GC]::WaitForPendingFinalizers()
    }
}

function Register-CreatedFile {
    param([string]$FilePath)
    $script:createdFiles += $FilePath
}

function Cleanup-CreatedFiles {
    foreach ($file in $script:createdFiles) {
        if (Test-Path -LiteralPath $file) {
            try {
                Remove-Item -LiteralPath $file -Force -ErrorAction Stop
                Write-Host "  Cleaned up partial file: $file" -ForegroundColor Gray
            } catch {
                Write-Host "  WARNING: Failed to clean up: $file" -ForegroundColor Yellow
            }
        }
    }
    $script:createdFiles = @()
}

function Invoke-PgCommand {
    param(
        [string]$ToolPath,
        [string[]]$Args,
        [string]$Description,
        [string]$Password
    )
    Write-Host "`n--- $Description ---" -ForegroundColor Yellow
    $env:PGPASSWORD = $Password
    try {
        $output = & $ToolPath @Args 2>&1
        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 0) {
            # Sanitize output before display (remove potential connection strings)
            $sanitized = $output -replace 'password=[^\s]+', 'password=***'
            Write-Host "FAIL (exit code $exitCode)" -ForegroundColor Red
            Write-Host $sanitized
            return $false
        }
        Write-Host "PASS (exit code $exitCode)"
        return $true
    }
    catch {
        Write-Host "EXCEPTION: $_" -ForegroundColor Red
        return $false
    }
    finally {
        $env:PGPASSWORD = ""
    }
}

function Validate-CustomDump {
    param(
        [string]$DumpPath,
        [string]$Description
    )
    Write-Host "`n--- Validating $Description (custom format) ---" -ForegroundColor Cyan
    if (-not (Test-Path -LiteralPath $DumpPath)) {
        Write-Host "FAIL: Dump file not found: $DumpPath" -ForegroundColor Red
        return $false
    }

    $fileInfo = Get-Item -LiteralPath $DumpPath
    if ($fileInfo.Length -eq 0) {
        Write-Host "FAIL: Dump file is empty: $DumpPath" -ForegroundColor Red
        return $false
    }

    # Test readability with pg_restore --list (only for custom format)
    $env:PGPASSWORD = ""  # pg_restore --list doesn't need password
    try {
        $listOutput = & $pgRestorePath --list -v $DumpPath 2>&1
        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 0) {
            Write-Host "FAIL: pg_restore --list failed (exit code $exitCode)" -ForegroundColor Red
            Write-Host $listOutput
            return $false
        }

        $entryCount = ($listOutput -split "`n" | Where-Object { $_ -match '^\s*\d+;' }).Count
        $sizeMB = [math]::Round($fileInfo.Length / 1MB, 2)
        $sha256 = Get-FileHash -LiteralPath $DumpPath -Algorithm SHA256 | Select-Object -ExpandProperty Hash

        Write-Host "PASS: $Description"
        Write-Host "   File: $DumpPath"
        Write-Host "   Size: ${sizeMB} MB"
        Write-Host "   Entries: $entryCount"
        Write-Host "   SHA-256: $sha256"
        Write-Host "   Modified: $($fileInfo.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'))"

        # Append to manifest
        $manifestEntry = @"
=== $Description ===
File: $DumpPath
Size: ${sizeMB} MB
Entries: $entryCount
SHA-256: $sha256
Timestamp: $($fileInfo.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'))
"@
        Add-Content -Path $manifestPath -Value $manifestEntry -Encoding UTF8

        # Restrict file permissions to current user only
        Restrict-FilePermissions -FilePath $DumpPath

        return $true
    }
    catch {
        Write-Host "EXCEPTION during validation: $_" -ForegroundColor Red
        return $false
    }
}

function Validate-RolesSql {
    param(
        [string]$DumpPath,
        [string]$Description
    )
    Write-Host "`n--- Validating $Description (plain SQL) ---" -ForegroundColor Cyan
    if (-not (Test-Path -LiteralPath $DumpPath)) {
        Write-Host "FAIL: Dump file not found: $DumpPath" -ForegroundColor Red
        return $false
    }

    $fileInfo = Get-Item -LiteralPath $DumpPath
    if ($fileInfo.Length -eq 0) {
        Write-Host "FAIL: Dump file is empty: $DumpPath" -ForegroundColor Red
        return $false
    }

    # Basic validation: check it's valid SQL with role definitions
    # Also verify no excluded roles remain
    try {
        $content = Get-Content -LiteralPath $DumpPath -Raw -Encoding UTF8
        # pg_dumpall outputs role names with double quotes, count both quoted and unquoted
        $roleCount = ($content -split "`n" | Where-Object { $_ -match '^\s*CREATE\s+ROLE\s+"' -or $_ -match '^\s*CREATE\s+ROLE\s+\w' -or $_ -match '^\s*CREATE\s+USER\s+"' -or $_ -match '^\s*CREATE\s+USER\s+\w' }).Count

        # Verify excluded roles are not present
        $excludedFound = @()
        foreach ($role in $excludedRoles) {
            # pg_dumpall outputs role names with double quotes
            $pattern = 'CREATE\s+(ROLE|USER)\s+"' + [regex]::Escape($role) + '"'
            if ($content -match $pattern) {
                $excludedFound += $role
            }
        }
        if ($excludedFound.Count -gt 0) {
            Write-Host "FAIL: Excluded roles found in filtered output: $($excludedFound -join ', ')" -ForegroundColor Red
            return $false
        }

        $sizeMB = [math]::Round($fileInfo.Length / 1MB, 2)
        $sha256 = Get-FileHash -LiteralPath $DumpPath -Algorithm SHA256 | Select-Object -ExpandProperty Hash

        Write-Host "PASS: $Description"
        Write-Host "   File: $DumpPath"
        Write-Host "   Size: ${sizeMB} MB"
        Write-Host "   Role definitions found: $roleCount"
        Write-Host "   Excluded roles verified absent: $($excludedRoles.Count)"
        Write-Host "   SHA-256: $sha256"
        Write-Host "   Modified: $($fileInfo.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'))"

        # Append to manifest
        $manifestEntry = @"
=== $Description ===
File: $DumpPath
Size: ${sizeMB} MB
Role definitions: $roleCount
Excluded roles verified absent: $($excludedRoles.Count)
SHA-256: $sha256
Timestamp: $($fileInfo.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'))
"@
        Add-Content -Path $manifestPath -Value $manifestEntry -Encoding UTF8

        # Restrict file permissions to current user only
        Restrict-FilePermissions -FilePath $DumpPath

        return $true
    }
    catch {
        Write-Host "EXCEPTION during validation: $_" -ForegroundColor Red
        return $false
    }
}

function Test-DatabaseIdentity {
    param(
        [string]$Password,
        [string]$ConnectionString
    )
    Write-Host "`n=== DATABASE IDENTITY & PROJECT VERIFICATION ===" -ForegroundColor Cyan
    $expectedProjectRef = "khwtfjyvawukbsvyjdux"
    if ($poolerUser -notmatch [regex]::Escape($expectedProjectRef)) {
        Write-Host "FAIL: Configured pooler user does not match the expected production project reference '$expectedProjectRef'." -ForegroundColor Red
        return $false
    }

    $sql = @"
SELECT current_database(), current_user, session_user, version(),
       (SELECT pg_catalog.count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('shelf_attendance_rpc_owner', 'shelf_book_reviews_rpc_owner')),
       (SELECT pg_catalog.count(*) FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename IN ('visitors', 'libraries', 'books'));
"@
    $env:PGPASSWORD = $Password
    try {
        $output = & $psqlPath -X -w -v ON_ERROR_STOP=1 --quiet -A -t -F '|' -d $ConnectionString -c $sql 2>&1
        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 0) {
            $reason = 'psql returned a nonzero exit code'
            if ($output -match '(?i)certificate|ssl|tls') { $reason = 'TLS certificate or hostname verification failed' }
            elseif ($output -match '(?i)password authentication|authentication failed|no password supplied') { $reason = 'database authentication failed' }
            elseif ($output -match '(?i)syntax error|does not exist|permission denied') { $reason = 'identity query execution failed' }
            Write-Host "FAIL: Database identity query failed ($reason; exit code $exitCode). Raw psql output was suppressed." -ForegroundColor Red
            return $false
        }
        $rows = @($output | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
        if ($rows.Count -ne 1) {
            Write-Host 'FAIL: Identity query returned empty or malformed output.' -ForegroundColor Red
            return $false
        }
        $fields = ([string]$rows[0]).Trim() -split '\|', 6
        if ($fields.Count -ne 6 -or [string]::IsNullOrWhiteSpace($fields[3])) {
            Write-Host 'FAIL: Identity query returned empty or malformed output.' -ForegroundColor Red
            return $false
        }
        $expectedDatabase = 'postgres'
        $expectedRole = 'postgres'
        if ($fields[0] -cne $expectedDatabase -or $fields[1] -cne $expectedRole -or $fields[2] -cne $expectedRole) {
            Write-Host 'FAIL: Connected database or role does not match the intended production identity.' -ForegroundColor Red
            Write-Host "Observed database='$($fields[0])', current_user='$($fields[1])', session_user='$($fields[2])'"
            return $false
        }

        # Project fingerprint check: verify custom SHELF roles and core tables
        $roleMatches = [int]($fields[4] || 0)
        $tableMatches = [int]($fields[5] || 0)
        if ($roleMatches -lt 1 -or $tableMatches -lt 1) {
            Write-Host 'FAIL: Target database lacks SHELF ILMS project schema fingerprint (roles/tables mismatch).' -ForegroundColor Red
            return $false
        }

        Write-Host "PASS: Verified project ref '$expectedProjectRef', database '$expectedDatabase', role '$expectedRole', TLS mode '$sslMode'."
        Write-Host "PASS: Verified SHELF ILMS schema fingerprint (found $roleMatches dedicated roles, $tableMatches core tables)."
        Write-Host "Database engine: $($fields[3])"
        return $true
    }
    catch {
        Write-Host 'FAIL: Identity verification encountered a local process or output handling error; details suppressed.' -ForegroundColor Red
        return $false
    }
    finally {
        $env:PGPASSWORD = ''
    }
}

function List-ApplicationTables {
    param(
        [string]$Password,
        [string]$ConnectionString
    )
    Write-Host "`n=== APPLICATION TABLES IN SCOPE ===" -ForegroundColor Cyan
    $schemaList = $appSchemas -join "','"
    $excludedList = $excludedSchemas -join "','"
    $sql = @"
SELECT
    n.nspname AS schema,
    c.relname AS table,
    CASE c.relkind
        WHEN 'r' THEN 'table'
        WHEN 'v' THEN 'view'
        WHEN 'm' THEN 'materialized view'
        WHEN 'i' THEN 'index'
        WHEN 'S' THEN 'sequence'
        WHEN 'f' THEN 'foreign table'
        ELSE c.relkind::text
    END AS type,
    pg_size_pretty(pg_total_relation_size(c.oid)) AS size
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('$schemaList')
  AND n.nspname NOT IN ('$excludedList')
  AND c.relkind IN ('r','v','m','S','f')
ORDER BY n.nspname, c.relname;
"@
    $env:PGPASSWORD = $Password
    try {
        $output = & $psqlPath -X -w -v ON_ERROR_STOP=1 --quiet -d $ConnectionString -c $sql 2>&1
        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 0) {
            Write-Host "FAIL: Cannot list application tables" -ForegroundColor Red
            Write-Host $output
            return $false
        }
        Write-Host "Tables/views/sequences in application schemas ($($appSchemas -join ', ')):"
        Write-Host $output
        return $true
    }
    catch {
        Write-Host "EXCEPTION: $_" -ForegroundColor Red
        return $false
    }
    finally {
        $env:PGPASSWORD = ""
    }
}

function Filter-RolesSql {
    param(
        [string]$InputPath,
        [string]$OutputPath
    )
    Write-Host "`n--- Filtering roles dump to exclude Supabase-managed roles ---" -ForegroundColor Cyan

    try {
        $content = Get-Content -LiteralPath $InputPath -Raw -Encoding UTF8

        # Split into statements (by semicolon) to handle multiline statements properly
        # pg_dumpall --roles-only output consists of CREATE ROLE, ALTER ROLE, GRANT, COMMENT statements
        # Each terminated by semicolon
        $statements = $content -split '(?<=;)\s*\r?\n' | Where-Object { $_ -match '\S' }

        $filteredStatements = @()
        $excludedRolePattern = '^(' + ($excludedRoles | ForEach-Object { [regex]::Escape($_) } -join '|') + ')$'

        foreach ($stmt in $statements) {
            $trimmed = $stmt.Trim()
            $keep = $true

            # Check for CREATE ROLE/USER for excluded roles
            if ($trimmed -match '^\s*CREATE\s+(ROLE|USER)\s+(\S+)') {
                $roleName = $matches[2].Trim('"')
                if ($roleName -match $excludedRolePattern) {
                    $keep = $false
                    Write-Host "  Excluding: $trimmed" -ForegroundColor Gray
                }
            }
            # Check for ALTER ROLE/USER for excluded roles
            elseif ($trimmed -match '^\s*ALTER\s+(ROLE|USER)\s+(\S+)') {
                $roleName = $matches[2].Trim('"')
                if ($roleName -match $excludedRolePattern) {
                    $keep = $false
                    Write-Host "  Excluding: $trimmed" -ForegroundColor Gray
                }
            }
            # Check for GRANT ... TO excluded_role or GRANT excluded_role TO ...
            elseif ($trimmed -match '^\s*GRANT\s+(\S+)\s+TO\s+(\S+)') {
                $grantedRole = $matches[1].Trim('"').Trim(';')
                $grantee = $matches[2].Trim('"').Trim(';')
                if ($grantee -match $excludedRolePattern -or $grantedRole -match $excludedRolePattern) {
                    $keep = $false
                    Write-Host "  Excluding: $trimmed" -ForegroundColor Gray
                }
            }
            elseif ($trimmed -match '^\s*GRANT\s+.+\s+TO\s+(\S+)') {
                $grantee = $matches[1].Trim('"').Trim(';')
                if ($grantee -match $excludedRolePattern) {
                    $keep = $false
                    Write-Host "  Excluding: $trimmed" -ForegroundColor Gray
                }
            }
            elseif ($trimmed -match '^\s*GRANT\s+(\S+)') {
                $grantedRole = $matches[1].Trim('"').Trim(';')
                if ($grantedRole -match $excludedRolePattern) {
                    $keep = $false
                    Write-Host "  Excluding: $trimmed" -ForegroundColor Gray
                }
            }
            # Check for COMMENT ON ROLE for excluded roles
            elseif ($trimmed -match '^\s*COMMENT\s+ON\s+ROLE\s+(\S+)') {
                $roleName = $matches[1].Trim('"')
                if ($roleName -match $excludedRolePattern) {
                    $keep = $false
                    Write-Host "  Excluding: $trimmed" -ForegroundColor Gray
                }
            }
            # Check for ALTER DEFAULT PRIVILEGES FOR ROLE
            elseif ($trimmed -match '^\s*ALTER\s+DEFAULT\s+PRIVILEGES\s+FOR\s+ROLE\s+(\S+)') {
                $roleName = $matches[1].Trim('"')
                if ($roleName -match $excludedRolePattern) {
                    $keep = $false
                    Write-Host "  Excluding: $trimmed" -ForegroundColor Gray
                }
            }

            if ($keep) {
                $filteredStatements += $stmt
            }
        }

        $filteredContent = $filteredStatements -join "`n`n"
        Set-Content -LiteralPath $OutputPath -Value $filteredContent -Encoding UTF8

        $originalCount = ($content -split '(?<=;)\s*\r?\n' | Where-Object { $_ -match '^\s*CREATE\s+(ROLE|USER)\s' }).Count
        $filteredCount = ($filteredContent -split '(?<=;)\s*\r?\n' | Where-Object { $_ -match '^\s*CREATE\s+(ROLE|USER)\s' }).Count
        Write-Host "  Original role definitions: $originalCount"
        Write-Host "  After filtering: $filteredCount"
        Write-Host "  Excluded: $($originalCount - $filteredCount)"

        return $true
    }
    catch {
        Write-Host "EXCEPTION during role filtering: $_" -ForegroundColor Red
        return $false
    }
}

# ======== MAIN EXECUTION ========
Write-Host "================================================================" -ForegroundColor Green
Write-Host "SHELF ILMS Production Database Backup via Supabase Pooler" -ForegroundColor Green
Write-Host "Project: khwtfjyvawukbsvyjdux (Tokyo region)" -ForegroundColor Green
Write-Host "Timestamp: $timestamp" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host ""

# Preflight checks
if (-not (Test-Prerequisites)) {
    Write-Host "`nPREFLIGHT CHECKS FAILED - ABORTING" -ForegroundColor Red
    exit 1
}

# Get password securely
$password = Get-SecurePassword

# Build the verified TLS connection string BEFORE identity verification uses it.
# Uses sslmode=verify-full with CA certificate and quoted path for spaces.
$connStr = "host=$poolerHost port=$poolerPort dbname=$database user=$poolerUser sslmode=$sslMode sslrootcert=$caCertPathLibpqQuoted connect_timeout=$connectTimeout"
# For pg_dump/pg_dumpall --dbname argument, use the same connection string format
$dbnameArg = $connStr

try {
    # Verify database identity
    if (-not (Test-DatabaseIdentity -Password $password -ConnectionString $connStr)) {
        throw "Database identity verification failed"
    }

    # List tables in scope
    if (-not (List-ApplicationTables -Password $password -ConnectionString $connStr)) {
        throw "Application table listing failed"
    }

    # Confirm before proceeding
    Write-Host "`n=== CONFIRM BACKUP SCOPE ===" -ForegroundColor Cyan
    Write-Host "The following will be backed up:" -ForegroundColor Yellow
    Write-Host "  1. ROLES (custom only, excluding Supabase-managed roles) -> pg_dumpall --roles-only --no-role-passwords (plain SQL)"
    Write-Host "  2. SCHEMA (application schemas: $($appSchemas -join ', '), EXCLUDING: $($excludedSchemas -join ', ')) -> pg_dump -Fc --schema-only"
    Write-Host "  3. DATA   (application schemas: $($appSchemas -join ', '), EXCLUDING: $($excludedSchemas -join ', ')) -> pg_dump -Fc --data-only"
    Write-Host ""
    Write-Host "Explicitly EXCLUDED (Supabase-managed):" -ForegroundColor Red
    Write-Host "  - Schemas: auth, storage, realtime, supabase_functions, pg_catalog, information_schema"
    Write-Host "  - Roles: supabase_admin, authenticator, service_role, anon, postgres, and other Supabase internal roles"
    Write-Host "  - Auth users, Storage objects, Edge Functions, Vault secrets, Project config"
    Write-Host ""
    Write-Host "SENSITIVE DATA INCLUDED (public schema):" -ForegroundColor Yellow
    Write-Host "  - password_reset_codes, login_attempt_lockouts, fine_payments" -ForegroundColor Yellow
    Write-Host "  - visitors, staff_profiles, audit_logs" -ForegroundColor Yellow
    Write-Host "  These files require owner-only filesystem ACLs and encryption at rest." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Backup directory: $backupRoot" -ForegroundColor Cyan
    Write-Host "Manifest file: $manifestPath" -ForegroundColor Cyan
    Write-Host ""

    $confirm = Read-Host "Proceed with backup? [y/N]"
    if ($confirm -notmatch '^[yY]$') {
        Write-Host "Backup cancelled by user." -ForegroundColor Yellow
        return  # Exit try block to finally
    }

    # Initialize manifest
    $manifestHeader = @"
SHELF ILMS Production Backup Manifest
=====================================
Project: khwtfjyvawukbsvyjdux (shelf-ilms)
Region: Tokyo (ap-northeast-1)
Timestamp: $timestamp
Pooler: $poolerEndpoint (session mode)
Database: $database
User: $poolerUser
Application Schemas: $($appSchemas -join ', ')
Excluded Schemas: $($excludedSchemas -join ', ')
Excluded Roles: $($excludedRoles -join ', ')
PostgreSQL Client: 18.6
Backup Tools: pg_dumpall --roles-only --no-role-passwords; pg_dump -Fc --schema-only/--data-only (custom format)
TLS: $sslMode
CA Certificate: $caCertPath
=====================================
"@
    Set-Content -Path $manifestPath -Value $manifestHeader -Encoding UTF8
    Register-CreatedFile $manifestPath
    Restrict-FilePermissions -FilePath $manifestPath

    # ======== 1. ROLES DUMP ========
    $rolesDumpRaw = Join-Path $backupRoot "shelf_roles_${timestamp}_raw.dump"
    $rolesDump = Join-Path $backupRoot "shelf_roles_$timestamp.dump"
    Register-CreatedFile $rolesDumpRaw
    Register-CreatedFile $rolesDump

    $rolesArgs = @(
        "--roles-only",
        "--no-role-passwords",
        "--file", $rolesDumpRaw,
        "--host", $poolerHost,
        "--port", $poolerPort,
        "--username", $poolerUser,
        "--dbname", $dbnameArg
    )
    if (-not (Invoke-PgCommand -ToolPath $pgDumpAllPath -Args $rolesArgs `
        -Description "ROLES DUMP (pg_dumpall --roles-only --no-role-passwords)" `
        -Password $password)) {
        throw "ROLES DUMP failed"
    }

    # Filter out Supabase-managed roles
    if (-not (Filter-RolesSql -InputPath $rolesDumpRaw -OutputPath $rolesDump)) {
        throw "ROLES FILTERING failed"
    }

    # Remove raw file only after successful filtering
    if (Test-Path -LiteralPath $rolesDumpRaw) {
        Remove-Item -LiteralPath $rolesDumpRaw -Force -ErrorAction SilentlyContinue
        $script:createdFiles = $script:createdFiles | Where-Object { $_ -ne $rolesDumpRaw }
    }

    # Validate filtered roles SQL
    if (-not (Validate-RolesSql -DumpPath $rolesDump -Description "ROLES DUMP")) {
        throw "ROLES VALIDATION failed"
    }

    # ======== 2. SCHEMA DUMP ========
    $schemaDump = Join-Path $backupRoot "shelf_schema_$timestamp.dump"
    Register-CreatedFile $schemaDump

    # Build --exclude-schema arguments
    $excludeSchemaArgs = @()
    foreach ($schema in $excludedSchemas) {
        $excludeSchemaArgs += "--exclude-schema", $schema
    }
    # Build --schema arguments for application schemas
    $schemaArgs = @()
    foreach ($schema in $appSchemas) {
        $schemaArgs += "--schema", $schema
    }

    $schemaDumpArgs = @(
        "-Fc",                    # Custom format
        "--schema-only",          # Schema only
        "--no-owner",             # Don't output ownership commands
        "--no-privileges",        # Don't output privilege commands
        "--file", $schemaDump,
        "--host", $poolerHost,
        "--port", $poolerPort,
        "--username", $poolerUser,
        "--dbname", $dbnameArg
    ) + $excludeSchemaArgs + $schemaArgs

    if (-not (Invoke-PgCommand -ToolPath $pgDumpPath -Args $schemaDumpArgs `
        -Description "SCHEMA DUMP (pg_dump -Fc --schema-only)" `
        -Password $password)) {
        throw "SCHEMA DUMP failed"
    }

    if (-not (Validate-CustomDump -DumpPath $schemaDump -Description "SCHEMA DUMP")) {
        throw "SCHEMA VALIDATION failed"
    }

    # ======== 3. DATA DUMP ========
    $dataDump = Join-Path $backupRoot "shelf_data_$timestamp.dump"
    Register-CreatedFile $dataDump

    $dataDumpArgs = @(
        "-Fc",                    # Custom format
        "--data-only",            # Data only
        "--no-owner",
        "--no-privileges",
        "--file", $dataDump,
        "--host", $poolerHost,
        "--port", $poolerPort,
        "--username", $poolerUser,
        "--dbname", $dbnameArg
    ) + $excludeSchemaArgs + $schemaArgs

    if (-not (Invoke-PgCommand -ToolPath $pgDumpPath -Args $dataDumpArgs `
        -Description "DATA DUMP (pg_dump -Fc --data-only)" `
        -Password $password)) {
        throw "DATA DUMP failed"
    }

    if (-not (Validate-CustomDump -DumpPath $dataDump -Description "DATA DUMP")) {
        throw "DATA VALIDATION failed"
    }

    # ======== FINALIZATION ========
    Write-Host "`n================================================================" -ForegroundColor Green
    Write-Host "=== BACKUP COMPLETED SUCCESSFULLY ===" -ForegroundColor Green
    Write-Host "Manifest: $manifestPath" -ForegroundColor Cyan
    Write-Host "`nBackup files created:" -ForegroundColor Cyan
    Get-ChildItem -LiteralPath $backupRoot -Filter "*_$timestamp.dump" | ForEach-Object {
        $sizeMB = [math]::Round($_.Length / 1MB, 2)
        Write-Host "  $($_.Name)  (${sizeMB} MB)"
    }
    Write-Host "`nProduction database was NOT modified." -ForegroundColor Green
    Write-Host "Docker/WSL containers and volumes were NOT touched." -ForegroundColor Green
    Write-Host "No credentials exposed in command history, logs, or output." -ForegroundColor Green
    Write-Host "`nBACKUP SCOPE LIMITATIONS:" -ForegroundColor Yellow
    Write-Host "  This backup does NOT include:" -ForegroundColor Yellow
    Write-Host "    - Auth users, sessions, MFA data (Supabase Auth)" -ForegroundColor Yellow
    Write-Host "    - Storage objects and buckets (Supabase Storage)" -ForegroundColor Yellow
    Write-Host "    - Realtime state (Supabase Realtime)" -ForegroundColor Yellow
    Write-Host "    - Edge Function source and secrets" -ForegroundColor Yellow
    Write-Host "    - Vault secrets" -ForegroundColor Yellow
    Write-Host "    - Project configuration and API keys" -ForegroundColor Yellow
    Write-Host "    - External frontend hosting configuration" -ForegroundColor Yellow
    Write-Host "`nSENSITIVE DATA PROTECTION REQUIRED:" -ForegroundColor Yellow
    Write-Host "  Backup files contain PII and auth tokens. Apply owner-only ACLs and encrypt at rest." -ForegroundColor Yellow
    Write-Host "`nNEXT STEPS (per owner checklist):" -ForegroundColor Yellow
    Write-Host "  1. Verify manifest file contents" -ForegroundColor Yellow
    Write-Host "  2. Perform restore test to a SEPARATE Supabase project" -ForegroundColor Yellow
    Write-Host "  3. Verify schema matches production" -ForegroundColor Yellow
    Write-Host "  4. Confirm backup covers required scope for rollback" -ForegroundColor Yellow
    exit 0
}
catch {
    Write-Host "`n=== BACKUP FAILED ===" -ForegroundColor Red
    Write-Host "Error: $_" -ForegroundColor Red
    Write-Host "Cleaning up partial files..." -ForegroundColor Yellow
    Cleanup-CreatedFiles
    Write-Host "`nProduction database was NOT modified." -ForegroundColor Green
    Write-Host "Docker/WSL containers and volumes were NOT touched." -ForegroundColor Green
    exit 1
}
finally {
    # ALWAYS clear password, even on success
    Clear-Password ([ref]$password)
}) {
            $parsedRef = $matches[1]
            if ($parsedRef -cne $ExpectedProjectRef) {
                throw "Pooler user project reference '$parsedRef' does not match expected production project reference '$ExpectedProjectRef'."
            }
            return $parsedRef
        } else {
            throw "Malformed pooler username '$UserName'. Expected format: postgres.<project-ref> (20 alphanumeric characters)."
        }
    }

    # Any other host format is rejected (fail-closed)
    throw "Untrusted or unrecognized database endpoint '$HostName'. Target host must be a valid Supabase pooler (*.pooler.supabase.com) or direct host (db.<project-ref>.supabase.co)."
}

function Test-Prerequisites {
    Write-Host "=== PREFLIGHT CHECKS ===" -ForegroundColor Cyan

    # 1. PostgreSQL binaries
    foreach ($tool in @($pgDumpPath, $pgDumpAllPath, $pgRestorePath, $psqlPath)) {
        if (-not (Test-Path -LiteralPath $tool)) {
            Write-Host "FAIL: Required tool not found: $tool" -ForegroundColor Red
            return $false
        }
    }
    Write-Host "PASS: PostgreSQL 18 binaries found"

    # 1b. TLS Certificate validation (verify-full mode)
    Write-Host "`n--- TLS Certificate Validation ---" -ForegroundColor Cyan
    if (-not (Test-Path -LiteralPath $caCertPath)) {
        Write-Host "FAIL: CA certificate not found at: $caCertPath" -ForegroundColor Red
        return $false
    }
    Write-Host "PASS: CA certificate file exists: $caCertPath"

    try {
        $cert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($caCertPath)
        Write-Host "PASS: CA certificate is readable"
        Write-Host "   Subject: $($cert.Subject)"
        Write-Host "   Issuer: $($cert.Issuer)"
        Write-Host "   Valid From: $($cert.NotBefore.ToString('yyyy-MM-dd HH:mm:ss'))"
        Write-Host "   Valid To:   $($cert.NotAfter.ToString('yyyy-MM-dd HH:mm:ss'))"
        $sha256 = [System.Security.Cryptography.SHA256]::Create().ComputeHash($cert.RawData)
        Write-Host "   SHA-256: $($sha256 -join ':')"
        if (-not $cert.HasPrivateKey) {
            Write-Host "   PASS: Certificate has no private key (expected for CA cert)"
        } else {
            Write-Host "   WARNING: Certificate has private key (unexpected for CA cert)" -ForegroundColor Yellow
        }
        # Check validity
        $now = Get-Date
        if ($now -lt $cert.NotBefore) {
            Write-Host "FAIL: Certificate not yet valid (future date)" -ForegroundColor Red
            return $false
        }
        if ($now -gt $cert.NotAfter) {
            Write-Host "FAIL: Certificate EXPIRED" -ForegroundColor Red
            return $false
        }
        Write-Host "PASS: Certificate is currently valid"
        # Show hostname that will be verified
        Write-Host "`n=== TLS MODE: $sslMode ===" -ForegroundColor Green
        Write-Host "Hostname to be verified: $poolerHost" -ForegroundColor Cyan
        Write-Host "Note: verify-full requires certificate SAN to match pooler hostname." -ForegroundColor Gray
        Write-Host "Supavisor (Supabase pooler) certs are signed by Supabase internal CA." -ForegroundColor Gray
        Write-Host "Offline inspection cannot confirm SAN match; runtime will verify." -ForegroundColor Gray
    } catch {
        Write-Host "FAIL: Cannot read/parse certificate: $_" -ForegroundColor Red
        return $false
    }

    # 2. Backup directory
    if (-not (Test-Path -LiteralPath $backupRoot)) {
        try {
            New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
            Write-Host "PASS: Created backup directory: $backupRoot"
        } catch {
            Write-Host "FAIL: Cannot create backup directory: $_" -ForegroundColor Red
            return $false
        }
    } else {
        Write-Host "PASS: Backup directory exists: $backupRoot"
    }

    # Restrict backup directory permissions to current user (Windows ACL via icacls)
    try {
        $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        icacls $backupRoot /inheritance:d | Out-Null
        icacls $backupRoot /remove:g * | Out-Null
        icacls $backupRoot /grant:r "${identity}:(OI)(CI)F" | Out-Null
        # Allow SYSTEM and Administrators to keep access (required by Windows)
        icacls $backupRoot /grant:r "NT AUTHORITY\SYSTEM:(OI)(CI)F" | Out-Null
        icacls $backupRoot /grant:r "BUILTIN\Administrators:(OI)(CI)F" | Out-Null
        $verify = icacls $backupRoot 2>&1
        $identityRegex = [regex]::Escape($identity)
        # Verify current user has full control (icacls shows as (OI)(CI)(F))
        if (-not ($verify -match "$identityRegex.*\(OI\)\(CI\)\(F\)")) {
            throw "DACL verification failed for backup directory (current user). Output: $verify"
        }
        # Verify SYSTEM has full control
        if (-not ($verify -match "NT AUTHORITY\\SYSTEM.*\(OI\)\(CI\)\(F\)")) {
            throw "DACL verification failed for backup directory (SYSTEM). Output: $verify"
        }
        # Verify Administrators have full control
        if (-not ($verify -match "BUILTIN\\Administrators.*\(OI\)\(CI\)\(F\)")) {
            throw "DACL verification failed for backup directory (Administrators). Output: $verify"
        }
        Write-Host "PASS: Backup directory DACL restricted to current user, SYSTEM, and Administrators: $identity"
    } catch {
        Write-Host "FAIL: Could not restrict backup directory permissions: $_" -ForegroundColor Red
        return $false
    }

    # 3. Disk space (require > 5 GB free)
    $driveQualifier = (Split-Path $backupRoot -Qualifier).TrimEnd(':')
    $drive = Get-PSDrive -Name $driveQualifier
    $freeGB = [math]::Round($drive.Free / 1GB, 2)
    if ($freeGB -lt 5) {
        Write-Host "FAIL: Insufficient disk space: ${freeGB} GB free (need > 5 GB)" -ForegroundColor Red
        return $false
    }
    Write-Host "PASS: Disk space: ${freeGB} GB free"

    # 4. Network connectivity to pooler (TCP port 5432)
    Write-Host "`nTesting TCP connectivity to $poolerEndpoint ..."
    $tcpTest = Test-NetConnection -ComputerName $poolerHost -Port $poolerPortInt -InformationLevel Quiet
    if (-not $tcpTest) {
        Write-Host "FAIL: Cannot reach $poolerEndpoint" -ForegroundColor Red
        return $false
    }
    Write-Host "PASS: TCP connection to pooler successful"

    # 5. DNS resolution
    try {
        $dns = Resolve-DnsName $poolerHost -Type A -ErrorAction Stop
        $aRecords = $dns | Where-Object { $_.Type -eq 'A' }
        Write-Host "PASS: DNS resolves to: $($aRecords.IP4Address -join ', ')"
    } catch {
        Write-Host "FAIL: DNS resolution failed: $_" -ForegroundColor Red
        return $false
    }

    return $true
}

function Restrict-FilePermissions {
    param([string]$FilePath)
    try {
        $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        icacls $FilePath /inheritance:d | Out-Null
        icacls $FilePath /remove:g * | Out-Null
        icacls $FilePath /grant:r "${identity}:F" | Out-Null
        # Allow SYSTEM and Administrators to keep access (required by Windows)
        icacls $FilePath /grant:r "NT AUTHORITY\SYSTEM:F" | Out-Null
        icacls $FilePath /grant:r "BUILTIN\Administrators:F" | Out-Null
        $verify = icacls $FilePath 2>&1
        # Escape identity for regex (contains backslash)
        $identityRegex = [regex]::Escape($identity)
        if (-not ($verify -match "$identityRegex.*\(F\)")) {
            throw "DACL verification failed for file (current user). Output: $verify"
        }
        if (-not ($verify -match "NT AUTHORITY\\SYSTEM.*\(F\)")) {
            throw "DACL verification failed for file (SYSTEM). Output: $verify"
        }
        if (-not ($verify -match "BUILTIN\\Administrators.*\(F\)")) {
            throw "DACL verification failed for file (Administrators). Output: $verify"
        }
        Write-Host "  PASS: File DACL restricted: $FilePath" -ForegroundColor Gray
        return $true
    } catch {
        Write-Host "  WARNING: Could not restrict file permissions: $_" -ForegroundColor Yellow
        return $false
    }
}

function Get-SecurePassword {
    Write-Host "`n=== SECURE PASSWORD ENTRY ===" -ForegroundColor Cyan
    Write-Host "Enter database password for user: $poolerUser"
    Write-Host "Input is hidden (no echo). Paste is allowed." -ForegroundColor Gray

    $secure = Read-Host -AsSecureString "Database password"
    if (-not $secure -or $secure.Length -eq 0) {
        Write-Host "FAIL: No password entered." -ForegroundColor Red
        exit 1
    }

    # Convert SecureString to plaintext ONLY for PGPASSWORD env var
    # This creates an unmanaged BSTR; we zero it immediately after use
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        $plain = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
        return $plain
    }
    finally {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
        $secure.Dispose()
    }
}

function Clear-Password {
    param([ref]$PasswordRef)
    if ($PasswordRef.Value) {
        $PasswordRef.Value = ""
        [GC]::Collect()
        [GC]::WaitForPendingFinalizers()
    }
}

function Register-CreatedFile {
    param([string]$FilePath)
    $script:createdFiles += $FilePath
}

function Cleanup-CreatedFiles {
    foreach ($file in $script:createdFiles) {
        if (Test-Path -LiteralPath $file) {
            try {
                Remove-Item -LiteralPath $file -Force -ErrorAction Stop
                Write-Host "  Cleaned up partial file: $file" -ForegroundColor Gray
            } catch {
                Write-Host "  WARNING: Failed to clean up: $file" -ForegroundColor Yellow
            }
        }
    }
    $script:createdFiles = @()
}

function Invoke-PgCommand {
    param(
        [string]$ToolPath,
        [string[]]$Args,
        [string]$Description,
        [string]$Password
    )
    Write-Host "`n--- $Description ---" -ForegroundColor Yellow
    $env:PGPASSWORD = $Password
    try {
        $output = & $ToolPath @Args 2>&1
        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 0) {
            # Sanitize output before display (remove potential connection strings)
            $sanitized = $output -replace 'password=[^\s]+', 'password=***'
            Write-Host "FAIL (exit code $exitCode)" -ForegroundColor Red
            Write-Host $sanitized
            return $false
        }
        Write-Host "PASS (exit code $exitCode)"
        return $true
    }
    catch {
        Write-Host "EXCEPTION: $_" -ForegroundColor Red
        return $false
    }
    finally {
        $env:PGPASSWORD = ""
    }
}

function Validate-CustomDump {
    param(
        [string]$DumpPath,
        [string]$Description
    )
    Write-Host "`n--- Validating $Description (custom format) ---" -ForegroundColor Cyan
    if (-not (Test-Path -LiteralPath $DumpPath)) {
        Write-Host "FAIL: Dump file not found: $DumpPath" -ForegroundColor Red
        return $false
    }

    $fileInfo = Get-Item -LiteralPath $DumpPath
    if ($fileInfo.Length -eq 0) {
        Write-Host "FAIL: Dump file is empty: $DumpPath" -ForegroundColor Red
        return $false
    }

    # Test readability with pg_restore --list (only for custom format)
    $env:PGPASSWORD = ""  # pg_restore --list doesn't need password
    try {
        $listOutput = & $pgRestorePath --list -v $DumpPath 2>&1
        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 0) {
            Write-Host "FAIL: pg_restore --list failed (exit code $exitCode)" -ForegroundColor Red
            Write-Host $listOutput
            return $false
        }

        $entryCount = ($listOutput -split "`n" | Where-Object { $_ -match '^\s*\d+;' }).Count
        $sizeMB = [math]::Round($fileInfo.Length / 1MB, 2)
        $sha256 = Get-FileHash -LiteralPath $DumpPath -Algorithm SHA256 | Select-Object -ExpandProperty Hash

        Write-Host "PASS: $Description"
        Write-Host "   File: $DumpPath"
        Write-Host "   Size: ${sizeMB} MB"
        Write-Host "   Entries: $entryCount"
        Write-Host "   SHA-256: $sha256"
        Write-Host "   Modified: $($fileInfo.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'))"

        # Append to manifest
        $manifestEntry = @"
=== $Description ===
File: $DumpPath
Size: ${sizeMB} MB
Entries: $entryCount
SHA-256: $sha256
Timestamp: $($fileInfo.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'))
"@
        Add-Content -Path $manifestPath -Value $manifestEntry -Encoding UTF8

        # Restrict file permissions to current user only
        Restrict-FilePermissions -FilePath $DumpPath

        return $true
    }
    catch {
        Write-Host "EXCEPTION during validation: $_" -ForegroundColor Red
        return $false
    }
}

function Validate-RolesSql {
    param(
        [string]$DumpPath,
        [string]$Description
    )
    Write-Host "`n--- Validating $Description (plain SQL) ---" -ForegroundColor Cyan
    if (-not (Test-Path -LiteralPath $DumpPath)) {
        Write-Host "FAIL: Dump file not found: $DumpPath" -ForegroundColor Red
        return $false
    }

    $fileInfo = Get-Item -LiteralPath $DumpPath
    if ($fileInfo.Length -eq 0) {
        Write-Host "FAIL: Dump file is empty: $DumpPath" -ForegroundColor Red
        return $false
    }

    # Basic validation: check it's valid SQL with role definitions
    # Also verify no excluded roles remain
    try {
        $content = Get-Content -LiteralPath $DumpPath -Raw -Encoding UTF8
        # pg_dumpall outputs role names with double quotes, count both quoted and unquoted
        $roleCount = ($content -split "`n" | Where-Object { $_ -match '^\s*CREATE\s+ROLE\s+"' -or $_ -match '^\s*CREATE\s+ROLE\s+\w' -or $_ -match '^\s*CREATE\s+USER\s+"' -or $_ -match '^\s*CREATE\s+USER\s+\w' }).Count

        # Verify excluded roles are not present
        $excludedFound = @()
        foreach ($role in $excludedRoles) {
            # pg_dumpall outputs role names with double quotes
            $pattern = 'CREATE\s+(ROLE|USER)\s+"' + [regex]::Escape($role) + '"'
            if ($content -match $pattern) {
                $excludedFound += $role
            }
        }
        if ($excludedFound.Count -gt 0) {
            Write-Host "FAIL: Excluded roles found in filtered output: $($excludedFound -join ', ')" -ForegroundColor Red
            return $false
        }

        $sizeMB = [math]::Round($fileInfo.Length / 1MB, 2)
        $sha256 = Get-FileHash -LiteralPath $DumpPath -Algorithm SHA256 | Select-Object -ExpandProperty Hash

        Write-Host "PASS: $Description"
        Write-Host "   File: $DumpPath"
        Write-Host "   Size: ${sizeMB} MB"
        Write-Host "   Role definitions found: $roleCount"
        Write-Host "   Excluded roles verified absent: $($excludedRoles.Count)"
        Write-Host "   SHA-256: $sha256"
        Write-Host "   Modified: $($fileInfo.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'))"

        # Append to manifest
        $manifestEntry = @"
=== $Description ===
File: $DumpPath
Size: ${sizeMB} MB
Role definitions: $roleCount
Excluded roles verified absent: $($excludedRoles.Count)
SHA-256: $sha256
Timestamp: $($fileInfo.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'))
"@
        Add-Content -Path $manifestPath -Value $manifestEntry -Encoding UTF8

        # Restrict file permissions to current user only
        Restrict-FilePermissions -FilePath $DumpPath

        return $true
    }
    catch {
        Write-Host "EXCEPTION during validation: $_" -ForegroundColor Red
        return $false
    }
}

function Test-DatabaseIdentity {
    param(
        [string]$Password,
        [string]$ConnectionString
    )
    Write-Host "`n=== DATABASE IDENTITY & PROJECT VERIFICATION ===" -ForegroundColor Cyan
    $expectedProjectRef = "khwtfjyvawukbsvyjdux"
    if ($poolerUser -notmatch [regex]::Escape($expectedProjectRef)) {
        Write-Host "FAIL: Configured pooler user does not match the expected production project reference '$expectedProjectRef'." -ForegroundColor Red
        return $false
    }

    $sql = @"
SELECT current_database(), current_user, session_user, version(),
       (SELECT pg_catalog.count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('shelf_attendance_rpc_owner', 'shelf_book_reviews_rpc_owner')),
       (SELECT pg_catalog.count(*) FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename IN ('visitors', 'libraries', 'books'));
"@
    $env:PGPASSWORD = $Password
    try {
        $output = & $psqlPath -X -w -v ON_ERROR_STOP=1 --quiet -A -t -F '|' -d $ConnectionString -c $sql 2>&1
        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 0) {
            $reason = 'psql returned a nonzero exit code'
            if ($output -match '(?i)certificate|ssl|tls') { $reason = 'TLS certificate or hostname verification failed' }
            elseif ($output -match '(?i)password authentication|authentication failed|no password supplied') { $reason = 'database authentication failed' }
            elseif ($output -match '(?i)syntax error|does not exist|permission denied') { $reason = 'identity query execution failed' }
            Write-Host "FAIL: Database identity query failed ($reason; exit code $exitCode). Raw psql output was suppressed." -ForegroundColor Red
            return $false
        }
        $rows = @($output | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
        if ($rows.Count -ne 1) {
            Write-Host 'FAIL: Identity query returned empty or malformed output.' -ForegroundColor Red
            return $false
        }
        $fields = ([string]$rows[0]).Trim() -split '\|', 6
        if ($fields.Count -ne 6 -or [string]::IsNullOrWhiteSpace($fields[3])) {
            Write-Host 'FAIL: Identity query returned empty or malformed output.' -ForegroundColor Red
            return $false
        }
        $expectedDatabase = 'postgres'
        $expectedRole = 'postgres'
        if ($fields[0] -cne $expectedDatabase -or $fields[1] -cne $expectedRole -or $fields[2] -cne $expectedRole) {
            Write-Host 'FAIL: Connected database or role does not match the intended production identity.' -ForegroundColor Red
            Write-Host "Observed database='$($fields[0])', current_user='$($fields[1])', session_user='$($fields[2])'"
            return $false
        }

        # Project fingerprint check: verify custom SHELF roles and core tables
        $roleMatches = [int]($fields[4] || 0)
        $tableMatches = [int]($fields[5] || 0)
        if ($roleMatches -lt 1 -or $tableMatches -lt 1) {
            Write-Host 'FAIL: Target database lacks SHELF ILMS project schema fingerprint (roles/tables mismatch).' -ForegroundColor Red
            return $false
        }

        Write-Host "PASS: Verified project ref '$expectedProjectRef', database '$expectedDatabase', role '$expectedRole', TLS mode '$sslMode'."
        Write-Host "PASS: Verified SHELF ILMS schema fingerprint (found $roleMatches dedicated roles, $tableMatches core tables)."
        Write-Host "Database engine: $($fields[3])"
        return $true
    }
    catch {
        Write-Host 'FAIL: Identity verification encountered a local process or output handling error; details suppressed.' -ForegroundColor Red
        return $false
    }
    finally {
        $env:PGPASSWORD = ''
    }
}

function List-ApplicationTables {
    param(
        [string]$Password,
        [string]$ConnectionString
    )
    Write-Host "`n=== APPLICATION TABLES IN SCOPE ===" -ForegroundColor Cyan
    $schemaList = $appSchemas -join "','"
    $excludedList = $excludedSchemas -join "','"
    $sql = @"
SELECT
    n.nspname AS schema,
    c.relname AS table,
    CASE c.relkind
        WHEN 'r' THEN 'table'
        WHEN 'v' THEN 'view'
        WHEN 'm' THEN 'materialized view'
        WHEN 'i' THEN 'index'
        WHEN 'S' THEN 'sequence'
        WHEN 'f' THEN 'foreign table'
        ELSE c.relkind::text
    END AS type,
    pg_size_pretty(pg_total_relation_size(c.oid)) AS size
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('$schemaList')
  AND n.nspname NOT IN ('$excludedList')
  AND c.relkind IN ('r','v','m','S','f')
ORDER BY n.nspname, c.relname;
"@
    $env:PGPASSWORD = $Password
    try {
        $output = & $psqlPath -X -w -v ON_ERROR_STOP=1 --quiet -d $ConnectionString -c $sql 2>&1
        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 0) {
            Write-Host "FAIL: Cannot list application tables" -ForegroundColor Red
            Write-Host $output
            return $false
        }
        Write-Host "Tables/views/sequences in application schemas ($($appSchemas -join ', ')):"
        Write-Host $output
        return $true
    }
    catch {
        Write-Host "EXCEPTION: $_" -ForegroundColor Red
        return $false
    }
    finally {
        $env:PGPASSWORD = ""
    }
}

function Filter-RolesSql {
    param(
        [string]$InputPath,
        [string]$OutputPath
    )
    Write-Host "`n--- Filtering roles dump to exclude Supabase-managed roles ---" -ForegroundColor Cyan

    try {
        $content = Get-Content -LiteralPath $InputPath -Raw -Encoding UTF8

        # Split into statements (by semicolon) to handle multiline statements properly
        # pg_dumpall --roles-only output consists of CREATE ROLE, ALTER ROLE, GRANT, COMMENT statements
        # Each terminated by semicolon
        $statements = $content -split '(?<=;)\s*\r?\n' | Where-Object { $_ -match '\S' }

        $filteredStatements = @()
        $excludedRolePattern = '^(' + ($excludedRoles | ForEach-Object { [regex]::Escape($_) } -join '|') + ')$'

        foreach ($stmt in $statements) {
            $trimmed = $stmt.Trim()
            $keep = $true

            # Check for CREATE ROLE/USER for excluded roles
            if ($trimmed -match '^\s*CREATE\s+(ROLE|USER)\s+(\S+)') {
                $roleName = $matches[2].Trim('"')
                if ($roleName -match $excludedRolePattern) {
                    $keep = $false
                    Write-Host "  Excluding: $trimmed" -ForegroundColor Gray
                }
            }
            # Check for ALTER ROLE/USER for excluded roles
            elseif ($trimmed -match '^\s*ALTER\s+(ROLE|USER)\s+(\S+)') {
                $roleName = $matches[2].Trim('"')
                if ($roleName -match $excludedRolePattern) {
                    $keep = $false
                    Write-Host "  Excluding: $trimmed" -ForegroundColor Gray
                }
            }
            # Check for GRANT ... TO excluded_role or GRANT excluded_role TO ...
            elseif ($trimmed -match '^\s*GRANT\s+(\S+)\s+TO\s+(\S+)') {
                $grantedRole = $matches[1].Trim('"').Trim(';')
                $grantee = $matches[2].Trim('"').Trim(';')
                if ($grantee -match $excludedRolePattern -or $grantedRole -match $excludedRolePattern) {
                    $keep = $false
                    Write-Host "  Excluding: $trimmed" -ForegroundColor Gray
                }
            }
            elseif ($trimmed -match '^\s*GRANT\s+.+\s+TO\s+(\S+)') {
                $grantee = $matches[1].Trim('"').Trim(';')
                if ($grantee -match $excludedRolePattern) {
                    $keep = $false
                    Write-Host "  Excluding: $trimmed" -ForegroundColor Gray
                }
            }
            elseif ($trimmed -match '^\s*GRANT\s+(\S+)') {
                $grantedRole = $matches[1].Trim('"').Trim(';')
                if ($grantedRole -match $excludedRolePattern) {
                    $keep = $false
                    Write-Host "  Excluding: $trimmed" -ForegroundColor Gray
                }
            }
            # Check for COMMENT ON ROLE for excluded roles
            elseif ($trimmed -match '^\s*COMMENT\s+ON\s+ROLE\s+(\S+)') {
                $roleName = $matches[1].Trim('"')
                if ($roleName -match $excludedRolePattern) {
                    $keep = $false
                    Write-Host "  Excluding: $trimmed" -ForegroundColor Gray
                }
            }
            # Check for ALTER DEFAULT PRIVILEGES FOR ROLE
            elseif ($trimmed -match '^\s*ALTER\s+DEFAULT\s+PRIVILEGES\s+FOR\s+ROLE\s+(\S+)') {
                $roleName = $matches[1].Trim('"')
                if ($roleName -match $excludedRolePattern) {
                    $keep = $false
                    Write-Host "  Excluding: $trimmed" -ForegroundColor Gray
                }
            }

            if ($keep) {
                $filteredStatements += $stmt
            }
        }

        $filteredContent = $filteredStatements -join "`n`n"
        Set-Content -LiteralPath $OutputPath -Value $filteredContent -Encoding UTF8

        $originalCount = ($content -split '(?<=;)\s*\r?\n' | Where-Object { $_ -match '^\s*CREATE\s+(ROLE|USER)\s' }).Count
        $filteredCount = ($filteredContent -split '(?<=;)\s*\r?\n' | Where-Object { $_ -match '^\s*CREATE\s+(ROLE|USER)\s' }).Count
        Write-Host "  Original role definitions: $originalCount"
        Write-Host "  After filtering: $filteredCount"
        Write-Host "  Excluded: $($originalCount - $filteredCount)"

        return $true
    }
    catch {
        Write-Host "EXCEPTION during role filtering: $_" -ForegroundColor Red
        return $false
    }
}

# ======== MAIN EXECUTION ========
Write-Host "================================================================" -ForegroundColor Green
Write-Host "SHELF ILMS Production Database Backup via Supabase Pooler" -ForegroundColor Green
Write-Host "Project: khwtfjyvawukbsvyjdux (Tokyo region)" -ForegroundColor Green
Write-Host "Timestamp: $timestamp" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host ""

# Preflight checks
if (-not (Test-Prerequisites)) {
    Write-Host "`nPREFLIGHT CHECKS FAILED - ABORTING" -ForegroundColor Red
    exit 1
}

# Get password securely
$password = Get-SecurePassword

# Build the verified TLS connection string BEFORE identity verification uses it.
# Uses sslmode=verify-full with CA certificate and quoted path for spaces.
$connStr = "host=$poolerHost port=$poolerPort dbname=$database user=$poolerUser sslmode=$sslMode sslrootcert=$caCertPathLibpqQuoted connect_timeout=$connectTimeout"
# For pg_dump/pg_dumpall --dbname argument, use the same connection string format
$dbnameArg = $connStr

try {
    # Verify database identity
    if (-not (Test-DatabaseIdentity -Password $password -ConnectionString $connStr)) {
        throw "Database identity verification failed"
    }

    # List tables in scope
    if (-not (List-ApplicationTables -Password $password -ConnectionString $connStr)) {
        throw "Application table listing failed"
    }

    # Confirm before proceeding
    Write-Host "`n=== CONFIRM BACKUP SCOPE ===" -ForegroundColor Cyan
    Write-Host "The following will be backed up:" -ForegroundColor Yellow
    Write-Host "  1. ROLES (custom only, excluding Supabase-managed roles) -> pg_dumpall --roles-only --no-role-passwords (plain SQL)"
    Write-Host "  2. SCHEMA (application schemas: $($appSchemas -join ', '), EXCLUDING: $($excludedSchemas -join ', ')) -> pg_dump -Fc --schema-only"
    Write-Host "  3. DATA   (application schemas: $($appSchemas -join ', '), EXCLUDING: $($excludedSchemas -join ', ')) -> pg_dump -Fc --data-only"
    Write-Host ""
    Write-Host "Explicitly EXCLUDED (Supabase-managed):" -ForegroundColor Red
    Write-Host "  - Schemas: auth, storage, realtime, supabase_functions, pg_catalog, information_schema"
    Write-Host "  - Roles: supabase_admin, authenticator, service_role, anon, postgres, and other Supabase internal roles"
    Write-Host "  - Auth users, Storage objects, Edge Functions, Vault secrets, Project config"
    Write-Host ""
    Write-Host "SENSITIVE DATA INCLUDED (public schema):" -ForegroundColor Yellow
    Write-Host "  - password_reset_codes, login_attempt_lockouts, fine_payments" -ForegroundColor Yellow
    Write-Host "  - visitors, staff_profiles, audit_logs" -ForegroundColor Yellow
    Write-Host "  These files require owner-only filesystem ACLs and encryption at rest." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Backup directory: $backupRoot" -ForegroundColor Cyan
    Write-Host "Manifest file: $manifestPath" -ForegroundColor Cyan
    Write-Host ""

    $confirm = Read-Host "Proceed with backup? [y/N]"
    if ($confirm -notmatch '^[yY]$') {
        Write-Host "Backup cancelled by user." -ForegroundColor Yellow
        return  # Exit try block to finally
    }

    # Initialize manifest
    $manifestHeader = @"
SHELF ILMS Production Backup Manifest
=====================================
Project: khwtfjyvawukbsvyjdux (shelf-ilms)
Region: Tokyo (ap-northeast-1)
Timestamp: $timestamp
Pooler: $poolerEndpoint (session mode)
Database: $database
User: $poolerUser
Application Schemas: $($appSchemas -join ', ')
Excluded Schemas: $($excludedSchemas -join ', ')
Excluded Roles: $($excludedRoles -join ', ')
PostgreSQL Client: 18.6
Backup Tools: pg_dumpall --roles-only --no-role-passwords; pg_dump -Fc --schema-only/--data-only (custom format)
TLS: $sslMode
CA Certificate: $caCertPath
=====================================
"@
    Set-Content -Path $manifestPath -Value $manifestHeader -Encoding UTF8
    Register-CreatedFile $manifestPath
    Restrict-FilePermissions -FilePath $manifestPath

    # ======== 1. ROLES DUMP ========
    $rolesDumpRaw = Join-Path $backupRoot "shelf_roles_${timestamp}_raw.dump"
    $rolesDump = Join-Path $backupRoot "shelf_roles_$timestamp.dump"
    Register-CreatedFile $rolesDumpRaw
    Register-CreatedFile $rolesDump

    $rolesArgs = @(
        "--roles-only",
        "--no-role-passwords",
        "--file", $rolesDumpRaw,
        "--host", $poolerHost,
        "--port", $poolerPort,
        "--username", $poolerUser,
        "--dbname", $dbnameArg
    )
    if (-not (Invoke-PgCommand -ToolPath $pgDumpAllPath -Args $rolesArgs `
        -Description "ROLES DUMP (pg_dumpall --roles-only --no-role-passwords)" `
        -Password $password)) {
        throw "ROLES DUMP failed"
    }

    # Filter out Supabase-managed roles
    if (-not (Filter-RolesSql -InputPath $rolesDumpRaw -OutputPath $rolesDump)) {
        throw "ROLES FILTERING failed"
    }

    # Remove raw file only after successful filtering
    if (Test-Path -LiteralPath $rolesDumpRaw) {
        Remove-Item -LiteralPath $rolesDumpRaw -Force -ErrorAction SilentlyContinue
        $script:createdFiles = $script:createdFiles | Where-Object { $_ -ne $rolesDumpRaw }
    }

    # Validate filtered roles SQL
    if (-not (Validate-RolesSql -DumpPath $rolesDump -Description "ROLES DUMP")) {
        throw "ROLES VALIDATION failed"
    }

    # ======== 2. SCHEMA DUMP ========
    $schemaDump = Join-Path $backupRoot "shelf_schema_$timestamp.dump"
    Register-CreatedFile $schemaDump

    # Build --exclude-schema arguments
    $excludeSchemaArgs = @()
    foreach ($schema in $excludedSchemas) {
        $excludeSchemaArgs += "--exclude-schema", $schema
    }
    # Build --schema arguments for application schemas
    $schemaArgs = @()
    foreach ($schema in $appSchemas) {
        $schemaArgs += "--schema", $schema
    }

    $schemaDumpArgs = @(
        "-Fc",                    # Custom format
        "--schema-only",          # Schema only
        "--no-owner",             # Don't output ownership commands
        "--no-privileges",        # Don't output privilege commands
        "--file", $schemaDump,
        "--host", $poolerHost,
        "--port", $poolerPort,
        "--username", $poolerUser,
        "--dbname", $dbnameArg
    ) + $excludeSchemaArgs + $schemaArgs

    if (-not (Invoke-PgCommand -ToolPath $pgDumpPath -Args $schemaDumpArgs `
        -Description "SCHEMA DUMP (pg_dump -Fc --schema-only)" `
        -Password $password)) {
        throw "SCHEMA DUMP failed"
    }

    if (-not (Validate-CustomDump -DumpPath $schemaDump -Description "SCHEMA DUMP")) {
        throw "SCHEMA VALIDATION failed"
    }

    # ======== 3. DATA DUMP ========
    $dataDump = Join-Path $backupRoot "shelf_data_$timestamp.dump"
    Register-CreatedFile $dataDump

    $dataDumpArgs = @(
        "-Fc",                    # Custom format
        "--data-only",            # Data only
        "--no-owner",
        "--no-privileges",
        "--file", $dataDump,
        "--host", $poolerHost,
        "--port", $poolerPort,
        "--username", $poolerUser,
        "--dbname", $dbnameArg
    ) + $excludeSchemaArgs + $schemaArgs

    if (-not (Invoke-PgCommand -ToolPath $pgDumpPath -Args $dataDumpArgs `
        -Description "DATA DUMP (pg_dump -Fc --data-only)" `
        -Password $password)) {
        throw "DATA DUMP failed"
    }

    if (-not (Validate-CustomDump -DumpPath $dataDump -Description "DATA DUMP")) {
        throw "DATA VALIDATION failed"
    }

    # ======== FINALIZATION ========
    Write-Host "`n================================================================" -ForegroundColor Green
    Write-Host "=== BACKUP COMPLETED SUCCESSFULLY ===" -ForegroundColor Green
    Write-Host "Manifest: $manifestPath" -ForegroundColor Cyan
    Write-Host "`nBackup files created:" -ForegroundColor Cyan
    Get-ChildItem -LiteralPath $backupRoot -Filter "*_$timestamp.dump" | ForEach-Object {
        $sizeMB = [math]::Round($_.Length / 1MB, 2)
        Write-Host "  $($_.Name)  (${sizeMB} MB)"
    }
    Write-Host "`nProduction database was NOT modified." -ForegroundColor Green
    Write-Host "Docker/WSL containers and volumes were NOT touched." -ForegroundColor Green
    Write-Host "No credentials exposed in command history, logs, or output." -ForegroundColor Green
    Write-Host "`nBACKUP SCOPE LIMITATIONS:" -ForegroundColor Yellow
    Write-Host "  This backup does NOT include:" -ForegroundColor Yellow
    Write-Host "    - Auth users, sessions, MFA data (Supabase Auth)" -ForegroundColor Yellow
    Write-Host "    - Storage objects and buckets (Supabase Storage)" -ForegroundColor Yellow
    Write-Host "    - Realtime state (Supabase Realtime)" -ForegroundColor Yellow
    Write-Host "    - Edge Function source and secrets" -ForegroundColor Yellow
    Write-Host "    - Vault secrets" -ForegroundColor Yellow
    Write-Host "    - Project configuration and API keys" -ForegroundColor Yellow
    Write-Host "    - External frontend hosting configuration" -ForegroundColor Yellow
    Write-Host "`nSENSITIVE DATA PROTECTION REQUIRED:" -ForegroundColor Yellow
    Write-Host "  Backup files contain PII and auth tokens. Apply owner-only ACLs and encrypt at rest." -ForegroundColor Yellow
    Write-Host "`nNEXT STEPS (per owner checklist):" -ForegroundColor Yellow
    Write-Host "  1. Verify manifest file contents" -ForegroundColor Yellow
    Write-Host "  2. Perform restore test to a SEPARATE Supabase project" -ForegroundColor Yellow
    Write-Host "  3. Verify schema matches production" -ForegroundColor Yellow
    Write-Host "  4. Confirm backup covers required scope for rollback" -ForegroundColor Yellow
    exit 0
}
catch {
    Write-Host "`n=== BACKUP FAILED ===" -ForegroundColor Red
    Write-Host "Error: $_" -ForegroundColor Red
    Write-Host "Cleaning up partial files..." -ForegroundColor Yellow
    Cleanup-CreatedFiles
    Write-Host "`nProduction database was NOT modified." -ForegroundColor Green
    Write-Host "Docker/WSL containers and volumes were NOT touched." -ForegroundColor Green
    exit 1
}
finally {
    # ALWAYS clear password, even on success
    Clear-Password ([ref]$password)
}
