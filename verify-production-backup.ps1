param(
    [Parameter(Mandatory=$true)]
    [string]$ManifestPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $ManifestPath)) { throw "Manifest not found: $ManifestPath" }

$manifestText = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8

$entries = @()
$current = $null
foreach ($line in ($manifestText -split "`r?`n")) {
    if ($line -match '^===\s*(.+?)\s*===$') {
        if ($current) { $entries += $current }
        $current = @{ Description = $matches[1]; Fields = @{} }
    } elseif ($current -and $line -match '^\s*([^:]+):\s*(.*)$') {
        $current.Fields[$matches[1].Trim()] = $matches[2].Trim()
    }
}
if ($current) { $entries += $current }

if ($entries.Count -eq 0) { throw "No backup entries found in manifest." }

$failures = @()
foreach ($e in $entries) {
    $file = $e.Fields['File']
    if (-not $file) { $failures += "Entry '$($e.Description)' missing File field."; continue }
    if (-not (Test-Path -LiteralPath $file)) { $failures += "Missing file: $file"; continue }
    if (-not $e.Fields['SHA-256']) { $failures += "Missing SHA-256 for $file"; continue }
    $actual = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
    if ($actual -ne $e.Fields['SHA-256']) { $failures += "SHA-256 mismatch for $file" }
    if ($e.Fields['Size']) {
        $sizeMB = [math]::Round((Get-Item -LiteralPath $file).Length / 1MB, 2)
        $expectedSize = $e.Fields['Size'] -replace ' MB',''
        if ("$sizeMB" -ne $expectedSize) { $failures += "Size mismatch for $file" }
    }
}

if ($failures.Count -gt 0) {
    $failures | ForEach-Object { Write-Host "FAIL: $_" -ForegroundColor Red }
    throw "Backup verification failed."
}
Write-Host "PASS: All backup artifacts verified ($($entries.Count) entries)." -ForegroundColor Green
exit 0
