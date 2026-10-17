#!/usr/bin/env bash
set -uo pipefail
KEY=$(tr '\0' '\n' < "/proc/$(pgrep -f 'uvicorn.*8090' | head -1)/environ" | grep '^CASE_API_API_KEYS=' | head -1 | cut -d= -f2- | cut -d, -f1)
curl -sS -H "X-API-Key: $KEY" "http://127.0.0.1:8090/v1/cases/APHC010000832023" -o /tmp/ord.json
/home/ubuntu/scripts/case_api/.venv/bin/python3 <<'PY'
import json, ssl, urllib.request, http.cookiejar, urllib.parse
ctx = ssl.create_default_context()
cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj), urllib.request.HTTPSHandler(context=ctx))
case = json.load(open("/tmp/ord.json")).get("case") or {}
rec = (case.get("final_orders") or [{}])[0]
fn = (rec.get("filename") or "").lstrip("/")
# warm session
for warm in [
  "https://hcservices.ecourts.gov.in/",
  "https://hcservices.ecourts.gov.in/hcservices/",
  "https://hcservices.ecourts.gov.in/hcservices/cases/case_status.php",
]:
  try:
    opener.open(urllib.request.Request(warm, headers={"User-Agent": "Mozilla/5.0"}), timeout=20).read(2000)
  except Exception as e:
    print("warm_err", warm.split("/")[-1], type(e).__name__)
print("cookies", [(c.name, c.domain) for c in cj])
q = urllib.parse.urlencode({
  "filename": fn,
  "caseno": rec.get("caseno") or rec.get("case_no"),
  "cCode": rec.get("c_code") or rec.get("cCode"),
  "state_code": rec.get("state_code") or rec.get("state_cd"),
  "cino": "APHC010000832023",
  "appFlag": "",
})
url = "https://hcservices.ecourts.gov.in/hcservices/cases/display_pdf.php?" + q
req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Referer": "https://hcservices.ecourts.gov.in/hcservices/cases/case_status.php"})
b = opener.open(req, timeout=25).read(300)
print("pdf_try len", len(b), "head", b[:55], "is_pdf", b[:4]==b"%PDF")
PY
echo DONE
