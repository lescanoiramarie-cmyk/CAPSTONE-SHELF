# Shared credential helpers for Windows PowerShell 5.1 psql scripts.
# Never log or return diagnostic output containing psql's raw output.

function ConvertFrom-SecurePsqlPassword {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [System.Security.SecureString]$SecurePassword
    )

    $passwordBstr = [IntPtr]::Zero
    $passwordText = $null
    $utf8Bytes = $null
    try {
        $passwordBstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecurePassword)
        $passwordText = [System.Runtime.InteropServices.Marshal]::PtrToStringUni($passwordBstr)
        $strictUtf8 = [System.Text.UTF8Encoding]::new($false, $true)
        $utf8Bytes = $strictUtf8.GetBytes($passwordText)
        $utf8RoundTrip = $strictUtf8.GetString($utf8Bytes)
        if ($utf8RoundTrip -cne $passwordText) {
            throw 'Password text did not survive strict UTF-8 validation.'
        }
        return $utf8RoundTrip
    } finally {
        if ($utf8Bytes) { [Array]::Clear($utf8Bytes, 0, $utf8Bytes.Length) }
        if ($passwordBstr -ne [IntPtr]::Zero) {
            [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordBstr)
        }
        $passwordText = $null
        $utf8RoundTrip = $null
    }
}

function Set-PsqlProcessEnvironment {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [string]$Password
    )

    $names = @('PGPASSWORD', 'PGOPTIONS', 'PGSERVICE', 'PGSERVICEFILE', 'PGHOSTADDR')
    $prior = @{}
    foreach ($name in $names) {
        $prior[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    }
    try {
        [Environment]::SetEnvironmentVariable('PGPASSWORD', $Password, 'Process')
        [Environment]::SetEnvironmentVariable('PGOPTIONS', '-c default_transaction_read_only=on', 'Process')
        # Prevent inherited service files or host-address overrides from altering
        # the explicitly supplied connection parameters.
        [Environment]::SetEnvironmentVariable('PGSERVICE', $null, 'Process')
        [Environment]::SetEnvironmentVariable('PGSERVICEFILE', $null, 'Process')
        [Environment]::SetEnvironmentVariable('PGHOSTADDR', $null, 'Process')
        return $prior
    } catch {
        Restore-PsqlProcessEnvironment -PriorEnvironment $prior
        throw
    }
}

function Restore-PsqlProcessEnvironment {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$PriorEnvironment
    )

    foreach ($name in $PriorEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($name, $PriorEnvironment[$name], 'Process')
    }
}

function Get-SanitizedPsqlFailure {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $false)]
        [AllowNull()]
        [object[]]$Output,

        [Parameter(Mandatory = $true)]
        [int]$ExitCode
    )

    $text = ($Output | ForEach-Object { [string]$_ }) -join "`n"
    if ($text -match '(?i)password authentication failed|authentication failed') {
        return "psql authentication failed (exit code $ExitCode); raw output withheld. Verify the Dashboard connection mode and username."
    }
    if ($text -match '(?i)certificate|ssl|tls|hostname.*match') {
        return "psql TLS verification failed (exit code $ExitCode); raw output withheld. Verify the trusted CA and Dashboard host."
    }
    if ($text -match '(?i)could not connect|connection refused|timeout|no route to host') {
        return "psql connection failed (exit code $ExitCode); raw output withheld. Verify network access and Dashboard endpoint."
    }
    if ($text -match '(?i)\bERROR\b|syntax error') {
        return "psql reported a SQL execution failure (exit code $ExitCode); raw output withheld."
    }
    return "psql failed (exit code $ExitCode); raw output withheld."
}
