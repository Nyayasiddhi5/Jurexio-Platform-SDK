#!/usr/bin/env bash
# Console-path login smoke (same route the dashboard uses). Never echo passwords.
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
NV_DEMO_PW="$(grep -E '^NV_DEMO_PASSWORD=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')"
ORIGIN="${CONSOLE_URL:-https://console.nyayasiddhi.online}"
API="${API_URL:-https://api.nyayasiddhi.online}"
FAIL=0

echo "=== gateway health ==="
HCODE=$(curl -sS -o /tmp/jrx-health.json -w '%{http_code}' -m 20 "${API}/api/jrx/health" || echo 000)
echo "GET /api/jrx/health HTTP $HCODE"
python3 - <<'PY' || true
import json
try:
    d=json.load(open("/tmp/jrx-health.json"))
    print("health keys:", ",".join(sorted(d)[:12]) if isinstance(d, dict) else type(d).__name__)
except Exception as e:
    print("health parse:", type(e).__name__)
PY

echo "=== console login (/api/auth/login) ==="
for EMAIL in admin@nyayavigya.in superadmin@demo.nyayasiddhi.online legalchat-sme-a-uat@nyayavigya.in; do
  CODE=$(curl -sS -o /tmp/jrx-login.json -w '%{http_code}' -m 30 \
    -H 'Content-Type: application/json' \
    -H "Origin: $ORIGIN" \
    -H "Referer: ${ORIGIN}/" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$NV_DEMO_PW\"}" \
    "${API}/api/auth/login" || echo 000)
  if ! python3 - <<PY
import json
email="$EMAIL"
code="$CODE"
try:
    d=json.load(open("/tmp/jrx-login.json"))
except Exception:
    d={}
err = d.get("error")
if isinstance(err, dict):
    err_s = f"{err.get('code','')}:{err.get('message','')}"[:80]
else:
    err_s = str(err or d.get("message") or "")[:80]
has_token = bool(d.get("token"))
role = (d.get("user") or {}).get("role") if isinstance(d.get("user"), dict) else None
objobj = "[object Object]" in str(d)
print(f"{email} HTTP {code} token={'yes' if has_token else 'no'} role={role or '-'} err={err_s or '-'} objectObject={objobj}")
raise SystemExit(0 if code == "200" and has_token else 2)
PY
  then FAIL=$((FAIL+1)); continue; fi
  TOKEN=$(python3 -c "import json; print(json.load(open('/tmp/jrx-login.json')).get('token',''))")
  MCODE=$(curl -sS -o /tmp/jrx-me.json -w '%{http_code}' -m 20 \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Origin: $ORIGIN" \
    "${API}/api/auth/me" || echo 000)
  MEMAIL=$(python3 -c "import json; d=json.load(open('/tmp/jrx-me.json')); u=d.get('user') or d; print((u or {}).get('email','?') if isinstance(u,dict) else '?')" 2>/dev/null || echo '?')
  echo "  /api/auth/me HTTP $MCODE email=$MEMAIL"
  if [ "$MCODE" != "200" ]; then FAIL=$((FAIL+1)); fi
done

echo "FAILS=$FAIL"
[ "$FAIL" -eq 0 ]
