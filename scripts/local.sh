#!/usr/bin/env bash
# One-shot local runner: models -> build -> index -> serve.
# Usage: npm run local   (or ./scripts/local.sh)
set -euo pipefail
cd "$(dirname "$0")/.."

# Local config: BLOB_DIR (local blob store) + subgraph URLs.
if [ ! -f .env.local ]; then
  echo "missing .env.local (needs BLOB_DIR, MAINNET_SUBGRAPH_URL, GNOSIS_SUBGRAPH_URL)" >&2
  exit 1
fi
set -a; source .env.local; set +a

# Workspace scripts run with their own cwd — give them an absolute models path.
export MODELS_DIR="${MODELS_DIR:-$PWD/models}"

# 1. ONNX models (downloaded once).
if [ ! -f models/det_500m.onnx ] || [ ! -f models/w600k_mbf.onnx ]; then
  npm run models:download
fi

# 2. Build the core lib and the SPA.
npm run build

# 3. Build/refresh the face index (incremental: uses checkpoints, retries
# previously failed photos, no-op when already up to date).
# Pass 'bootstrap' to rebuild from scratch, e.g. after a model change:
#   ./scripts/local.sh bootstrap   (or: npm run local -- bootstrap)
npm run start -w indexer -- "${1:-update}"

# 4. Serve SPA + /api/* on http://localhost:8888
exec npx tsx scripts/dev-server.ts
