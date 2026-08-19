# Local helper: report the step-by-step status of an in-flight iOS build run.
#
# Logs are only downloadable once a job finishes, so while a run is in progress
# the step list from the jobs API is the only visibility available.
param(
  [Parameter(Mandatory = $true)][string]$RunId
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

$jobs = Invoke-RestMethod -Uri "https://api.github.com/repos/serhii1staf/San-Mes/actions/runs/$RunId/jobs" -Headers $headers -TimeoutSec 60
foreach ($j in $jobs.jobs) {
  Write-Output ("JOB {0}  status={1}  conclusion={2}" -f $j.name, $j.status, $j.conclusion)
  foreach ($s in $j.steps) {
    Write-Output ("   {0,-40} {1,-12} {2}" -f $s.name, $s.status, $s.conclusion)
  }
}
