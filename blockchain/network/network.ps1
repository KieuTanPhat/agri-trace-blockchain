param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet('bootstrap', 'up', 'deploy', 'enroll-relayer', 'smoke', 'down')]
  [string]$Command
)

$ErrorActionPreference = 'Stop'
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$gitBashCandidates = @(
  'C:\Program Files\Git\bin\bash.exe',
  'C:\Program Files\Git\usr\bin\bash.exe'
)
$bashPath = $gitBashCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

if ($null -eq $bashPath) {
  $bash = Get-Command bash -ErrorAction SilentlyContinue
  if ($null -eq $bash) {
    throw 'Bash was not found. Install WSL or Git for Windows, then rerun this script.'
  }
  $bashPath = $bash.Source
}

Push-Location $scriptDirectory
try {
  & $bashPath './network.sh' $Command
  if ($LASTEXITCODE -ne 0) {
    throw "network.sh failed with exit code $LASTEXITCODE"
  }
}
finally {
  Pop-Location
}
