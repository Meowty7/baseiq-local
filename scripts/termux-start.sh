#!/usr/bin/env bash
# En el teléfono, desde la raíz del repo:  bash scripts/termux-start.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PATH="$HOME/.bun/bin:$PATH"
export QVAC_CONFIG_PATH="${QVAC_CONFIG_PATH:-$ROOT/qvac.config.mjs}"
export QVAC_DEVICE="${QVAC_DEVICE:-cpu}"
export SKIP_SEED="${SKIP_SEED:-1}"
export PORT="${PORT:-3001}"
URL="http://127.0.0.1:${PORT}"

in_termux=0
if [ -n "${TERMUX_VERSION:-}" ] || [ "${PREFIX:-}" = "/data/data/com.termux/files/usr" ]; then
  in_termux=1
fi

if [ "$in_termux" -eq 1 ]; then
  command -v termux-wake-lock >/dev/null && termux-wake-lock || true
  mkdir -p "$HOME/.shortcuts"
  printf '%s\n' '#!/usr/bin/env bash' "exec bash \"$ROOT/scripts/termux-start.sh\"" > "$HOME/.shortcuts/BaseIQ"
  chmod +x "$HOME/.shortcuts/BaseIQ"
fi

if ! command -v bun >/dev/null; then
  echo "▸ instalando Bun…"
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi

if [ ! -d node_modules/@qvac/sdk ]; then
  echo "▸ bun install (primera vez, tarda)…"
  bun install
fi

if [ ! -f dist/index.html ]; then
  echo "▸ build…"
  bunx vite build
fi

if [ "$in_termux" -eq 1 ]; then
  (
    sleep 2
    if command -v termux-open-url >/dev/null; then
      termux-open-url "$URL"
    elif command -v am >/dev/null; then
      am start -a android.intent.action.VIEW -d "$URL" >/dev/null 2>&1 || true
    fi
  ) &
  echo "▸ $URL  (Chrome se abre solo; deja Termux en primer plano)"
fi

exec bun run start
