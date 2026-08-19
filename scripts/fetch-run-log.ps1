# Local helper: download a GitHub Actions job log using the token already held by
# Git Credential Manager (the same one `git push` uses).
#
# Not part of the app or the build. Kept out of git via .gitignore.
param(
  [Parameter(Mandatory = $true)][string]$RunId,
  [string]$OutFile = 'build_log.txt'
)

$ErrorActionPreference = 'Stop'

$req = "protocol=https`nhost=github.com`n`n"
$cred = $req | git credential fill 2>$null
$line = $cred | Select-String '^password='
if (-not $line) { throw 'No GitHub token in the credential store.' }
$token = $line.ToString().Substring(9)

$headers = @{
  Authorization  = "Bearer $token"
  Accept         = 'application/vnd.github+json'
  'User-Agent'   = 'san-mes-agent'
}

$jobs = Invoke-RestMethod -Uri "https://api.github.com/repos/serhii1staf/San-Mes/actions/runs/$RunId/jobs" -Headers $headers -TimeoutSec 60
foreach ($j in $jobs.jobs) {
  Write-Output ("JOB {0} -> {1} (id={2})" -f $j.name, $j.conclusion, $j.id)
}

$jobId = $jobs.jobs[0].id
# The logs endpoint 302-redirects to blob storage; -L follows it and the header
# is harmless there.
& curl.exe -sL -H "Authorization: Bearer $token" -H 'User-Agent: san-mes-agent' `
  "https://api.github.com/repos/serhii1staf/San-Mes/actions/jobs/$jobId/logs" -o $OutFile

Write-Output ("bytes={0}" -f (Get-Item $OutFile).Length)
