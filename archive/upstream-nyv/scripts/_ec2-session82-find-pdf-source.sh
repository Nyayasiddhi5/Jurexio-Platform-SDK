#!/usr/bin/env bash
set -uo pipefail
CNR=APHC010000832023
BASE=202100000622023
echo "=== find local files matching order base ==="
find /home/ubuntu /opt/nyv -maxdepth 8 -type f \( -name "*${BASE}*" -o -name "*${CNR}*order*" \) 2>/dev/null | head -20

echo "=== s3 owned keys data/orders ==="
for b in ns-indian-highcourt-judgements-2 ns-highcourt-data-bucket; do
  aws s3 ls "s3://${b}/data/orders/cnr=${CNR}/" 2>/dev/null | head -5 || echo "no_prefix bucket=$b"
done

echo "=== opt nyv api scripts list ==="
ls /opt/nyv/api/*.mjs 2>/dev/null | head -15
grep -l -E 'mobile|depth|hcservices|display_pdf|captcha' /opt/nyv/api/*.mjs 2>/dev/null | head -10

echo "=== case_api service get orders source grep ==="
grep -R -n -E 'final_orders|interim_orders' /home/ubuntu/scripts/case_api/app/*.py 2>/dev/null | head -25

echo "=== curl case with file ==="
KEY=$(tr '\0' '\n' < "/proc/$(pgrep -f 'uvicorn.*8090' | head -1)/environ" | grep '^CASE_API_API_KEYS=' | head -1 | cut -d= -f2- | cut -d, -f1)
curl -sS -H "X-API-Key: $KEY" "http://127.0.0.1:8090/v1/cases/${CNR}" -o /tmp/case.json
python3 -c "import json;c=json.load(open('/tmp/case.json')).get('case')or{};print('final',len(c.get('final_orders')or[]));print(json.dumps((c.get('final_orders')or[{}])[0])[:350])"

echo DONE
