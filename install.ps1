# Muse AI Studio: install everything in one go (Windows 10/11, x64 or ARM64).
#
#   install.cmd  (double-click it)                                install, then start
#   powershell -ExecutionPolicy Bypass -File install.ps1          install, then start
#   powershell -ExecutionPolicy Bypass -File install.ps1 -NoStart install only
#
# Needs no administrator rights and no winget. Whatever is missing is put in
# place: uv (which brings Python), Node.js and FFmpeg (downloaded into .tools\
# in this folder unless the machine has them), and Playwright's Chromium when
# the machine has no Chrome, Edge or Brave. Then the backend's Python
# environment and a production build of the interface, which the backend
# serves. Afterwards start the app with start.cmd (or start.ps1) and open
# http://127.0.0.1:18610 (the port can be changed with -Port).
param(
    [switch]$NoStart,
    [int]$Port = 18610
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"  # downloads are many times slower with the progress bar
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Tools = Join-Path $Root ".tools"
$NodeLine = 24                           # the Node.js release line downloaded when none is installed
$FfmpegPackage = "imageio-ffmpeg==0.8.1" # a self-contained FFmpeg for every platform, from PyPI

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Have($name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }
function Remove-Dir($path) { if (Test-Path $path) { Remove-Item $path -Recurse -Force } }
function Use-Tools {
    # Tools this script downloaded come first on PATH, then uv where its
    # installer puts it.
    foreach ($dir in @("$env:USERPROFILE\.cargo\bin", "$env:USERPROFILE\.local\bin", "$Tools\ffmpeg\bin", "$Tools\node")) {
        if ((Test-Path $dir) -and -not (($env:Path -split ";") -contains $dir)) {
            $env:Path = "$dir;$env:Path"
        }
    }
}
function Run($what, [scriptblock]$command) {
    & $command
    if ($LASTEXITCODE -ne 0) { throw "$what failed (exit code $LASTEXITCODE)." }
}
function Get-Arch {
    $arch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
    switch ($arch) {
        "AMD64" { return "x64" }
        "ARM64" { return "arm64" }
        default { throw "Muse AI Studio needs 64-bit Windows (this computer is $arch)." }
    }
}
function Node-Ok {
    if (-not (Have "node")) { return $false }
    try { $version = (node --version).TrimStart("v").Split(".") } catch { return $false }
    return ([int]$version[0] -gt 22) -or ([int]$version[0] -eq 22 -and [int]$version[1] -ge 12)
}
function Expand-Zip($zip, $destination) {
    # Windows' own tar unpacks a zip far faster than Expand-Archive.
    $tar = "$env:SystemRoot\System32\tar.exe"
    New-Item -ItemType Directory -Force $destination | Out-Null
    if (Test-Path $tar) {
        & $tar -xf $zip -C $destination
        if ($LASTEXITCODE -eq 0) { return }
    }
    Expand-Archive $zip $destination -Force
}
function Install-Node {
    $arch = Get-Arch
    $base = "https://nodejs.org/dist/latest-v$NodeLine.x"
    Write-Host "Downloading Node.js $NodeLine ($arch) into .tools\node..."
    $download = Join-Path ([IO.Path]::GetTempPath()) "muse-node-$PID"
    Remove-Dir $download
    New-Item -ItemType Directory -Force $download | Out-Null
    try {
        Invoke-WebRequest "$base/SHASUMS256.txt" -OutFile "$download\sums.txt" -UseBasicParsing
        $line = Get-Content "$download\sums.txt" | Where-Object { $_ -match "^[0-9a-f]{64}\s+node-v[\d.]+-win-$arch\.zip$" } | Select-Object -First 1
        if (-not $line) { throw "No Node.js $NodeLine download for Windows $arch was found." }
        $hash, $name = $line.Trim() -split "\s+"
        Invoke-WebRequest "$base/$name" -OutFile "$download\$name" -UseBasicParsing
        if ((Get-FileHash "$download\$name" -Algorithm SHA256).Hash -ne $hash) {
            throw "The Node.js download is damaged. Run this script again."
        }
        Expand-Zip "$download\$name" "$download\unpacked"
        Remove-Dir "$Tools\node"
        New-Item -ItemType Directory -Force $Tools | Out-Null
        Move-Item "$download\unpacked\$($name -replace '\.zip$', '')" "$Tools\node"
    } finally { Remove-Dir $download }
    Use-Tools
}
function Install-Ffmpeg {
    # A failed download only costs the FFmpeg features: the caller warns.
    Write-Host "Downloading FFmpeg into .tools\ffmpeg..."
    $unpacked = "$Tools\ffmpeg-download"
    Remove-Dir $unpacked
    try {
        uv pip install --quiet --python "$Root\backend\.venv\Scripts\python.exe" --target $unpacked $FfmpegPackage
        if ($LASTEXITCODE -ne 0) { return }
        $binary = Get-ChildItem "$unpacked\imageio_ffmpeg\binaries" -Filter "ffmpeg*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $binary) { return }
        New-Item -ItemType Directory -Force "$Tools\ffmpeg\bin" | Out-Null
        Copy-Item $binary.FullName "$Tools\ffmpeg\bin\ffmpeg.exe" -Force
    } finally { Remove-Dir $unpacked }
    Use-Tools
}

# Asks the backend which browser it would drive, so this agrees with the app.
# "find" looks at the machine only; "launch" also accepts Playwright's
# Chromium and starts the browser once to prove it works.
$BrowserCheck = @'
import sys
from playwright.sync_api import sync_playwright
from app.core.config import Settings
from app.integrations.muse.chat import _first_browser
launch = sys.argv[1:] == ['launch']
with sync_playwright() as playwright:
    bundled = playwright.chromium.executable_path if launch else None
    path = _first_browser(Settings().browser_path, bundled)
    if path and launch:
        playwright.chromium.launch(executable_path=path, headless=True).close()
    print(path or '')
'@

Use-Tools
$null = Get-Arch

Step "Checking the tools"
if (-not (Have "uv")) {
    Write-Host "Installing uv (Python package manager)..."
    powershell -ExecutionPolicy Bypass -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12; irm https://astral.sh/uv/install.ps1 | iex" | Out-Host
    Use-Tools
    if (-not (Have "uv")) { throw "uv could not be installed. See https://docs.astral.sh/uv/" }
}
if (-not (Node-Ok)) { Install-Node }
if (-not (Node-Ok)) { throw "Node.js $NodeLine could not be set up in .tools\node. Run this script again." }
Write-Host ("uv {0}, Node.js {1}" -f ((uv --version) -replace '^uv ', ''), (node --version))

Step "Backend: Python environment"
Push-Location "$Root\backend"
try {
    Run "uv sync" { uv sync --locked }
    if (-not (Test-Path ".env") -and (Test-Path ".env.example")) {
        Copy-Item ".env.example" ".env"
        Write-Host "Created backend\.env from .env.example (edit it to change settings)."
    }
    if (-not (Have "ffmpeg")) { Install-Ffmpeg }
    if (Have "ffmpeg") { Write-Host "FFmpeg: $((Get-Command ffmpeg).Source)" }
    else { Write-Warning "FFmpeg is missing: thumbnails, uploads and joining clips will not work." }

    $browser = (uv run --locked python -c $BrowserCheck find | Select-Object -Last 1)
    if (-not $browser) {
        Write-Host "No Chrome, Edge or Brave found: downloading Playwright's Chromium..."
        uv run --locked playwright install --no-shell chromium
        if ($LASTEXITCODE -ne 0) { Write-Warning "Chromium could not be downloaded (exit code $LASTEXITCODE)." }
    }
    $browser = (uv run --locked python -c $BrowserCheck launch | Select-Object -Last 1)
    if ($LASTEXITCODE -eq 0 -and $browser) { Write-Host "Browser: $browser" }
    else { Write-Warning "The browser could not be started, so Muse cannot be reached. Set MUSE_BROWSER_PATH in backend\.env to a Chrome or Edge." }
} finally { Pop-Location }

Step "Interface: production build"
Push-Location "$Root\frontend"
try {
    Run "npm ci" { npm ci --no-audit --no-fund }
    Run "npm run build" { npm run build }
} finally { Pop-Location }

Write-Host "`nInstalled. Start the app any time with start.cmd, or:" -ForegroundColor Green
Write-Host "    powershell -ExecutionPolicy Bypass -File start.ps1"
Write-Host "then open http://127.0.0.1:$Port"

if (-not $NoStart) {
    & "$Root\start.ps1" -Port $Port
    exit $LASTEXITCODE
}
