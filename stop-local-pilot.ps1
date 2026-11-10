$ErrorActionPreference = 'Stop'
$pidFile = Join-Path $PSScriptRoot '.pilot-state\server.pid'
if (Test-Path -LiteralPath $pidFile) {
    $recordedId = [int](Get-Content -LiteralPath $pidFile -Raw)
    $entry = Join-Path $PSScriptRoot 'server\test\local-pilot.mjs'
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$recordedId"
    if ($process) {
        if (-not $process.CommandLine.Contains($entry)) { throw 'PID belongs to a different process. Nothing was stopped.' }
        Stop-Process -Id $recordedId
    }
    Remove-Item -LiteralPath $pidFile
}
Write-Output 'Stopped only the local BeautyFlow web pilot. The isolated database remains running; RMA is unchanged.'
