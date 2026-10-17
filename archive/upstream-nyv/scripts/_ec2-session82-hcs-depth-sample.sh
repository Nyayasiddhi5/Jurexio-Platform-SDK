#!/usr/bin/env bash
set -uo pipefail
CNR=APHC010000832023
echo "=== case row orders from API (all fields keys order 0) ==="
KEY=$(tr '\0' '\n' < "/proc/$(pgrep -f 'uvicorn.*8090' | head -1)/environ" | grep '^CASE_API_API_KEYS=' | head -1 | cut -d= -f2- | cut -d, -f1)
curl -sS -H "X-API-Key: $KEY" "http://127.0.0.1:8090/v1/cases/${CNR}" | python3 <<'PY'
import json,sys
c=json.load(sys.stdin).get("case") or {}
for k in ("final_orders","interim_orders"):
    a=c.get(k) or []
    print(k, len(a))
    if a:
        print(" keys", list(a[0].keys()))
        print(" rec0", json.dumps(a[0])[:500])
print("extra_keys", list((c.get("extra") or {}).keys())[:20])
hd=(c.get("extra") or {}).get("hcservices_depth")
if hd:
    import json as j
    if isinstance(hd,str):
        hd=j.loads(hd)
    fo=hd.get("finalOrders") or hd.get("final_orders") or []
    print("hcs_depth_final", len(fo), j.dumps(fo[0] if fo else {})[:400])
PY

echo "=== s3 hcservices_depth_backfill object ==="
aws s3 ls "s3://ns-indian-highcourt-judgements-2/judgments/hcservices_depth_backfill/${CNR}.json" 2>/dev/null || \
aws s3 ls "s3://ns-highcourt-data-bucket/judgments/hcservices_depth_backfill/${CNR}.json" 2>/dev/null || echo "no_s3_depth_file"

for b in ns-indian-highcourt-judgements-2 ns-highcourt-data-bucket; do
  if aws s3 cp "s3://${b}/judgments/hcservices_depth_backfill/${CNR}.json" /tmp/hcs_depth.json 2>/dev/null; then
    echo "fetched_from=$b"
    python3 -c "
import json
d=json.load(open('/tmp/hcs_depth.json'))
fo=d.get('finalOrders') or d.get('final_orders') or []
io=d.get('interimOrders') or d.get('interim_orders') or []
print('final', len(fo), 'interim', len(io))
for label, arr in [('final', fo), ('interim', io)]:
  if arr:
    r=arr[0]
    print(label, 'filename', r.get('filename'), 'pdf', str(r.get('pdf_url') or r.get('pdfUrl') or '')[:120])
    break
"
    break
  fi
done

echo "=== try alternate display_pdf encodings ==="
python3 <<'PY'
import urllib.request, ssl
ctx=ssl.create_default_context()
paths=[
 "orders/2023/202100000622023_12.pdf",
 "/orders/2023/202100000622023_12.pdf",
 "202100000622023_12.pdf",
]
bases=[
 "https://hcservices.ecourts.gov.in/hcservices/cases/display_pdf.php?filename=",
 "https://services.ecourts.gov.in/ecourtindiaHC/cases/display_pdf.php?filename=",
]
for base in bases:
  for p in paths:
    url=base+urllib.parse.quote(p, safe='')
    try:
      req=urllib.request.Request(url, headers={"User-Agent":"Mozilla/5.0"})
      with urllib.request.urlopen(req, timeout=20, context=ctx) as r:
        b=r.read(200)
      magic=b[:4]
      print(base.split('/')[2], "path", p[:40], "bytes", len(b), "start", b[:30])
    except Exception as e:
      print("err", p[:30], type(e).__name__)
PY
echo DONE
