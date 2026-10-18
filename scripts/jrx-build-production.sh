#!/usr/bin/env bash
# Production build: workspace docparse packages, gateway tsc, console vite bundle.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

npm run docparse:build
npm run docparse-sdk:build
# Authoritative server compile (tsconfig.server.json noEmitOnError).
npm run build:server
npx vite build

echo "jrx-build-production: dist/server + dist/public ready"
