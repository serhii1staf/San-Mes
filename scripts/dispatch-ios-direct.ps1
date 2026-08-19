# Local helper: trigger the DIRECT iOS build (compiles on the GitHub runner via
# `eas build --local`, uploads with `xcrun altool`).
#
# Use this instead of dispatch-ios-build.ps1 whenever status.expo.dev reports EAS
# Build or EAS Submit as degraded — this path only needs the EAS API for
# credentials, not Expo's build/submit workers.
param(
  [string]$Ref = 'main',
  [switch]$StatusOnly
)

$ErrorActionPreference = 'Stop'

$req = "protocol=https`nhost=github.com`n`n"
$cred = $req | git credential fill 2>$null
$line = $cred | Select-String '^password='
if (-not $line) { throw 'No GitHub token in the credential store.' }
$token = $line.ToString().Substring(9)

$headers = @{
  Authorization = "Bearer $token"
  Accept        = 'application/vnd.github+json'
  'User-Agent'  = 'san-mes-agent'
}
$repo = 'serhii1staf/San-Mes'

if (-not $StatusOnly) {
  $body = @{ ref = $Ref } | ConvertTo-Json
  Invoke-RestMethod -Method Post `
    -Uri "https://api.github.com/repos/$repo/actions/workflows/build-direct.yml/dispatches" `
    -Headers $headers -Body $body -ContentType 'application/json' -TimeoutSec 60 | Out-Null
  Write-Output "dispatched build-direct.yml on $Ref"
  Start-Sleep -Seconds 20
}

$runs = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/actions/workflows/build-direct.yml/runs?per_page=3" -Headers $headers -TimeoutSec 60
foreach ($r in $runs.workflow_runs) {
  Write-Output ("run #{0}  {1,-12} {2,-10} head={3}  {4}" -f `
    $r.run_number, $r.status, $r.conclusion, $r.head_sha.Substring(0, 7), $r.html_url)
}
