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

# QVAC spawnea un worker Bare. En Termux el binario glibc y LD_PRELOAD
# (termux-exec) abortan el proceso (SIGABRT, stderr vacío).
is_elf() {
  [ -f "$1" ] && [ "$(od -An -N4 -tx1 "$1" 2>/dev/null | tr -d ' \n')" = "7f454c46" ]
}

# `timeout` de GNU coreutils no viene por defecto en Termux. Sin cota, un
# addon que se cuelga esperando un driver que no existe congela el arranque
# para siempre — ya nos pasó una vez con Vulkan.
run_with_timeout() {
  local secs="$1"; shift
  "$@" &
  local pid=$!
  ( sleep "$secs"; kill -KILL "$pid" 2>/dev/null ) &
  local watcher=$!
  local rc=0
  wait "$pid" 2>/dev/null || rc=$?
  kill "$watcher" 2>/dev/null
  wait "$watcher" 2>/dev/null
  return "$rc"
}

wrap_bare_bin() {
  local bin="$1"
  is_elf "$bin" || return 0
  mv "$bin" "${bin}.real"
  printf '%s\n' '#!/system/bin/sh' 'unset LD_PRELOAD' 'DIR=$(dirname "$0")' 'exec "$DIR/bare.real" "$@"' > "$bin"
  chmod 755 "$bin" "${bin}.real"
}

force_android_bare() {
  local arch android_pkg plat
  plat="$(bun -e 'process.stdout.write(process.platform)')"
  arch="$(bun -e 'process.stdout.write(process.arch)')"
  android_pkg="bare-runtime-android-arm64"
  [ "$arch" = "arm" ] && android_pkg="bare-runtime-android-arm"
  echo "▸ bun ${plat}-${arch} → ${android_pkg}"
  if [ ! -d "node_modules/${android_pkg}" ]; then
    bun add --exact "${android_pkg}@1.32.0" --linker=hoisted || bun add --exact "${android_pkg}@1.32.0"
  fi
  # Siempre pisa el paquete linux: si existe el glibc, Bare muere con SIGABRT.
  local plat_pkg dest
  for plat_pkg in linux-arm64 linux-arm linux-x64; do
    dest="node_modules/bare-runtime-${plat_pkg}"
    rm -rf "$dest"
    mkdir -p "$dest"
    printf '%s\n' "{\"name\":\"bare-runtime-${plat_pkg}\",\"main\":\"index.js\"}" > "${dest}/package.json"
    printf '%s\n' "module.exports = require('${android_pkg}')" > "${dest}/index.js"
  done
  wrap_bare_bin "node_modules/${android_pkg}/bin/bare"
}


# Bun en Termux ejecuta @qvac/sdk desde ~/.bun/install/cache; desde ahí
# no ve bare-runtime ni @qvac/inference del proyecto.
graft_sdk_cache() {
  export NODE_PATH="$ROOT/node_modules${NODE_PATH:+:$NODE_PATH}"
  local resolved cache name
  resolved="$(bun -e 'console.log(require.resolve("@qvac/sdk"))')"
  echo "▸ @qvac/sdk ${resolved}"
  case "$resolved" in
    *"/install/cache/"*)
      cache="${resolved%%/install/cache/*}/install/cache"
      echo "▸ graft ${cache}/node_modules (toda la caché)"
      mkdir -p "$cache/node_modules/@qvac"
      for name in "$ROOT"/node_modules/@qvac/*; do
        [ -e "$name" ] || continue
        ln -sfn "$name" "$cache/node_modules/@qvac/$(basename "$name")"
      done
      for name in "$ROOT"/node_modules/*; do
        [ -e "$name" ] || continue
        [ "$(basename "$name")" = "@qvac" ] && continue
        ln -sfn "$name" "$cache/node_modules/$(basename "$name")"
      done
      ;;
  esac
  bun -e 'await import("bare-runtime/spawn"); await import("@qvac/rag/errors"); await import("@qvac/inference/surface"); await import("@qvac/sdk"); console.log("▸ imports-ok")'
}

# El addon LLaMA carga sus backends (CPU/Vulkan/OpenCL) por dlopen desde
# prebuilds/android-arm64/.../*.so al registrarse. Sin un loader Vulkan real
# esa carga puede quedarse esperando para siempre en vez de fallar rápido
# (visto en pruebas: cuelgue total del arranque). `vulkan-loader-android`
# (paquete de Termux, no `vulkan-loader-generic`) conecta con el driver
# Vulkan que Android ya trae — no requiere pantalla, pero solo existe en
# algunos SoCs (Adreno vía Turnip; Mali/Tensor no siempre andan).
try_enable_gpu() {
  local bin="$1"
  local gpu_dir="$ROOT/node_modules/@qvac/llm-llamacpp/prebuilds/android-arm64/qvac__llm-llamacpp"
  local so saved_ld="$LD_LIBRARY_PATH"
  echo "▸ probando GPU (Vulkan)…"
  if ! pkg install -y vulkan-loader-android >/dev/null 2>&1; then
    echo "▸ vulkan-loader-android no disponible en este dispositivo → CPU"
    return 0
  fi
  for so in libqvac-ggml-vulkan.so libqvac-ggml-opencl.so; do
    [ -f "$gpu_dir/$so.off" ] && mv "$gpu_dir/$so.off" "$gpu_dir/$so"
  done
  # $PREFIX/lib primero esconde el driver real: ahí vive el loader de Termux
  # (solo ve llvmpipe, software). /system/lib64 es el loader de Android, con
  # acceso a /vendor/lib64/hw/vulkan.*.so (Adreno/Mali reales).
  # https://github.com/DioNanos/ollama-termux/blob/main/docs/VULKAN_ANDROID_LOADER.md
  export LD_LIBRARY_PATH="/system/lib64:${saved_ld}"
  if run_with_timeout 20 "$bin" "$ROOT/scripts/termux-gpu-probe.mjs" >"$TMPDIR/gpu-probe.out" 2>"$TMPDIR/gpu-probe.err" \
     && grep -q gpu-probe-ok "$TMPDIR/gpu-probe.out" 2>/dev/null; then
    echo "▸ GPU disponible — QVAC_DEVICE=gpu"
    export QVAC_DEVICE="gpu"
  else
    echo "▸ GPU no responde en 20s o falló — vuelvo a CPU"
    cat "$TMPDIR/gpu-probe.out" "$TMPDIR/gpu-probe.err" 2>/dev/null | tail -20 || true
    export LD_LIBRARY_PATH="$saved_ld"
    for so in libqvac-ggml-vulkan.so libqvac-ggml-opencl.so; do
      [ -f "$gpu_dir/$so" ] && mv "$gpu_dir/$so" "$gpu_dir/$so.off"
    done
    export QVAC_DEVICE="cpu"
  fi
}

ensure_qvac_native() {
  if [ "$in_termux" -eq 1 ]; then
    export TMPDIR="${PREFIX:-/data/data/com.termux/files/usr}/tmp"
    mkdir -p "$TMPDIR"
    pkg install -y libandroid-spawn libc++ >/dev/null 2>&1 || pkg install -y libandroid-spawn >/dev/null 2>&1 || true
    export LD_PRELOAD=""
    export LD_LIBRARY_PATH="${PREFIX:-/data/data/com.termux/files/usr}/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
    export QVAC_RPC_INIT_TIMEOUT_MS="${QVAC_RPC_INIT_TIMEOUT_MS:-120000}"
    if [ -L node_modules/@qvac/sdk ] || [ ! -f node_modules/bare-runtime/lib/spawn.js ]; then
      echo "▸ bun install --linker=hoisted…"
      bun install --linker=hoisted --backend=copyfile || bun install --linker=hoisted
    fi
    force_android_bare
    local bin
    bin="$(bun -e 'process.stdout.write(require("bare-runtime")())')"
    echo "▸ bare ${bin}"
    wrap_bare_bin "$bin"
    bin="$(bun -e 'process.stdout.write(require("bare-runtime")())')"
    if is_elf "$bin" && grep -aq 'ld-linux' "$bin"; then
      echo "✖ sigue siendo glibc; force_android_bare no pegó" >&2
      exit 1
    fi
    if ! "$bin" "$ROOT/scripts/bare-ok.mjs" >/dev/null 2>"$TMPDIR/bare-ok.err"; then
      echo "✖ bare abortó. err:" >&2
      cat "$TMPDIR/bare-ok.err" >&2 || true
      echo "Prueba: unset LD_PRELOAD; pkg install libc++ libandroid-spawn" >&2
      exit 1
    fi
    echo "▸ bare-ok"
    graft_sdk_cache
    try_enable_gpu "$bin"
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

if [ "$in_termux" -eq 1 ]; then
  export NODE_PATH="$ROOT/node_modules${NODE_PATH:+:$NODE_PATH}"
fi
exec bun run start
