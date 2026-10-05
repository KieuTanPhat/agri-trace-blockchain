[CmdletBinding()]
param([Parameter(Position=0, ValueFromRemainingArguments=$true)][string[]]$Arguments)

$ErrorActionPreference = 'Stop'
$repoPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$pythonPath = Join-Path $repoPath '.tools/graphify/venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) {
    throw 'Run tools/graphify/setup.ps1 before using the project Graphify wrapper.'
}
if (-not $Arguments) { $Arguments = @('status') }
& $pythonPath -X utf8 (Join-Path $PSScriptRoot 'project.py') @Arguments
exit $LASTEXITCODE
