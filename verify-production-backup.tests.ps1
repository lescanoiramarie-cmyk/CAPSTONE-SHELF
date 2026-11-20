#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:testsPassed = 0
$script:testsFailed = 0
function Assert-True { param([bool]$Condition, [string]$Message) if ($Condition) { $script:testsPassed++; Write-Host "PASS: $Message" -ForegroundColor Green } else { $script:testsFailed++; Write-Host "FAIL: $Message" -ForegroundColor Red } }

$tmp = Join-Path $env:TEMP "verifytest_$(Get-Random)"
New-Item -ItemType Directory -Path $tmp | Out-Null

# Create a data file
$dataFile = Join-Path $tmp "data.dump"
"hello world" | Set-Content -Path $dataFile -Encoding UTF8 -NoNewline
$hash = (Get-FileHash -LiteralPath $dataFile -Algorithm SHA256).Hash
$sizeMB = [math]::Round((Get-Item $dataFile).Length / 1MB, 2)

# Manifest valid
$manifest = Join-Path $tmp "manifest.txt"
$entry = @"
=== DATA DUMP ===
File: $dataFile
Size: $sizeMB MB
SHA-256: $hash
"@
Set-Content -Path $manifest -Value $entry -Encoding UTF8

# Test 1: valid
try { try { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path (Split-Path -Parent $PSCommandPath) "verify-production-backup.ps1") -ManifestPath $manifest 2>&1 | Out-Null } catch { } } catch { }
Assert-True ($LASTEXITCODE -eq 0) "Valid backup verifies successfully"

# Test 2: corrupted file
"corrupted" | Set-Content -Path $dataFile -Encoding UTF8 -NoNewline
try { try { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path (Split-Path -Parent $PSCommandPath) "verify-production-backup.ps1") -ManifestPath $manifest 2>&1 | Out-Null } catch { } } catch { }
Assert-True ($LASTEXITCODE -ne 0) "Corrupted file fails verification"

# Test 3: missing file
Remove-Item -LiteralPath $dataFile -Force
try { try { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path (Split-Path -Parent $PSCommandPath) "verify-production-backup.ps1") -ManifestPath $manifest 2>&1 | Out-Null } catch { } } catch { }
Assert-True ($LASTEXITCODE -ne 0) "Missing file fails verification"

# Test 4: malformed manifest (empty)
$emptyManifest = Join-Path $tmp "empty.txt"
Set-Content -Path $emptyManifest -Value "" -Encoding UTF8
try { try { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path (Split-Path -Parent $PSCommandPath) "verify-production-backup.ps1") -ManifestPath $emptyManifest 2>&1 | Out-Null } catch { } } catch { }
Assert-True ($LASTEXITCODE -ne 0) "Empty manifest fails verification"

Remove-Item -LiteralPath $tmp -Recurse -Force
Write-Host "Passed: $script:testsPassed  Failed: $script:testsFailed"

