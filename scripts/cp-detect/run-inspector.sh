#!/usr/bin/env bash
# Run the CP-detect stage inspector with a live vite frontend.
#
# Modern flow: the Rust backend serves ONLY the API (/api, /assets) on :8788,
# and vite serves the frontend live from source on :5176 (HMR, no prebuilt
# dist to go stale — vite.config.ts proxies /api and /assets to the backend).
# Open http://127.0.0.1:5176.
#
# Any extra args are forwarded to the backend, e.g.:
#   scripts/cp-detect/run-inspector.sh --dense-manifest artifacts/.../manifest.json
#   scripts/cp-detect/run-inspector.sh --exact-solve-timeout-seconds 25
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

BACKEND_PORT="${INSPECTOR_BACKEND_PORT:-8788}"
FRONTEND_URL="http://127.0.0.1:5176"

echo "[inspector] building backend (release)..."
cargo build --release -p oristudio-cp-detect-inspector

echo "[inspector] starting API backend on :${BACKEND_PORT}..."
target/release/oristudio-cp-detect-inspector --port "${BACKEND_PORT}" "$@" &
BACKEND_PID=$!
cleanup() {
  echo "[inspector] stopping backend (pid ${BACKEND_PID})..."
  kill "${BACKEND_PID}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "[inspector] waiting for backend API..."
for _ in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:${BACKEND_PORT}/api/stages" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "${BACKEND_PID}" 2>/dev/null; then
    echo "[inspector] backend exited during startup" >&2
    exit 1
  fi
  sleep 0.5
done

echo "[inspector] backend ready. Starting vite dev frontend..."
echo "[inspector] >>> open ${FRONTEND_URL} <<<"
# `dev` runs its predev (builds the cp-detect wasm) then vite on :5176.
npm --workspace @treemaker/cp-detect-architecture-inspector run dev
