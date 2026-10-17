#!/usr/bin/env bash
set -uo pipefail
python3 <<'PY'
import json, urllib.parse, urllib.request, ssl
ctx=ssl.create_default_context()
rec={"filename":"/orders/2023/202100000622023_12.pdf","state_code":"2","dist_code":"1","court_code":"1","c_code":"1","app_flag":"1","case_no":"CRLP/0000062/2023","order_id":"12"}
fn=rec["filename"].lstrip("/")
base="https://hcservices.ecourts.gov.in/hcservices/cases/display_pdf.php"
for af in [" 1 ", "  Y  ", " Y ", " N ", "1", " Y", "y", " \t1\t "]:
  q={"filename":fn,"state_code":rec["state_code"],"dist_code":rec["dist_code"],"court_code":rec["court_code"],"c_code":rec["c_code"],"appFlag":af,"caseno":rec["case_no"],"order_no":rec["order_id"]}
  url=base+"?"+urllib.parse.urlencode(q, quote_via=urllib.parse.quote)
  req=urllib.request.Request(url, headers={"User-Agent":"Mozilla/5.0"})
  with urllib.request.urlopen(req, timeout=20, context=ctx) as r:
    b=r.read(120)
  print("af=%r len=%d head=%r" % (af, len(b), b[:48]))
# raw query string with unencoded spaces in appFlag
raw="filename=%s&state_code=2&dist_code=1&court_code=1&c_code=1&appFlag=+1+&caseno=CRLP%%2F0000062%%2F2023&order_no=12" % urllib.parse.quote(fn)
req=urllib.request.Request(base+"?"+raw, headers={"User-Agent":"Mozilla/5.0"})
with urllib.request.urlopen(req, timeout=20, context=ctx) as r:
  b=r.read(120)
print("raw_plus_1", len(b), b[:48])
PY
echo DONE
