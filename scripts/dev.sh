#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

NODE24_CANDIDATES=(
  "/opt/homebrew/opt/node@24/bin/node"
  "/usr/local/opt/node@24/bin/node"
)

NODE_BIN=""
for candidate in "${NODE24_CANDIDATES[@]}"; do
  if [[ -x "$candidate" ]]; then
    NODE_BIN="$candidate"
    break
  fi
done

if [[ -z "$NODE_BIN" ]]; then
  NODE_BIN="$(command -v node || true)"
fi

if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  echo "Node.js not found. Install Node 24 LTS first."
  exit 1
fi

node_major="$("$NODE_BIN" -p "process.versions.node.split('.')[0]")"

if [[ "$node_major" -ge 25 ]]; then
  cat <<'EOF'
Mintlify requires Node.js 20–24 (LTS). Your current Node version is too new.

Fix options:
  1. Homebrew (recommended on macOS):
       brew install node@24
       npm run dev

  2. fnm:
       fnm install 24
       fnm use 24
       npm run dev

  3. nvm:
       nvm install 24
       nvm use
       npm run dev
EOF
  exit 1
fi

export PATH="$(dirname "$NODE_BIN"):$PATH"

MINT_BIN=""
if [[ -x "$ROOT_DIR/node_modules/.bin/mint" ]]; then
  MINT_BIN="$ROOT_DIR/node_modules/.bin/mint"
elif command -v mint >/dev/null 2>&1; then
  MINT_BIN="$(command -v mint)"
else
  echo "Mintlify CLI not found. Install it with Node 24 active:"
  echo "  npm i -g mint"
  exit 1
fi

exec "$MINT_BIN" dev "$@"
