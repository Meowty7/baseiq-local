#!/usr/bin/env bash
# En el teléfono, desde la raíz del repo:  bash scripts/termux-start.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export QVAC_CONFIG_PATH="${QVAC_CONFIG_PATH:-$ROOT/qvac.config.mjs}"
export QVAC_DEVICE="${QVAC_DEVICE:-cpu}"
export SKIP_SEED="${SKIP_SEED:-1}"
export PORT="${PORT:-3001}"
URL="http://127.0.0.1:${PORT}"

in_termux=0
if [ -n "${TERMUX_VERSION:-}" ] || [ "${PREFIX:-}" = "/data/data/com.termux/files/usr" ]; then
  in_termux=1
fi

# bun.sh instala glibc; en Android no corre y tapa el bun de Termux si va primero.
if [ "$in_termux" -eq 1 ]; then
  export PATH="${PREFIX:-/data/data/com.termux/files/usr}/bin:$PATH"
else
  export PATH="$HOME/.bun/bin:$PATH"
fi

bun_ok() {
  command -v bun >/dev/null 2>&1 && bun --version >/dev/null 2>&1
}

ensure_bun() {
  if bun_ok; then
    return 0
  fi
  if [ "$in_termux" -eq 1 ] && command -v pkg >/dev/null; then
    echo "▸ instalando Bun (pkg, no bun.sh)…"
    pkg install -y bun || { pkg install -y tur-repo && pkg install -y bun; }
    hash -r
  else
    echo "▸ instalando Bun…"
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
    hash -r
  fi
  if ! bun_ok; then
    echo "bun no quedó instalado. En Termux: pkg install bun" >&2
    exit 1
  fi
}

if [ "$in_termux" -eq 1 ]; then
  command -v termux-wake-lock >/dev/null && termux-wake-lock || true
  mkdir -p "$HOME/.shortcuts"
  printf '%s\n' '#!/usr/bin/env bash' "exec bash \"$ROOT/scripts/termux-start.sh\"" > "$HOME/.shortcuts/BaseIQ"
  chmod +x "$HOME/.shortcuts/BaseIQ"
fi

ensure_bun

# QVAC spawnea un worker Bare. El linker aislado de Bun deja @qvac/sdk en
# ~/.bun/install/cache y no resuelve bare-runtime/spawn.
ensure_qvac_native() {
  if [ "$in_termux" -eq 1 ]; then
    if [ -L node_modules/@qvac/sdk ] || [ ! -f node_modules/bare-runtime/lib/spawn.js ]; then
      echo "▸ bun install --linker=hoisted…"
      bun install --linker=hoisted --backend=copyfile || bun install --linker=hoisted
    fi
    local plat arch android_pkg linux_alias
    plat="$(bun -e 'process.stdout.write(process.platform)')"
    arch="$(bun -e 'process.stdout.write(process.arch)')"
    android_pkg="bare-runtime-android-arm64"
    [ "$arch" = "arm" ] && android_pkg="bare-runtime-android-arm"
    if [ ! -d "node_modules/${android_pkg}" ]; then
      echo "▸ ${android_pkg}…"
      bun add --exact "${android_pkg}@1.32.0" --linker=hoisted || bun add --exact "${android_pkg}@1.32.0"
    fi
    # bun en Termux a menudo reporta linux; el binario glibc no corre en Android
    if [ "$plat" = "linux" ]; then
      linux_alias="node_modules/bare-runtime-linux-${arch}"
      if [ ! -f "${linux_alias}/index.js" ]; then
        mkdir -p "$linux_alias"
        printf '%s\n' "{\"name\":\"bare-runtime-linux-${arch}\",\"main\":\"index.js\"}" > "${linux_alias}/package.json"
        printf '%s\n' "module.exports = require('${android_pkg}')" > "${linux_alias}/index.js"
      fi
    fi
    return
  fi
  if [ ! -d node_modules/@qvac/sdk ]; then
    echo "▸ bun install (primera vez, tarda)…"
    bun install
  fi
}

ensure_qvac_native

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
