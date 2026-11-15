# Muse AI Studio: start the installed app (Windows). Run install.cmd / install.ps1 first.
#
#   start.cmd  (double-click it)
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

# uv where its installer puts it, and the FFmpeg install.ps1 may have downloaded.
foreach ($dir in @("$env:USERPROFILE\.local\bin", "$env:USERPROFILE\.cargo\bin", "$Root\.tools\ffmpeg\bin")) {
    if ((Test-Path $dir) -and -not (($env:Path -split ";") -contains $dir)) { $env:Path = "$dir;$env:Path" }
}
if (-not (Get-Command uv -ErrorAction SilentlyContinue) -or -not (Test-Path "$Root\frontend\dist\index.html")) {
    throw "Muse AI Studio is not installed yet. Run install.cmd (or install.ps1) first."
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
