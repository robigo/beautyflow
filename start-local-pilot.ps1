$ErrorActionPreference = 'Stop'
$pilotRoot = $PSScriptRoot
$serverRoot = Join-Path $pilotRoot 'server'
$stateDir = Join-Path $pilotRoot '.pilot-state'
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
$containerName = 'beautyflow-pilot-postgres-20261108'
$existing = & docker inspect $containerName 2>$null
if ($LASTEXITCODE -eq 0) {
    $container = ($existing | ConvertFrom-Json)[0]
    $binding = $container.HostConfig.PortBindings.'5432/tcp'
    if ($container.Config.Image -ne 'postgres:16-alpine' -or
        'POSTGRES_DB=beautyflow_ci' -notin $container.Config.Env -or
        'POSTGRES_USER=beautyflow_ci' -notin $container.Config.Env -or
        $binding.Count -ne 1 -or $binding[0].HostIp -ne '127.0.0.1' -or $binding[0].HostPort -ne '15439') {
        throw 'A different container uses the pilot name. Refusing to touch it.'
    }
    if (-not $container.State.Running) { & docker start $containerName | Out-Null; if ($LASTEXITCODE) { throw 'Could not start the pilot database.' } }
} else {
    & docker run -d --name $containerName -p 127.0.0.1:15439:5432 --tmpfs /var/lib/postgresql/data:rw -e POSTGRES_DB=beautyflow_ci -e POSTGRES_USER=beautyflow_ci -e POSTGRES_PASSWORD=beautyflow_ci_only postgres:16-alpine | Out-Null
    if ($LASTEXITCODE) { throw 'Could not create the disposable pilot database.' }
}
$ready = $false
for ($attempt = 0; $attempt -lt 20; $attempt++) {
    & docker exec $containerName pg_isready -U beautyflow_ci -d beautyflow_ci *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Milliseconds 500
}
if (-not $ready) { throw 'Pilot database is not ready.' }
$entry = Join-Path $serverRoot 'test\local-pilot.mjs'
$pidFile = Join-Path $stateDir 'server.pid'
if (Test-Path -LiteralPath $pidFile) {
    $recordedId = [int](Get-Content -LiteralPath $pidFile -Raw)
    $recorded = Get-CimInstance Win32_Process -Filter "ProcessId=$recordedId"
    if ($recorded -and $recorded.CommandLine.Contains($entry)) {
        Write-Output 'Local BeautyFlow pilot is already running: http://127.0.0.1:18080/'
        exit 0
    }
}
$env:DATABASE_URL = 'postgresql://beautyflow_ci:beautyflow_ci_only@127.0.0.1:15439/beautyflow_ci'
$env:JWT_SECRET = 'local-pilot-' + [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
$env:CLIENT_ORIGIN = 'http://127.0.0.1:18080'
if ($env:RESEND_API_KEY -and $env:RESEND_API_KEY -ne 'LOCAL-CAPTURE-NOT-A-REAL-KEY') { throw 'Refusing to use a real mail key in the local pilot.' }
$env:RESEND_API_KEY = 'LOCAL-CAPTURE-NOT-A-REAL-KEY'
$nodeExe = (Get-Command node.exe).Source
Push-Location $serverRoot
try {
    & $nodeExe $entry --migrate-only
    if ($LASTEXITCODE) { throw 'Guarded local migration failed.' }
} finally { Pop-Location }
$process = Start-Process -FilePath $nodeExe -ArgumentList ('"' + $entry + '"') -WorkingDirectory $serverRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $stateDir 'server.out.log') -RedirectStandardError (Join-Path $stateDir 'server.error.log')
Set-Content -LiteralPath $pidFile -Value $process.Id -Encoding ascii
Write-Output 'Started local BeautyFlow pilot: http://127.0.0.1:18080/'
Write-Output 'Captured test mailbox: http://127.0.0.1:18080/pilot/inbox'
Write-Output 'Synthetic data only. No real email is sent; Production and RMA are unchanged.'
