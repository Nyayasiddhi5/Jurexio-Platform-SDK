#!/usr/bin/env bash
set -uo pipefail
# Probe display_pdf with court routing params from real order record
KEY=$(tr '\0' '\n' < "/proc/$(pgrep -f 'uvicorn.*8090' | head -1)/environ" | grep '^CASE_API_API_KEYS=' | head -1 | cut -d= -f2- | cut -d, -f1)
CNR=APHC010000832023
curl -sS -H "X-API-Key: $KEY" "http://127.0.0.1:8090/v1/cases/${CNR}" -o /tmp/ord.json
python3 <<'PY'
import json, urllib.parse, urllib.request, ssl
ctx=ssl.create_default_context()
o=json.load(open("/tmp/ord.json")).get("case") or {}
rec=(o.get("final_orders") or o.get("interim_orders") or [{}])[0]
fn=(rec.get("filename") or "").lstrip("/")
params={
 "filename": fn,
 "fileName": fn,
 "state_code": rec.get("state_code"),
 "state_cd": rec.get("state_code"),
 "dist_code": rec.get("dist_code"),
 "court_code": rec.get("court_code"),
 "c_code": rec.get("c_code"),
 "appFlag": rec.get("app_flag"),
 "app_flag": rec.get("app_flag"),
 "caseno": rec.get("case_no"),
 "order_id": rec.get("order_id"),
}
print("rec", {k:rec.get(k) for k in ["filename","state_code","dist_code","court_code","c_code","app_flag","order_id"]})
bases=[
 "https://hcservices.ecourts.gov.in/hcservices/cases/display_pdf.php",
 "https://hcservices.ecourts.gov.in/hcservices/cases/display_pdf.php?",
]
# minimal + full query variants
variants=[{"filename": fn}, params, {k:v for k,v in params.items() if v}]
for i, q in enumerate(variants):
  qs=urllib.parse.urlencode({k:str(v) for k,v in q.items() if v is not None})
  url="https://hcservices.ecourts.gov.in/hcservices/cases/display_pdf.php?"+qs
  try:
    req=urllib.request.Request(url, headers={"User-Agent":"Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=25, context=ctx) as r:
      b=r.read(300)
    print(i, "http", r.status, "bytes", len(b), "head", b[:40])
  except Exception as e:
    print(i, "err", e)
PY
echo DONE
