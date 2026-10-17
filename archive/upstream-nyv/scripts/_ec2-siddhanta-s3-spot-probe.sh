#!/usr/bin/env bash
# NV-SIDDHANTA-S3-SPOT-001 — read-only prefix spot check (no secrets).
set -uo pipefail
echo "=== SIDDHANTA S3 SPOT $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
BUCKET="${SIDDHANTA_BUCKET:-siddhanta}"
for prefix in \
  "IND/00_RAW/high_courts/" \
  "IND/00_RAW/supreme_court/" \
  "IND/00_RAW/district_courts/vanga_mirror/"; do
  echo "--- $prefix ---"
  aws s3 ls "s3://${BUCKET}/${prefix}" --recursive --summarize 2>/dev/null \
    | tail -3 || echo "ERR listing $prefix"
done
echo "=== SIDDHANTA SPOT DONE ==="
