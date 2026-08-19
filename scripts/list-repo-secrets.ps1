# Local helper: list the NAMES of the repository's Actions secrets.
#
# Names only — the GitHub API never returns secret values, and nothing here
# prints or stores one. Used to confirm a workflow references a secret that
# actually exists (a missing secret silently expands to an empty string).
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

try {
  $r = Invoke-RestMethod -Uri 'https://api.github.com/repos/serhii1staf/San-Mes/actions/secrets?per_page=100' -Headers $headers -TimeoutSec 60
  Write-Output ("total={0}" -f $r.total_count)
  $r.secrets | ForEach-Object { Write-Output ("  {0}   (updated {1})" -f $_.name, $_.updated_at) }
} catch {
  Write-Output "ERR $($_.Exception.Message)"
  if ($_.ErrorDetails.Message) { Write-Output $_.ErrorDetails.Message }
}
