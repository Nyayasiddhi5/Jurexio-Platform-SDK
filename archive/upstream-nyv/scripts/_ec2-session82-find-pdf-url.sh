#!/usr/bin/env bash
set -uo pipefail
CNR=APHC010000832023
echo "=== s3 mobile depth raw paths ==="
for b in ns-indian-highcourt-judgements-2 ns-highcourt-data-bucket indian-high-court-judgments; do
  for p in "judgments/mobile_depth/${CNR}.json" "judgments/hcservices_depth_backfill/${CNR}.json" "mobile_depth/${CNR}.json"; do
    aws s3 ls "s3://${b}/${p}" 2>/dev/null && echo "hit s3://${b}/${p}"
  done
done
echo "=== grep pdf_url in local recon for similar CNR ==="
grep -l "202100000622023" /home/ubuntu/scripts/data_rds/recon_samples -R 2>/dev/null | head -3
grep -l "$CNR" /home/ubuntu/scripts/data_rds/recon_samples -R 2>/dev/null | head -3
echo "=== case_api build grep pdf_url in mobile merge ==="
grep -n pdf_url /home/ubuntu/scripts/case_api/build/*.py 2>/dev/null | head -15
echo DONE
