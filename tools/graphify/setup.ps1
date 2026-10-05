[CmdletBinding()]
param([string]$Python = 'python')

$ErrorActionPreference = 'Stop'
$repoPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$environmentPath = Join-Path $repoPath '.tools/graphify/venv'
$pythonPath = Join-Path $environmentPath 'Scripts/python.exe'
$lockPath = Join-Path $PSScriptRoot 'requirements-windows-py313.lock'

if (-not (Test-Path -LiteralPath $pythonPath)) {
    & $Python -c "import sys,platform; assert sys.version_info[:2] == (3,13) and sys.platform == 'win32' and platform.machine().lower() in ('amd64','x86_64'), 'Use Windows x64 CPython 3.13 for this lock'"
    if ($LASTEXITCODE -ne 0) { throw 'Python runtime does not match the dependency lock.' }
    & $Python -m venv $environmentPath
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the Graphify environment.' }
}
& $pythonPath -c "import sys,platform; assert sys.version_info[:2] == (3,13) and sys.platform == 'win32' and platform.machine().lower() in ('amd64','x86_64')"
if ($LASTEXITCODE -ne 0) { throw 'Existing environment does not match the dependency lock.' }
& $pythonPath -m pip install --disable-pip-version-check --require-hashes --only-binary=:all: -r $lockPath
if ($LASTEXITCODE -ne 0) { throw 'Graphify dependency installation failed.' }
& $pythonPath -m pip check
if ($LASTEXITCODE -ne 0) { throw 'Graphify dependency consistency check failed.' }
& $pythonPath -X utf8 (Join-Path $PSScriptRoot 'project.py') version
if ($LASTEXITCODE -ne 0) { throw 'Graphify runtime validation failed.' }
& $pythonPath -X utf8 (Join-Path $PSScriptRoot 'project.py') assets
if ($LASTEXITCODE -ne 0) { throw 'Pinned visualization asset setup failed.' }
