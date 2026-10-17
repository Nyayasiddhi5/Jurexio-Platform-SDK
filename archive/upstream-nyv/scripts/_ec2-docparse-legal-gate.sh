#!/usr/bin/env bash
# NV-DOCPARSE-EC2-LEGAL-GATE-001 — legal corpus + court PDF fixtures inside gateway container.
set -euo pipefail
GW="$(docker ps --format '{{.Names}}' | grep -E '(^|_)nyv-gateway$' | head -1)"
[ -n "$GW" ] || { echo "FATAL: no gateway container"; exit 1; }
echo "gateway_container=$GW"
echo "NYV_F_DOCPARSE_TEXTRACT_PAGE=$(docker exec "$GW" printenv NYV_F_DOCPARSE_TEXTRACT_PAGE 2>/dev/null || echo unset)"
echo "NYV_F_TEXTRACT=$(docker exec "$GW" printenv NYV_F_TEXTRACT 2>/dev/null || echo unset)"
docker exec -e NYV_DOCPARSE_GATE_REQUIRE_OCR="${NYV_DOCPARSE_GATE_REQUIRE_OCR:-0}" -w /app "$GW" \
  node scripts/jrx-docparse-legal-corpus-gate.mjs
