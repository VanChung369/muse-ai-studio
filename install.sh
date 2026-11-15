#!/usr/bin/env bash
# Muse AI Studio: install everything in one go (macOS / Linux, x64 or ARM64).
#
#   bash install.sh            install, then start
#   bash install.sh --no-start install only
#
# Whatever is missing is put in place without sudo: uv (which brings Python),
# Node.js and FFmpeg (downloaded into .tools/ in this folder unless the
# machine has them), and Playwright's Chromium when the machine has no
# Chrome, Chromium, Edge or Brave. sudo is only asked for on Linux, for curl
# when neither curl nor wget is there and for the libraries Chromium needs.
# Then the backend's Python environment and a production build of the
# interface, which the backend serves. Afterwards start the app with
# bash start.sh and open http://127.0.0.1:18610.

# "sh install.sh" runs dash on Debian/Ubuntu, which cannot read this script.
if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOLS="$ROOT/.tools"
NODE_LINE=24                          # the Node.js release line downloaded when none is installed
FFMPEG_PACKAGE="imageio-ffmpeg==0.8.1" # a self-contained FFmpeg for every platform, from PyPI
START=1
for arg in "$@"; do
  case "$arg" in
    --no-start) START=0 ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

step() { printf '\n\033[36m==> %s\033[0m\n' "$1"; }
fail() { echo "$1" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }
download() {  # download <url> <file>
  if have curl; then curl -fsSL --retry 3 -o "$2" "$1"; else wget -q -O "$2" "$1"; fi
}
sha256() {
  if have sha256sum; then sha256sum "$1" | cut -d ' ' -f 1; else shasum -a 256 "$1" | cut -d ' ' -f 1; fi
}
as_root() { if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi; }
can_be_root() { [ "$(id -u)" -eq 0 ] || have sudo; }
use_tools() {  # tools this script downloaded come first on PATH
  local dir
  for dir in "$TOOLS/ffmpeg/bin" "$TOOLS/node/bin" "$HOME/.local/bin" "$HOME/.cargo/bin"; do
    if [ -d "$dir" ]; then
      case ":$PATH:" in *":$dir:"*) ;; *) PATH="$dir:$PATH" ;; esac
    fi
  done
  export PATH
}
node_ok() {
  have node || return 1
  local version major minor
  version="$(node --version 2>/dev/null)" || return 1
  version="${version#v}"; major="${version%%.*}"; minor="${version#*.}"; minor="${minor%%.*}"
  case "$major$minor" in *[!0-9]*|'') return 1 ;; esac
  [ "$major" -gt 22 ] || { [ "$major" -eq 22 ] && [ "$minor" -ge 12 ]; }
}

system_install() {  # system_install <apt packages> <dnf/yum> <pacman> <zypper>; fails when it cannot
  can_be_root || return 1
  # shellcheck disable=SC2086 # each argument is a list of package names
  if have apt-get; then
    # A broken third-party source makes the update fail, yet the install still works.
    as_root apt-get update -qq || true
    as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq $1
  elif have dnf; then as_root dnf install -y -q $2
  elif have yum; then as_root yum install -y -q $2
  elif have pacman; then as_root pacman -S --noconfirm --needed $3
  elif have zypper; then as_root zypper --non-interactive install $4
  else return 1
  fi
}

driver_ok() {  # whether Playwright's own Node.js runs (on Linux it needs libatomic)
  local node
  for node in "$ROOT"/backend/.venv/lib/python3*/site-packages/playwright/driver/node; do
    if [ -x "$node" ] && "$node" --version >/dev/null 2>&1; then return 0; fi
  done
  return 1
}

install_node() {
  local base="https://nodejs.org/dist/latest-v$NODE_LINE.x" work line sum name
  echo "Downloading Node.js $NODE_LINE ($OS-$ARCH) into .tools/node..."
  work="$(mktemp -d)"
  download "$base/SHASUMS256.txt" "$work/sums"
  line="$(grep -E "^[0-9a-f]{64}  node-v[0-9.]+-$OS-$ARCH\.tar\.gz\$" "$work/sums" || true)"
  [ -n "$line" ] || fail "No Node.js $NODE_LINE download for $OS-$ARCH was found."
  line="$(printf '%s\n' "$line" | sed -n 1p)"
  sum="${line%% *}"; name="${line##* }"
  download "$base/$name" "$work/$name"
  [ "$(sha256 "$work/$name")" = "$sum" ] || fail "The Node.js download is damaged. Run this script again."
  rm -rf "$TOOLS/node"; mkdir -p "$TOOLS/node"
  tar -xzf "$work/$name" -C "$TOOLS/node" --strip-components 1
  rm -rf "$work"
  use_tools
}

install_ffmpeg() {  # a failed download only costs the FFmpeg features: the caller warns
  local unpacked="$TOOLS/ffmpeg-download" binary
  echo "Downloading FFmpeg into .tools/ffmpeg..."
  rm -rf "$unpacked"
  if ! uv pip install --quiet --python "$ROOT/backend/.venv/bin/python" --target "$unpacked" "$FFMPEG_PACKAGE"; then
    rm -rf "$unpacked"
    return 0
  fi
  for binary in "$unpacked"/imageio_ffmpeg/binaries/ffmpeg-*; do
    case "$binary" in *.md|*.txt) continue ;; esac
    if [ -f "$binary" ]; then
      mkdir -p "$TOOLS/ffmpeg/bin"
      cp "$binary" "$TOOLS/ffmpeg/bin/ffmpeg"
      chmod +x "$TOOLS/ffmpeg/bin/ffmpeg"
      break
    fi
  done
  rm -rf "$unpacked"
  use_tools
}

# Asks the backend which browser it would drive, so this agrees with the app.
# "find" looks at the machine only; "launch" also accepts Playwright's
# Chromium and starts the browser once to prove it works.
BROWSER_CHECK="
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
"

case "$(uname -s)" in
  Darwin) OS=darwin ;;
  Linux) OS=linux ;;
  *) fail "This script is for macOS and Linux. On Windows run install.cmd (or install.ps1)." ;;
esac
case "$(uname -m)" in
  x86_64|amd64) ARCH=x64 ;;
  arm64|aarch64) ARCH=arm64 ;;
  *) fail "Muse AI Studio needs a 64-bit Intel/AMD or ARM computer (this one is $(uname -m))." ;;
esac
if [ "$OS" = darwin ] && [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = 1 ]; then
  ARCH=arm64  # Apple silicon, even when this shell runs under Rosetta
fi
if [ "$OS" = linux ]; then
  case "$(ldd --version 2>&1 || true)" in
    *musl*) fail "Linux with musl (such as Alpine) is not supported: Chromium and Node.js need glibc. Use Debian, Ubuntu, Fedora or similar." ;;
  esac
fi
use_tools

step "Checking the tools"
if ! have curl && ! have wget; then
  echo "Installing curl..."
  system_install "curl ca-certificates" curl curl curl || fail "Install curl, then run this script again."
fi
if ! have uv; then
  echo "Installing uv (Python package manager)..."
  work="$(mktemp -d)"
  download https://astral.sh/uv/install.sh "$work/uv-install.sh"
  sh "$work/uv-install.sh"
  rm -rf "$work"
  use_tools
fi
have uv || fail "uv could not be installed. See https://docs.astral.sh/uv/"
node_ok || install_node
node_ok || fail "Node.js $NODE_LINE could not be set up in .tools/node. Run this script again."
echo "$(uv --version), Node.js $(node --version)"

step "Backend: Python environment"
cd "$ROOT/backend"
uv sync --locked
if [ ! -f .env ] && [ -f .env.example ]; then
  cp .env.example .env
  echo "Created backend/.env from .env.example (edit it to change settings)."
fi
have ffmpeg || install_ffmpeg
if have ffmpeg; then
  echo "FFmpeg: $(command -v ffmpeg)"
else
  echo "Warning: FFmpeg is missing: thumbnails, uploads and joining clips will not work." >&2
fi

if [ "$OS" = linux ] && ! driver_ok; then
  echo "Installing libatomic, which Playwright needs..."
  system_install libatomic1 libatomic gcc-libs libatomic1 || true
  driver_ok || echo "Warning: Playwright cannot run until libatomic is installed (package libatomic1 or libatomic)." >&2
fi
browser="$(uv run --locked python -c "$BROWSER_CHECK" find 2>/dev/null | tail -n 1)" || browser=""
if [ -z "$browser" ]; then
  echo "No Chrome, Chromium, Edge or Brave found: downloading Playwright's Chromium..."
  if [ "$OS" = linux ] && have apt-get && can_be_root; then
    # Also the system libraries Chromium needs (asks for the sudo password).
    uv run --locked playwright install --with-deps --no-shell chromium || true
  else
    uv run --locked playwright install --no-shell chromium || true
  fi
fi
if browser="$(uv run --locked python -c "$BROWSER_CHECK" launch | tail -n 1)" && [ -n "$browser" ]; then
  echo "Browser: $browser"
else
  echo "Warning: the browser could not be started, so Muse cannot be reached. Install Chrome or Chromium" >&2
  echo "(on Linux, the libraries it needs: uv run playwright install-deps chromium), or set MUSE_BROWSER_PATH in backend/.env." >&2
fi

step "Interface: production build"
cd "$ROOT/frontend"
npm ci --no-audit --no-fund
npm run build

printf '\n\033[32mInstalled.\033[0m Start the app any time with: bash start.sh\nthen open http://127.0.0.1:18610\n'
if [ "$START" -eq 1 ]; then
  exec bash "$ROOT/start.sh"
fi
