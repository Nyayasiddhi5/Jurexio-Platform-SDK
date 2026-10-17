#!/usr/bin/env bash
set -uo pipefail
ROOT=/home/ubuntu/scripts/case_api
echo "=== main.py route defs ==="
grep -n '@app\.' "$ROOT/app/main.py" 2>/dev/null | head -40
echo "=== docurl.py (full, max 200 lines) ==="
head -200 "$ROOT/app/docurl.py" 2>/dev/null
echo "=== ingest_hcservices_depth pdf fetch ==="
grep -n -E 'display_pdf|pdf|session|cookie|captcha' "$ROOT/build/ingest_hcservices_depth.py" 2>/dev/null | head -40
echo "=== env key names NIC/HC ==="
grep -E '^[A-Z][A-Z0-9_]*(NIC|ECOURT|HC|COOKIE|SESSION|CAPTCHA|HCSERVICE|JSESSION)' /opt/nyv/api/.env 2>/dev/null | cut -d= -f1 | sort -u
echo "=== nysapi orders + pdf route ==="
cd /opt/nyv/api
KEY=$(tr '\0' '\n' < "/proc/$(pgrep -f 'uvicorn.*8090' | head -1)/environ" | grep '^CASE_API_API_KEYS=' | head -1 | cut -d= -f2- | cut -d, -f1)
CNR=APHC010000832023
curl -sS -H "X-API-Key: $KEY" "http://127.0.0.1:8090/v1/cases/${CNR}" | python3 -c "
import json,sys
c=json.load(sys.stdin).get('case') or {}
for k in ('final_orders','interim_orders'):
  a=c.get(k) or []
  print(k, len(a), (a[0].get('filename') if a else '')[:100])
"
fn=$(curl -sS -H "X-API-Key: $KEY" "http://127.0.0.1:8090/v1/cases/${CNR}" | python3 -c "import json,sys;c=json.load(sys.stdin).get('case')or{};fo=c.get('final_orders')or[];print((fo[0].get('filename')or'').lstrip('/'))")
enc=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$fn")
curl -sS -o /tmp/p.pdf -w 'route_http=%{http_code} bytes=%{size_download}\n' -H "X-API-Key: $KEY" "http://127.0.0.1:8090/v1/hc/orders/pdf?cnr=${CNR}&filename=${enc}" --max-time 30
head -c 4 /tmp/p.pdf | xxd -p | grep -q 25504446 && echo magic=PDF || echo magic=NOT_PDF
echo DONE
