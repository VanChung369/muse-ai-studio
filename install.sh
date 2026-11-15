#!/usr/bin/env bash
# Muse AI Studio: install everything in one go (macOS / Linux).
#
#   ./install.sh            install, then start
#   ./install.sh --no-start install only
#
# Installs what is missing (uv; Node.js and FFmpeg through Homebrew, apt,
# dnf or pacman when one is available), the backend's Python environment,
# and a production build of the interface, which the backend then serves.
# Afterwards start the app with ./start.sh and open http://127.0.0.1:18610.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
START=1
[ "${1:-}" = "--no-start" ] && START=0

step() { printf '\n\033[36m==> %s\033[0m\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }
sudo_if() { if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi; }

package() {  # package <what> <brew> <apt> <dnf> <pacman>
  local what="$1"
  if have brew; then brew install "$2"
  elif have apt-get; then sudo_if apt-get update && sudo_if apt-get install -y "$3"
  elif have dnf; then sudo_if dnf install -y "$4"
  elif have pacman; then sudo_if pacman -S --noconfirm "$5"
  else echo "Install $what yourself, then run this script again." >&2; exit 1
  fi
}

node_ok() {
  have node || return 1
  local version major minor
  version="$(node --version)"; version="${version#v}"
  major="${version%%.*}"; minor="${version#*.}"; minor="${minor%%.*}"
  [ "$major" -gt 22 ] || { [ "$major" -eq 22 ] && [ "$minor" -ge 12 ]; }
}

step "Checking the tools"
if ! have uv; then
  echo "Installing uv (Python package manager)..."
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
fi
have uv || { echo "uv could not be installed. See https://docs.astral.sh/uv/" >&2; exit 1; }
if ! node_ok; then
  echo "Node.js 22.12+ is needed."
  if have brew; then brew install node
  elif have apt-get; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo_if bash -
    sudo_if apt-get install -y nodejs
  else package "Node.js 22.12+" node nodejs nodejs nodejs
  fi
fi
node_ok || { echo "Node.js 22.12+ is still missing. Install it, then run this script again." >&2; exit 1; }
have ffmpeg || package "FFmpeg" ffmpeg ffmpeg ffmpeg ffmpeg
have google-chrome || have chromium || have chromium-browser || have microsoft-edge || \
  [ -d "/Applications/Google Chrome.app" ] || [ -d "/Applications/Brave Browser.app" ] || \
  echo "Warning: no Chrome or Chromium found. Install one, or set MUSE_BROWSER_PATH in backend/.env." >&2

step "Backend: Python environment"
cd "$ROOT/backend"
uv sync --locked
if [ ! -f .env ] && [ -f .env.example ]; then
  cp .env.example .env
  echo "Created backend/.env from .env.example (edit it to change settings)."
fi

step "Interface: production build"
cd "$ROOT/frontend"
npm ci --no-audit --no-fund
npm run build

printf '\n\033[32mInstalled.\033[0m Start the app any time with ./start.sh, then open http://127.0.0.1:18610\n'
if [ "$START" -eq 1 ]; then
  exec bash "$ROOT/start.sh"
fi
