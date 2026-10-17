#!/usr/bin/env bash
set -uo pipefail
KEY=$(tr '\0' '\n' < "/proc/$(pgrep -f 'uvicorn.*8090' | head -1)/environ" | grep '^CASE_API_API_KEYS=' | head -1 | cut -d= -f2- | cut -d, -f1)
curl -sS -H "X-API-Key: $KEY" "http://127.0.0.1:8090/v1/cases/APHC010000832023" -o /tmp/ord.json
python3 <<'PY'
import json, urllib.parse, urllib.request, ssl
ctx=ssl.create_default_context()
rec=(json.load(open("/tmp/ord.json")).get("case") or {}).get("final_orders", [{}])[0]
fn=(rec.get("filename") or "").lstrip("/")
base="https://hcservices.ecourts.gov.in/hcservices/cases/display_pdf.php"
app_flags=["1"," 1","1 ","Y","y","N","0"," ",""]
for af in app_flags:
  q={
    "filename": fn,
    "state_code": rec.get("state_code"),
    "dist_code": rec.get("dist_code"),
    "court_code": rec.get("court_code"),
    "c_code": rec.get("c_code"),
    "appFlag": af,
    "caseno": rec.get("case_no"),
    "order_no": rec.get("order_id"),
  }
  qs=urllib.parse.urlencode(q)
  url=base+"?"+qs
  req=urllib.request.Request(url, headers={"User-Agent":"Mozilla/5.0"})
  with urllib.request.urlopen(req, timeout=20, context=ctx) as r:
    b=r.read(120)
  print("appFlag=%r bytes=%d head=%r" % (af, len(b), b[:50]))
# POST form
from urllib.parse import urlencode
data=urlencode({k:str(v) for k,v in q.items() if v is not None}).encode()
req=urllib.request.Request(base, data=data, headers={"User-Agent":"Mozilla/5.0","Content-Type":"application/x-www-form-urlencoded"})
with urllib.request.urlopen(req, timeout=20, context=ctx) as r:
  b=r.read(120)
print("POST bytes", len(b), "head", b[:50])
PY
echo DONE
