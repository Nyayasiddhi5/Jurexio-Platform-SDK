#!/usr/bin/env bash
set -uo pipefail
P=/home/ubuntu/scripts/case_api/_newbox/RDS_GAP_2026-09-12.md
if [[ -f "$P" ]]; then
  echo "=== $P (head 80) ==="
  head -80 "$P"
  echo "=== grep full-scan / reconcile ==="
  grep -nE 'full.scan|reconcil|allow.shrink|bulk|export' "$P" | head -40
else
  echo "missing $P"
fi
