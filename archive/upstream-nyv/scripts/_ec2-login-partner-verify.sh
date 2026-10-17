#!/usr/bin/env bash
# Login + partner freeze verify. Never echo secrets.
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
NV_DEMO_PW="$(grep -E '^NV_DEMO_PASSWORD=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')"
ORIGIN="https://console.nyayasiddhi.online"
API="https://api.nyayasiddhi.online"
FAIL=0

echo "=== GET /api/jrx/health ==="
HCODE=$(curl -sS -o /tmp/jrx-health.json -w '%{http_code}' -m 20 "${API}/api/jrx/health" || echo 000)
python3 - <<PY
import json
d=json.load(open("/tmp/jrx-health.json"))
print("HTTP $HCODE status=%s agents=%s ver=%s" % (d.get("status"), d.get("totalAgents"), d.get("version")))
PY
[ "$HCODE" = "200" ] || FAIL=$((FAIL+1))

echo "=== GET /api/jrx/health/full (jwt_security age is known; do not rotate) ==="
curl -sS -o /tmp/jrx-full.json -w 'full:%{http_code}\n' -m 30 "${API}/api/jrx/health/full" || true
python3 - <<'PY' || true
import json
d=json.load(open("/tmp/jrx-full.json"))
print("overall=%s" % d.get("overall") or d.get("status"))
checks=d.get("checks") or d.get("services") or {}
if isinstance(checks, dict):
    for k,v in list(checks.items())[:20]:
        st = v.get("status") if isinstance(v, dict) else v
        print(" ", k, st)
PY

echo "=== console login + /me ==="
for EMAIL in admin@nyayavigya.in superadmin@demo.nyayasiddhi.online legalchat-sme-a-uat@nyayavigya.in; do
  CODE=$(curl -sS -o /tmp/jrx-login.json -w '%{http_code}' -m 30 \
    -H 'Content-Type: application/json' -H "Origin: $ORIGIN" -H "Referer: ${ORIGIN}/" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$NV_DEMO_PW\"}" \
    "${API}/api/auth/login" || echo 000)
  EVAL=$(python3 - <<'PY'
import json
d=json.load(open("/tmp/jrx-login.json"))
err=d.get("error")
err_s = ("%s:%s"%(err.get("code"), err.get("message")))[:80] if isinstance(err, dict) else str(err or "")[:80]
print("token=%s role=%s objectObject=%s err=%s" % (
    "yes" if d.get("token") else "no",
    (d.get("user") or {}).get("role") if isinstance(d.get("user"), dict) else "-",
    "[object Object]" in str(d),
    err_s or "-",
))
open("/tmp/jrx-token.txt","w").write(d.get("token") or "")
PY
)
  echo "$EMAIL HTTP $CODE $EVAL"
  if [ "$CODE" != "200" ]; then FAIL=$((FAIL+1)); continue; fi
  TOKEN=$(cat /tmp/jrx-token.txt)
  MCODE=$(curl -sS -o /tmp/jrx-me.json -w '%{http_code}' -m 20 \
    -H "Authorization: Bearer ${TOKEN}" -H "Origin: $ORIGIN" \
    "${API}/api/auth/me" || echo 000)
  ME=$(python3 -c "import json; d=json.load(open('/tmp/jrx-me.json')); u=d.get('user') or {}; print(u.get('email','?'), u.get('role','-'))" 2>/dev/null || echo '?')
  echo "  /me HTTP $MCODE $ME"
  [ "$MCODE" = "200" ] || FAIL=$((FAIL+1))
done

key_for() { grep -E "^NYV_SDK_KEY_${1}=" "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n'; }

echo "=== partner freeze (NSP NYM) ==="
ORCH='{"prompt":"In one sentence, what is breach of contract?","agentId":"summarizer","jurisdiction":"IN","taskType":"summarize","mode":"sync"}'
for sku in NSP NYM; do
  key=$(key_for "$sku")
  if [ -z "$key" ]; then echo "FAIL $sku no key"; FAIL=$((FAIL+1)); continue; fi
  code=$(curl -sS -o /tmp/ps-body.json -w '%{http_code}' -m 120 -H "X-API-Key: ${key}" "${API}/api/jrx/gateway/health" || echo 000)
  echo "$sku gateway/health $code"; [ "$code" = "200" ] || FAIL=$((FAIL+1))
  code=$(curl -sS -o /tmp/ps-body.json -w '%{http_code}' -m 120 -X POST -H "X-API-Key: ${key}" -H 'Content-Type: application/json' -d "$ORCH" "${API}/api/jrx/orchestrate" || echo 000)
  echo "$sku orchestrate $code"; [ "$code" = "200" ] || FAIL=$((FAIL+1))
done

echo "=== CNR honesty ==="
NSPK=$(key_for NSP)
code=$(curl -sS -o /tmp/cnr.json -w '%{http_code}' -m 40 -X POST -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' \
  -d '{"cnr":"TSWL010000012024"}' "${API}/api/jrx/sdk/cnr/resolve" || echo 000)
python3 - <<PY
import json
d=json.load(open("/tmp/cnr.json"))
claim=d.get("claimEcourts")
if claim is None and isinstance(d.get("data"), dict):
    claim=d["data"].get("claimEcourts")
print("CNR HTTP $code claimEcourts=%s found=%s" % (claim, d.get("found") or (d.get("data") or {}).get("found")))
if str(claim).lower() == "true":
    raise SystemExit(2)
PY
[ $? -eq 0 ] || FAIL=$((FAIL+1))

echo "FAILS=$FAIL"
[ "$FAIL" -eq 0 ]
