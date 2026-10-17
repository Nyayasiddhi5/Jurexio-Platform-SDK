#!/usr/bin/env bash
# NV-NSP-CLOSURE-MATRIX-002 — nysdev attestation chain (NV-SECRETS-001: codes/latency only).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
bash scripts/jrx-closure-matrix-local.sh
npm run demo:probe:ec2
npm run partner:smoke:ec2
bash scripts/jrx-cnr-unified-cascade-probe-ec2.sh || true
echo "CLOSURE_MATRIX_EC2=ATTEMPTED (review SSM output for CNR cascade)"
