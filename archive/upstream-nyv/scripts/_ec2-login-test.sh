#!/usr/bin/env bash
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
NV_DEMO_PW="$(grep -E '^NV_DEMO_PASSWORD=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" )"
echo "password len: ${#NV_DEMO_PW}"
RESP=$(curl -sS -m 15 -X POST http://127.0.0.1:5000/api/jrx/auth/login \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://api.nyayasiddhi.online' \
  -d "{\"email\":\"admin@nyayavigya.in\",\"password\":\"${NV_DEMO_PW}\"}" \
  -w '\nHTTP:%{http_code}')
echo "$RESP" | python3 -c "
import sys,re
text=sys.stdin.read()
m=re.search(r'HTTP:(\d+)', text)
body=text[:m.start()] if m else text
code=m.group(1) if m else '000'
print('login HTTP', code)
try:
  import json
  j=json.loads(body.strip())
  print('message:', j.get('message','')[:120])
  print('success:', j.get('success'))
except Exception as e:
  print('body prefix:', body.strip()[:120])
"
