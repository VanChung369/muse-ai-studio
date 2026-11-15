#!/usr/bin/env bash
# Muse AI Studio: start the installed app (macOS / Linux). Run bash install.sh first.
#
#   bash start.sh [--port 18610] [--lan] [--no-browser]
#
# One server answers the interface, the API (/api) and the public API (/v1).
# --lan listens on every network address instead of this computer only; the
# app has no login, so do that only on a network you trust.

# "sh start.sh" runs dash on Debian/Ubuntu, which cannot read this script.
if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT=18610
HOST=127.0.0.1
BROWSER_OPEN=1
while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --lan) HOST=0.0.0.0; shift ;;
    --no-browser) BROWSER_OPEN=0; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# uv where its installer puts it, and the FFmpeg install.sh may have downloaded.
export PATH="$ROOT/.tools/ffmpeg/bin:$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
if ! command -v uv >/dev/null 2>&1 || [ ! -f "$ROOT/frontend/dist/index.html" ]; then
  echo "Muse AI Studio is not installed yet. Run: bash install.sh" >&2
  exit 1
fi
printf '\033[32mMuse AI Studio: http://127.0.0.1:%s\033[0m  (Ctrl+C to stop)\n' "$PORT"
[ "$BROWSER_OPEN" -eq 1 ] && ( sleep 4; (command -v open >/dev/null && open "http://127.0.0.1:$PORT") || \
  (command -v xdg-open >/dev/null && xdg-open "http://127.0.0.1:$PORT") || true ) >/dev/null 2>&1 &
cd "$ROOT/backend"
exec uv run --locked uvicorn app.main:app --host "$HOST" --port "$PORT"
