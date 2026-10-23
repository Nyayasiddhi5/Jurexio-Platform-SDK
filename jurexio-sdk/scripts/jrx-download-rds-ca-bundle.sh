#!/usr/bin/env bash
# JRX-RDS-CA-001 — refresh public AWS RDS global CA bundle (no secrets).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${JRX_RDS_CA_BUNDLE_PATH:-$ROOT/certs/rds-global-bundle.pem}"
mkdir -p "$(dirname "$DEST")"
curl -fsSL -o "$DEST" https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
echo "Wrote $(wc -c < "$DEST") bytes to $DEST"
