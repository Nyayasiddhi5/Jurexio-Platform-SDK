#!/usr/bin/env bash
set -uo pipefail
CNR="${1:-APHC010000832023}"
echo "=== siddhanta bucket probe for $CNR ==="
aws s3 ls "s3://siddhanta/" 2>&1 | head -5
aws s3 ls "s3://siddhanta/IND/00_RAW/high_courts/" 2>&1 | head -10
echo "grep_cnr_in_siddhanta: (skipped full-bucket recursive — use probe-fast or known key prefix)"
if aws s3 cp "s3://ns-indian-highcourt-judgements-2/judgments/hcservices_depth_backfill/${CNR}.json" /tmp/hcs2.json 2>/dev/null; then
  python3 -c "import json;d=json.load(open('/tmp/hcs2.json'));fo=(d.get('finalOrders') or d.get('final_orders') or [{}])[0];print('ns2 pdf', (fo.get('pdf_url') or '')[:100])"
fi
echo DONE
