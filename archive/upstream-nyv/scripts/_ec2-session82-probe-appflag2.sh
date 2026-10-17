#!/usr/bin/env bash
set -uo pipefail
KEY=$(tr '\0' '\n' < "/proc/$(pgrep -f 'uvicorn.*8090' | head -1)/environ" | grep '^CASE_API_API_KEYS=' | head -1 | cut -d= -f2- | cut -d, -f1)
curl -sS -H "X-API-Key: $KEY" "http://127.0.0.1:8090/v1/cases/APHC010000832023" -o /tmp/ord.json
python3 <<'PY'
import json, urllib.request, ssl
ctx=ssl.create_default_context()
rec=(json.load(open("/tmp/ord.json")).get("case") or {}).get("final_orders", [{}])[0]
fn=(rec.get("filename") or "").lstrip("/")
base="https://hcservices.ecourts.gov.in/hcservices/cases/display_pdf.php?"
# appFlag space variant seen in some eCourts clients: leading/trailing space around Y/N
queries=[
 "filename=%s&state_code=%s&dist_code=%s&court_code=%s&c_code=%s&appFlag=+Y+&caseno=%s&order_no=%s" % (fn, rec.get("state_code"), rec.get("dist_code"), rec.get("court_code"), rec.get("c_code"), urllib.parse.quote(str(rec.get("case_no") or "")), rec.get("order_id")),
 "filename=%s&state_cd=%s&dist_cd=%s&court_code=%s&cCode=%s&appFlag=%s" % (fn, rec.get("state_code"), rec.get("dist_code"), rec.get("court_code"), rec.get("c_code"), rec.get("app_flag")),
 "opt=1&filename=%s&state_code=%s&dist_code=%s&court_code=%s&appFlag=%s&case_no=%s" % (fn, rec.get("state_code"), rec.get("dist_code"), rec.get("court_code"), rec.get("app_flag"), urllib.parse.quote(str(rec.get("case_no") or ""))),
]
import urllib.parse
for i, qs in enumerate(queries):
  url=base+qs
  req=urllib.request.Request(url, headers={"User-Agent":"Mozilla/5.0", "Referer":"https://hcservices.ecourts.gov.in/"})
  try:
    with urllib.request.urlopen(req, timeout=20, context=ctx) as r:
      b=r.read(200)
    print(i, len(b), b[:55])
  except Exception as e:
    print(i, "ERR", e)
PY
echo DONE
