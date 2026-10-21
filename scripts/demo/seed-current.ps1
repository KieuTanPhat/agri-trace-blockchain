param([switch]$ReplaceCurrentData, [switch]$Resume, [switch]$Restore, [switch]$Verify)
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Set-Location -LiteralPath $taskRoot
$taskLocal = Join-Path $taskRoot '.codex/seed-current'
New-Item -ItemType Directory -Path $taskLocal -Force | Out-Null
$taskLog = Join-Path $taskLocal 'operator.log'
$taskPg = 'agri-trace-demo-local-postgres-1'
$taskApi = 'agri-trace-demo-local-api-1'
$taskWeb = 'agri-trace-demo-local-web-1'
$taskWorker = 'agri-trace-demo-local-worker-1'
$taskSeedLock = [IO.File]::Open((Join-Path $taskLocal 'seed.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
try {
function Invoke-SeedDocker([string[]]$Arguments) {
    & docker @Arguments >> $taskLog 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Docker command failed; inspect private operator log. Exit $LASTEXITCODE" }
}
function Invoke-SeedSql([string]$Sql) {
    $taskValue = $Sql | & docker exec -i $taskPg sh -c 'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -X -At -v ON_ERROR_STOP=1' 2>> $taskLog
    if ($LASTEXITCODE -ne 0) { throw 'SQL operation failed; inspect private operator log.' }
    return $taskValue
}
$taskContainers = & docker inspect $taskApi $taskPg | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect active local app target.' }
foreach ($taskContainer in $taskContainers) {
    if ($taskContainer.Config.Labels.'com.docker.compose.project' -ne 'agri-trace-demo-local') { throw 'Unexpected Compose project.' }
    if ([IO.Path]::GetFullPath($taskContainer.Config.Labels.'com.docker.compose.project.working_dir') -ne $taskRoot) { throw 'Unexpected runtime checkout.' }
}
$taskRuntime = @{}
foreach ($taskPair in $taskContainers[0].Config.Env) { $taskParts=$taskPair.Split('=',2); $taskRuntime[$taskParts[0]]=$taskParts[1] }
$taskConnection = [uri]$taskRuntime.DATABASE_URL
if ($taskConnection.Host -ne 'postgres' -or $taskConnection.AbsolutePath -ne '/agri_trace' -or $taskRuntime.FABRIC_ENABLED -ne 'false' -or $taskRuntime.PUBLIC_TRACE_BASE_URL -ne 'http://localhost:3000/trace') { throw 'Database/runtime target guard rejected this stack.' }
if (@($taskContainers[1].Mounts | Where-Object Name -eq 'agri-trace-demo-local_postgres-data').Count -ne 1) { throw 'Unexpected PostgreSQL volume.' }
if ((Invoke-SeedSql 'SELECT current_database();') -ne 'agri_trace') { throw 'Wrong database.' }
if ((Invoke-SeedSql "SELECT to_regclass('public.blockchain_proof') IS NOT NULL;") -eq 't') {
    if ((Invoke-SeedSql 'SELECT count(*) FROM blockchain_proof;') -ne '0' -or (Invoke-SeedSql 'SELECT count(*) FROM fabric_network_binding;') -ne '0') { throw 'Ledger history exists. This local seed never rewrites ledger-linked history.' }
} elseif (-not $Restore) { throw 'Schema is incomplete; restore the original snapshot before seeding.' }
if (-not $Restore -and (Invoke-SeedSql 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL;') -ne '0') { throw 'Unfinished migration exists.' }
$taskWriterConfig = Join-Path $taskLocal 'writer.json'
$taskWriterLog = $null
if (Test-Path -LiteralPath $taskWriterConfig) {
    # Task/session identity belongs to ignored operator state, never source code.
    $taskWriterLog = (Get-Content -LiteralPath $taskWriterConfig -Raw | ConvertFrom-Json).log
    $taskWriterStamp = (Get-Item -LiteralPath $taskWriterLog).LastWriteTimeUtc.Ticks
    $taskSemantic = Get-Content -LiteralPath $taskWriterLog -Tail 50 | ForEach-Object { try { $_ | ConvertFrom-Json } catch {} } | Where-Object { $_.type -eq 'assistant' } | Select-Object -Last 1
    if ($taskSemantic.message.stop_reason -ne 'end_turn') { throw 'The monitored writer is still working; do not reset or write.' }
}
git check-ignore .codex/seed-current/accounts.json .codex/backups/seed.dump > $null
if ($LASTEXITCODE -ne 0) { throw 'Private seed artifacts must be ignored by Git.' }
if (-not $Restore -and -not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'assets/manifest.json'))) { throw 'Prepare licensed assets first.' }
$taskReceipt = Join-Path $taskLocal 'receipt.json'
if ((Test-Path -LiteralPath $taskReceipt) -and -not $Restore -and -not $Verify -and -not $Resume) { Write-Output 'Dataset already completed; no reset performed.'; exit 0 }
if ($Restore) {
    $taskBackup = Get-Content -LiteralPath (Join-Path $taskLocal 'backup.json') | ConvertFrom-Json
    if ((Get-FileHash -LiteralPath $taskBackup.path -Algorithm SHA256).Hash -ne $taskBackup.sha256) { throw 'Backup checksum mismatch.' }
    Invoke-SeedDocker -Arguments @('stop', $taskWeb, $taskWorker, $taskApi)
    Invoke-SeedDocker -Arguments @('cp', $taskBackup.path, "${taskPg}:/tmp/agritrace-before-full-seed.dump")
    Invoke-SeedDocker -Arguments @('exec', $taskPg, 'sh', '-c', 'exec pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --single-transaction --exit-on-error /tmp/agritrace-before-full-seed.dump')
    Invoke-SeedDocker -Arguments @('start', $taskApi, $taskWorker, $taskWeb)
    Write-Output 'Restored original snapshot into existing database agri_trace.'; exit 0
}
if (-not $ReplaceCurrentData -and -not $Resume -and -not $Verify) { Write-Output 'Target verified: existing local agri_trace; use -ReplaceCurrentData once, then -Resume.'; exit 0 }
if ($ReplaceCurrentData) {
    if (Test-Path -LiteralPath (Join-Path $taskLocal 'backup.json')) { throw 'An existing backup/checkpoint exists; use -Resume or -Restore, never reset implicitly.' }
    $taskBackupDir = Join-Path $taskRoot ('.codex/backups/full-seed-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    New-Item -ItemType Directory -Path $taskBackupDir -Force | Out-Null
    $taskPrincipal = "$($env:USERDOMAIN)\$($env:USERNAME):(OI)(CI)F"
    & icacls $taskLocal /inheritance:r /grant:r $taskPrincipal > $null
    if ($LASTEXITCODE -ne 0) { throw 'Could not restrict credential artifact access.' }
    & icacls $taskBackupDir /inheritance:r /grant:r $taskPrincipal > $null
    if ($LASTEXITCODE -ne 0) { throw 'Could not restrict backup access.' }
    Invoke-SeedDocker -Arguments @('stop', $taskWeb, $taskWorker, $taskApi)
    Invoke-SeedDocker -Arguments @('exec', $taskPg, 'sh', '-c', 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner -f /tmp/agritrace-before-full-seed.dump')
    $taskDumpPath = Join-Path $taskBackupDir 'database.dump'
    Invoke-SeedDocker -Arguments @('cp', "${taskPg}:/tmp/agritrace-before-full-seed.dump", $taskDumpPath)
    Invoke-SeedDocker -Arguments @('exec', $taskPg, 'pg_restore', '--list', '/tmp/agritrace-before-full-seed.dump')
    if ((Get-Item -LiteralPath $taskDumpPath).Length -lt 10000) { throw 'Backup unexpectedly small.' }
    $taskBackup = @{path=$taskDumpPath;sha256=(Get-FileHash -LiteralPath $taskDumpPath -Algorithm SHA256).Hash;database='agri_trace';container=$taskPg;createdAt=(Get-Date).ToUniversalTime().ToString('o')}
    $taskBackup | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskLocal 'backup.json') -Encoding utf8
}
if (-not (Test-Path -LiteralPath (Join-Path $taskLocal 'backup.json'))) { throw 'Resume requires the original backup receipt.' }
if (-not (Test-Path -LiteralPath (Join-Path $taskLocal 'reset.json'))) {
    $taskBackup = Get-Content -LiteralPath (Join-Path $taskLocal 'backup.json') | ConvertFrom-Json
    if ((Get-FileHash -LiteralPath $taskBackup.path -Algorithm SHA256).Hash -ne $taskBackup.sha256) { throw 'Backup checksum mismatch.' }
    Invoke-SeedDocker -Arguments @('stop', $taskWeb, $taskWorker, $taskApi)
    # Recheck the writer immediately before the authorized destructive operation.
    if ($taskWriterLog -and (Get-Item -LiteralPath $taskWriterLog).LastWriteTimeUtc.Ticks -ne $taskWriterStamp) { throw 'The monitored writer resumed during preflight; services remain stopped and snapshot is safe.' }
    $taskStaticAuthors = Invoke-SeedSql 'SELECT (SELECT count(*) FROM service_plan_version WHERE created_by IS NOT NULL OR published_by IS NOT NULL) + (SELECT count(*) FROM platform_setting WHERE updated_by IS NOT NULL) + (SELECT count(*) FROM reference_item WHERE updated_by IS NOT NULL);'
    if ($taskStaticAuthors -ne '0') { throw 'Reference catalogs contain user-owned history; cannot carry their old references into the new dataset.' }
    # Replacement rebuilds the schema in this same verified database. Append-only
    # triggers remain unmodified; they are restored verbatim from the snapshot.
    Invoke-SeedSql 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;' | Out-Null
    Invoke-SeedDocker -Arguments @('exec', $taskPg, 'sh', '-c', 'exec pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --section=pre-data --no-owner --exit-on-error /tmp/agritrace-before-full-seed.dump')
    Invoke-SeedDocker -Arguments @('exec', $taskPg, 'sh', '-c', 'exec pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --data-only --no-owner --exit-on-error -t _prisma_migrations -t app_role -t service_plan -t service_plan_version -t platform_setting -t reference_item /tmp/agritrace-before-full-seed.dump')
    Invoke-SeedDocker -Arguments @('exec', $taskPg, 'sh', '-c', 'exec pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --section=post-data --no-owner --exit-on-error /tmp/agritrace-before-full-seed.dump')
    @{ resetComplete=$true; database='agri_trace'; at=(Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskLocal 'reset.json') -Encoding utf8
    Write-Output 'Consistent backup verified; existing database schema restored empty with original guards and reference catalogs.'
}
Invoke-SeedDocker -Arguments @('start', $taskApi)
if (-not $Verify -and -not @($taskContainers[0].Config.Env | Where-Object { $_ -match '^PLATFORM_SECRET_KEY=.+$' }).Count) {
    & node (Join-Path $PSScriptRoot 'configure-local-platform.mjs') >> $taskLog 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'Could not prepare the local privacy encryption configuration.' }
    Invoke-SeedDocker -Arguments @('compose','--env-file','.env.docker','-p','agri-trace-demo-local','-f','docker-compose.yml','-f','.codex/local-demo-compose.override.yml','-f','.codex/seed-current/runtime.override.json','up','-d','--no-deps','api')
}
# The operator runs on the host. Signing keys never enter the API container.
$taskSavedEnvironment = @{}
$taskHostConnection = [UriBuilder]$taskConnection
$taskHostConnection.Host = '127.0.0.1'
$taskHostConnection.Port = 5433
$taskSeedEnvironment = @{DATABASE_URL=$taskHostConnection.Uri.AbsoluteUri; FABRIC_ENABLED='false'; PUBLIC_TRACE_BASE_URL='http://localhost:3000/trace'; AGRITRACE_LOCAL_SEED_TARGET='agri-trace-demo-local/agri_trace'}
foreach ($taskName in $taskSeedEnvironment.Keys) { $taskSavedEnvironment[$taskName]=[Environment]::GetEnvironmentVariable($taskName,'Process'); [Environment]::SetEnvironmentVariable($taskName,$taskSeedEnvironment[$taskName],'Process') }
try {
    $taskScript = if($Verify){'verify-seed.mjs'}else{'full-seed.mjs'}
    & node (Join-Path $PSScriptRoot $taskScript) >> $taskLog 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'Seed command failed; inspect private operator log. Dataset checkpoint retained for resume.' }
} finally {
    foreach ($taskName in $taskSavedEnvironment.Keys) { [Environment]::SetEnvironmentVariable($taskName,$taskSavedEnvironment[$taskName],'Process') }
}
Write-Output 'Seed stage finished; inspect checkpoint and verification receipt before restoring Web/Worker.'
if ($Verify) {
    Invoke-SeedDocker -Arguments @('start', $taskWorker, $taskWeb)
    Write-Output 'Verification passed; Web and Worker started. Fabric-disabled readiness remains explicit.'
}
} finally {
    $taskSeedLock.Dispose()
}
