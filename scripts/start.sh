#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -d node_modules ]; then
  echo "[start] installing dependencies ..."
  npm install
fi

if [ ! -f bin/openlist ] && [ ! -f bin/openlist.exe ]; then
  echo "[start] fetching OpenList binary ..."
  node scripts/fetch-openlist.mjs
fi

if [ ! -d web/dist ]; then
  echo "[start] building web UI ..."
  npm run build:web
fi

echo "[start] starting backend ..."
exec npm start
