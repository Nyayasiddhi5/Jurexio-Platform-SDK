#!/usr/bin/env bash
# NV-NSP-CLOSURE-MATRIX-001 — local unit gate before EC2 attestation (no secrets).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
echo "== docparse-sdk (pageManifest + envelope) =="
(cd packages/docparse-sdk && npx vitest run test/intelligence-envelope.test.ts test/page-manifest.test.ts)
echo "== gateway unit (CNR 429 + textract structure) =="
npx vitest run src/services/__tests__/jrx-case-api-adapter.test.ts tests/unit/jrx-textract-structure-parse.test.ts
echo "== console live-data audit =="
node scripts/jrx-console-live-data-audit.mjs
echo "CLOSURE_MATRIX_LOCAL=PASS"
