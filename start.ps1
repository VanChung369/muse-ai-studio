# Muse AI Studio: start the installed app (Windows). Run install.ps1 first.
#
#   powershell -ExecutionPolicy Bypass -File start.ps1 [-Port 18610] [-Lan] [-NoBrowser]
#
# One server answers the interface, the API (/api) and the public API (/v1).
# -Lan listens on every network address instead of this computer only; the
# app has no login, so do that only on a network you trust.
param(
    [int]$Port = 18610,
    [switch]$Lan,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Address = if ($Lan) { "0.0.0.0" } else { "127.0.0.1" }

if (-not (Test-Path "$Root\frontend\dist\index.html")) {
    throw "The interface is not built yet. Run install.ps1 first."
}
Write-Host "Muse AI Studio: http://127.0.0.1:$Port  (Ctrl+C to stop)" -ForegroundColor Green
if (-not $NoBrowser) {
    Start-Job -ScriptBlock {
        param($url)
        Start-Sleep -Seconds 4
        Start-Process $url
    } -ArgumentList "http://127.0.0.1:$Port" | Out-Null
}
Push-Location "$Root\backend"
try {
    uv run --locked uvicorn app.main:app --host $Address --port $Port
    $ServerExitCode = $LASTEXITCODE
} finally { Pop-Location }
exit $ServerExitCode
