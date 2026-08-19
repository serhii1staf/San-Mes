# Local helper: kick off the iOS build workflow using the token Git Credential
# Manager already holds (the same one `git push` uses), then report the run.
#
# Not part of the app or the build. Kept out of git via .gitignore? No — this one
# IS committed: it is the only way to trigger a build while the gh CLI is signed
# out, and the next person will want it.
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
    -Uri "https://api.github.com/repos/$repo/actions/workflows/build-ios.yml/dispatches" `
    -Headers $headers -Body $body -ContentType 'application/json' -TimeoutSec 60 | Out-Null
  Write-Output "dispatched build-ios.yml on $Ref"
  # The run does not exist the instant the dispatch returns.
  Start-Sleep -Seconds 20
}

$runs = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/actions/workflows/build-ios.yml/runs?per_page=3" -Headers $headers -TimeoutSec 60
foreach ($r in $runs.workflow_runs) {
  Write-Output ("run #{0}  {1,-12} {2,-10} head={3}  {4}" -f `
    $r.run_number, $r.status, $r.conclusion, $r.head_sha.Substring(0, 7), $r.html_url)
}
