#!/usr/bin/env bash
set -uo pipefail
CNR="${1:-APHC010000832023}"
echo "=== fast siddhanta probe $CNR ==="
aws s3 ls "s3://siddhanta/IND/00_RAW/high_courts/" 2>&1 | head -5
echo "ns2_backfill_key:"
aws s3 ls "s3://ns-indian-highcourt-judgements-2/judgments/hcservices_depth_backfill/${CNR}.json" 2>&1
if aws s3 cp "s3://ns-indian-highcourt-judgements-2/judgments/hcservices_depth_backfill/${CNR}.json" /tmp/hcs2.json 2>/dev/null; then
  python3 -c "
import json
d=json.load(open('/tmp/hcs2.json'))
fo=(d.get('finalOrders') or d.get('final_orders') or [{}])[0]
io=(d.get('interimOrders') or d.get('interim_orders') or [{}])[0]
def has_t(o):
  u=o.get('pdf_url') or ''
  return bool(u) and ('display_pdf' in u or 'authtoken' in u)
print('final_has_token_url', has_t(fo), 'interim_has_token_url', has_t(io))
print('final_filename_len', len(str(fo.get('filename') or '')))
"
else
  echo "ns2_backfill_missing=1"
fi
echo DONE
