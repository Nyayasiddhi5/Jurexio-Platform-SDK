#!/usr/bin/env bash
set -uo pipefail
python3 <<'PY'
import urllib.parse, urllib.request, ssl
ctx=ssl.create_default_context()
CNR = "APHC010000832023"
rec = {
  "filename": "/orders/2023/202100000622023_12.pdf",
  "caseno": "CRLP/0000062/2023",
  "cCode": "1",
  "state_cd": "2",
  "dist_cd": "1",
  "court_code": "1",
}
fn_path = rec["filename"].lstrip("/")
fn_base = fn_path.split("/")[-1]
bases = [
  "https://hcservices.ecourts.gov.in/hcservices/cases/display_pdf.php",
  "https://hcservices.ecourts.gov.in/ecourtindiaHC/cases/display_pdf.php",
]
variants = []
for fn in (fn_path, fn_base, rec["filename"]):
  variants.append({
    "filename": fn,
    "caseno": rec["caseno"],
    "cCode": rec["cCode"],
    "state_code": rec["state_cd"],
    "cino": CNR,
    "appFlag": "",
  })
  variants.append({
    "filename": fn,
    "caseno": rec["caseno"],
    "c_code": rec["cCode"],
    "state_code": rec["state_cd"],
    "dist_code": rec["dist_cd"],
    "court_code": rec["court_code"],
    "cino": CNR,
    "appFlag": "",
  })
for base in bases:
  for i, q in enumerate(variants):
    qs = urllib.parse.urlencode({k: v for k, v in q.items()}, quote_via=urllib.parse.quote)
    url = base + "?" + qs
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
      with urllib.request.urlopen(req, timeout=25, context=ctx) as r:
        b = r.read(400)
      magic = b[:4]
      is_pdf = magic == b"%PDF"
      print(base.split("/")[3], "v", i, "pdf", is_pdf, "len", len(b), "head", b[:60])
    except Exception as e:
      print(base.split("/")[3], "v", i, "ERR", e)
PY
echo DONE
