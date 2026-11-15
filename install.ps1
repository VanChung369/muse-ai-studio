# Muse AI Studio: install everything in one go (Windows).
#
#   powershell -ExecutionPolicy Bypass -File install.ps1          install, then start
#   powershell -ExecutionPolicy Bypass -File install.ps1 -NoStart install only
#
# Installs what is missing (uv, Node.js LTS, FFmpeg via winget), the backend's
# Python environment, and a production build of the interface, which the
# backend then serves. Afterwards start the app with start.ps1 and open
# http://127.0.0.1:18610 (the port can be changed with -Port).
param(
    [switch]$NoStart,
    [int]$Port = 18610
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Have($name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }
function Refresh-Path {
    $parts = @(
        [Environment]::GetEnvironmentVariable("Path", "Machine"),
        [Environment]::GetEnvironmentVariable("Path", "User"),
        "$env:USERPROFILE\.local\bin",
        "$env:USERPROFILE\.cargo\bin",
        $env:Path
    ) -join ";" -split ";" | Where-Object { $_ } | Select-Object -Unique
    $env:Path = $parts -join ";"
}
function Node-Ok {
    if (-not (Have "node")) { return $false }
    $version = (node --version).TrimStart("v").Split(".")
    return ([int]$version[0] -gt 22) -or ([int]$version[0] -eq 22 -and [int]$version[1] -ge 12)
}
function Winget-Install($id, $what) {
    if (-not (Have "winget")) {
        throw "$what is missing and winget is not available. Install $what yourself, then run this script again."
    }
    Write-Host "Installing $what with winget..."
    winget install --id $id -e --silent --accept-package-agreements --accept-source-agreements | Out-Host
    Refresh-Path
}
function Run($what, [scriptblock]$command) {
    & $command
    if ($LASTEXITCODE -ne 0) { throw "$what failed (exit code $LASTEXITCODE)." }
}

Step "Checking the tools"
if (-not (Have "uv")) {
    Write-Host "Installing uv (Python package manager)..."
    powershell -ExecutionPolicy Bypass -NoProfile -Command "irm https://astral.sh/uv/install.ps1 | iex" | Out-Host
    Refresh-Path
    if (-not (Have "uv")) { throw "uv could not be installed. See https://docs.astral.sh/uv/" }
}
if (-not (Node-Ok)) { Winget-Install "OpenJS.NodeJS.LTS" "Node.js 22.12+" }
if (-not (Node-Ok)) { throw "Node.js 22.12+ is still not on PATH. Open a new terminal and run this script again." }
if (-not (Have "ffmpeg")) { Winget-Install "Gyan.FFmpeg" "FFmpeg" }
if (-not (Have "ffmpeg")) {
    Write-Warning "FFmpeg is not on PATH yet. Open a new terminal later, or set MUSE_FFMPEG_PATH in backend\.env."
}
$browsers = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
if (-not ($browsers | Where-Object { $_ -and (Test-Path $_) })) {
    Write-Warning "No Chrome, Edge or Brave found. Install one, or set MUSE_BROWSER_PATH in backend\.env."
}

Step "Backend: Python environment"
Push-Location "$Root\backend"
try {
    Run "uv sync" { uv sync --locked }
    if (-not (Test-Path ".env") -and (Test-Path ".env.example")) {
        Copy-Item ".env.example" ".env"
        Write-Host "Created backend\.env from .env.example (edit it to change settings)."
    }
} finally { Pop-Location }

Step "Interface: production build"
Push-Location "$Root\frontend"
try {
    Run "npm ci" { npm ci --no-audit --no-fund }
    Run "npm run build" { npm run build }
} finally { Pop-Location }

Write-Host "`nInstalled. Start the app any time with:" -ForegroundColor Green
Write-Host "    powershell -ExecutionPolicy Bypass -File start.ps1"
Write-Host "then open http://127.0.0.1:$Port"

if (-not $NoStart) {
    & "$Root\start.ps1" -Port $Port
    exit $LASTEXITCODE
}
