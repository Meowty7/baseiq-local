#!/usr/bin/env bash
# Idempotent Cloud Agent bootstrap for BaseIQ Local.
# Installs Bun (the project's package manager) if missing, then installs deps.
set -euo pipefail

export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
BUN_BIN="$BUN_INSTALL/bin/bun"

if [ ! -x "$BUN_BIN" ]; then
  echo "▸ Installing Bun into $BUN_INSTALL"
  curl -fsSL https://bun.sh/install | bash
fi

export PATH="$BUN_INSTALL/bin:$PATH"

echo "▸ Bun version: $("$BUN_BIN" --version)"

cd "$(dirname "$0")/.."

echo "▸ Installing JavaScript dependencies with Bun"
"$BUN_BIN" install --frozen-lockfile
