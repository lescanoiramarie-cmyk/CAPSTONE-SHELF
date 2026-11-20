function Get-ReportAclPrincipals {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [System.Security.Principal.SecurityIdentifier]$CurrentUserSid
    )

    $systemSid = [System.Security.Principal.SecurityIdentifier]::new(
        [System.Security.Principal.WellKnownSidType]::LocalSystemSid,
        $null
    )
    $administratorsSid = [System.Security.Principal.SecurityIdentifier]::new(
        [System.Security.Principal.WellKnownSidType]::BuiltinAdministratorsSid,
        $null
    )

    return @($CurrentUserSid, $systemSid, $administratorsSid)
}

function Get-ReportDacl {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$LiteralPath,

        [Parameter(Mandatory = $true)]
        [ValidateSet('Directory', 'File')]
        [string]$ItemType
    )

    # Request only Access from the native .NET Framework ACL APIs. Avoid the
    # PowerShell Get-Acl/Set-Acl round-trip, which may carry audit/SACL state.
    $sections = [System.Security.AccessControl.AccessControlSections]::Access
    if ($ItemType -eq 'Directory') {
        return [System.IO.Directory]::GetAccessControl($LiteralPath, $sections)
    }
    return [System.IO.File]::GetAccessControl($LiteralPath, $sections)
}

function Set-ReportDacl {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$LiteralPath,

        [Parameter(Mandatory = $true)]
        [ValidateSet('Directory', 'File')]
        [string]$ItemType,

        [Parameter(Mandatory = $true)]
        [System.Security.AccessControl.FileSystemSecurity]$Dacl
    )

    # SetAccessControl writes the modified access section only. Owner, group,
    # and audit/SACL state are never copied into or written by this helper.
    if ($ItemType -eq 'Directory') {
        [System.IO.Directory]::SetAccessControl($LiteralPath, [System.Security.AccessControl.DirectorySecurity]$Dacl)
        return
    }
    [System.IO.File]::SetAccessControl($LiteralPath, [System.Security.AccessControl.FileSecurity]$Dacl)
}

function Set-RestrictedReportAcl {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$LiteralPath,

        [Parameter(Mandatory = $true)]
        [ValidateSet('Directory', 'File')]
        [string]$ItemType,

        [Parameter(Mandatory = $true)]
        [System.Security.Principal.SecurityIdentifier]$CurrentUserSid
    )

    if (-not (Test-Path -LiteralPath $LiteralPath -PathType $(if ($ItemType -eq 'Directory') { 'Container' } else { 'Leaf' }))) {
        throw "Report $($ItemType.ToLowerInvariant()) does not exist."
    }

    $principals = @(Get-ReportAclPrincipals -CurrentUserSid $CurrentUserSid)
    $allowedSids = @{}
    foreach ($sid in $principals) { $allowedSids[$sid.Value] = $true }

    # Inspect only the current DACL, then deliberately protect this report
    # location from parent inheritance and replace its access entries with the
    # three required principals. Owner, group, and SACL are not read or written.
    $acl = Get-ReportDacl -LiteralPath $LiteralPath -ItemType $ItemType
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($rule in @($acl.Access)) {
        $acl.RemoveAccessRuleSpecific($rule)
    }

    foreach ($sid in $principals) {
        $inheritance = [System.Security.AccessControl.InheritanceFlags]::None
        if ($ItemType -eq 'Directory') {
            $inheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
                [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
        }
        $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
            $sid,
            [System.Security.AccessControl.FileSystemRights]::FullControl,
            $inheritance,
            [System.Security.AccessControl.PropagationFlags]::None,
            [System.Security.AccessControl.AccessControlType]::Allow
        )
        $acl.AddAccessRule($rule)
    }

    Set-ReportDacl -LiteralPath $LiteralPath -ItemType $ItemType -Dacl $acl
    Assert-RestrictedReportAcl -LiteralPath $LiteralPath -ItemType $ItemType -CurrentUserSid $CurrentUserSid
}

function Assert-RestrictedReportAcl {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$LiteralPath,

        [Parameter(Mandatory = $true)]
        [ValidateSet('Directory', 'File')]
        [string]$ItemType,

        [Parameter(Mandatory = $true)]
        [System.Security.Principal.SecurityIdentifier]$CurrentUserSid
    )

    $acl = Get-ReportDacl -LiteralPath $LiteralPath -ItemType $ItemType
    if (-not $acl.AreAccessRulesProtected) {
        throw 'Report DACL still inherits access rules from its parent.'
    }

    $principals = @(Get-ReportAclPrincipals -CurrentUserSid $CurrentUserSid)
    $expectedSids = @{}
    foreach ($sid in $principals) { $expectedSids[$sid.Value] = $false }
    $rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))

    foreach ($rule in $rules) {
        $sidValue = $rule.IdentityReference.Value
        if (-not $expectedSids.ContainsKey($sidValue)) {
            throw 'Report DACL contains an unapproved access principal.'
        }
        if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) {
            throw 'Report DACL contains a non-allow access rule.'
        }
        $fullControl = [System.Security.AccessControl.FileSystemRights]::FullControl
        if (($rule.FileSystemRights -band $fullControl) -ne $fullControl) {
            throw 'An approved report principal lacks FullControl.'
        }
        if ($ItemType -eq 'Directory') {
            $requiredInheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
                [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
            if (($rule.InheritanceFlags -band $requiredInheritance) -ne $requiredInheritance) {
                throw 'Directory FullControl does not inherit to contained reports.'
            }
        } elseif ($rule.InheritanceFlags -ne [System.Security.AccessControl.InheritanceFlags]::None) {
            throw 'Report file has unexpected child inheritance flags.'
        }
        $expectedSids[$sidValue] = $true
    }

    foreach ($sidValue in $expectedSids.Keys) {
        if (-not $expectedSids[$sidValue]) {
            throw 'Report DACL is missing a required user, SYSTEM, or Administrators grant.'
        }
    }
}
