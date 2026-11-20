# Safe local Windows ACL regression tests. This script never invokes psql.
# Run with: powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\test-report-acl.ps1
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

. (Join-Path $PSScriptRoot 'ReportAcl.ps1')

$sampleAccountNames = @(
    'LAPTOP-95DMOFRV\Yesha May M. Cordero',
    'DOMAIN\Library Staff User'
)
foreach ($name in $sampleAccountNames) {
    $account = [System.Security.Principal.NTAccount]::new($name)
    if ($account.Value -cne $name) { throw "NTAccount did not preserve literal account name: $name" }
}

$currentIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $currentIdentity.User) { throw "Windows did not provide the current user's SID." }
$currentPrincipal = [System.Security.Principal.WindowsPrincipal]::new($currentIdentity)
if ($currentPrincipal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this ACL regression test unelevated to verify that Administrator membership is not required.'
}
$tokenPrivileges = & whoami.exe /priv 2>$null
if ($LASTEXITCODE -ne 0 -or ($tokenPrivileges | Where-Object { $_ -match 'SeSecurityPrivilege' -and $_ -match 'Enabled' })) {
    throw 'The regression test requires a token without enabled SeSecurityPrivilege.'
}
$principals = @(Get-ReportAclPrincipals -CurrentUserSid $currentIdentity.User)
if (@($principals | ForEach-Object { $_.Value } | Select-Object -Unique).Count -ne 3) {
    throw 'Expected distinct current-user, SYSTEM, and Administrators SIDs.'
}

$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('shelf-report-acl-' + [Guid]::NewGuid().ToString('N'))
$testDirectory = Join-Path $testRoot 'reports'
$testFile = Join-Path $testDirectory 'report.txt'
try {
    New-Item -ItemType Directory -Path $testDirectory -ErrorAction Stop | Out-Null

    # Add a broad inherited-style grant to prove the helper removes unsafe ACEs.
    $directoryAcl = Get-ReportDacl -LiteralPath $testDirectory -ItemType Directory
    $everyoneSid = [System.Security.Principal.SecurityIdentifier]::new('S-1-1-0')
    $broadRule = [System.Security.AccessControl.FileSystemAccessRule]::new(
        $everyoneSid,
        [System.Security.AccessControl.FileSystemRights]::ReadAndExecute,
        [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
            [System.Security.AccessControl.InheritanceFlags]::ObjectInherit,
        [System.Security.AccessControl.PropagationFlags]::None,
        [System.Security.AccessControl.AccessControlType]::Allow
    )
    $directoryAcl.AddAccessRule($broadRule)
    Set-ReportDacl -LiteralPath $testDirectory -ItemType Directory -Dacl $directoryAcl

    Set-RestrictedReportAcl -LiteralPath $testDirectory -ItemType Directory -CurrentUserSid $currentIdentity.User
    Assert-RestrictedReportAcl -LiteralPath $testDirectory -ItemType Directory -CurrentUserSid $currentIdentity.User
    New-Item -ItemType File -Path $testFile -ErrorAction Stop | Out-Null
    Set-RestrictedReportAcl -LiteralPath $testFile -ItemType File -CurrentUserSid $currentIdentity.User
    Assert-RestrictedReportAcl -LiteralPath $testFile -ItemType File -CurrentUserSid $currentIdentity.User

    $verifiedDirectoryAcl = Get-ReportDacl -LiteralPath $testDirectory -ItemType Directory
    $directorySids = @($verifiedDirectoryAcl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | ForEach-Object { $_.IdentityReference.Value })
    if ($directorySids -contains 'S-1-1-0') { throw 'Everyone retains access to the report directory.' }

    Write-Output 'PASS: domain/computer-prefixed names with spaces are accepted as literal NTAccount values.'
    Write-Output 'PASS: directory and file DACLs are protected and contain only the current user, SYSTEM, and Administrators.'
    Write-Output 'PASS: test ran unelevated without enabled SeSecurityPrivilege.'
    Write-Output 'PASS: broad Everyone access is removed; psql was not invoked.'
} finally {
    if (Test-Path -LiteralPath $testRoot) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
