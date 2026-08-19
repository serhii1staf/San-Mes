# Local helper: trigger the submit-only workflow (uploads an already-built
# binary to TestFlight) using the token Git Credential Manager already holds.
param(
  [string]$Ref = 'main',
  [string]$BuildId = '',
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
  $body = @{ ref = $Ref; inputs = @{ buildId = $BuildId } } | ConvertTo-Json
  Invoke-RestMethod -Method Post `
    -Uri "https://api.github.com/repos/$repo/actions/workflows/submit-ios.yml/dispatches" `
    -Headers $headers -Body $body -ContentType 'application/json' -TimeoutSec 60 | Out-Null
  Write-Output "dispatched submit-ios.yml on $Ref (buildId='$BuildId')"
  Start-Sleep -Seconds 20
}

$runs = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/actions/workflows/submit-ios.yml/runs?per_page=3" -Headers $headers -TimeoutSec 60
foreach ($r in $runs.workflow_runs) {
  Write-Output ("run #{0}  {1,-12} {2,-10} {3}" -f $r.run_number, $r.status, $r.conclusion, $r.html_url)
}
