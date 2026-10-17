#!/usr/bin/env bash
# Pull last Auth me / Login errors from gateway (no secrets).
set -euo pipefail
echo "=== recent auth errors ==="
docker logs nyv-gateway --since 30m 2>&1 | grep -E 'Auth me error|Login error|nv-auth-db|28P01|password authentication' | tail -40 || true
echo "=== /me body sample (admin) ==="
CANON="/opt/Nyayavigya/secrets/.env.production"
PW="$(grep -E '^NV_DEMO_PASSWORD=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')"
ORIGIN="https://console.nyayasiddhi.online"
curl -sS -o /tmp/jrx-login.json -w 'login:%{http_code}\n' -m 20 \
  -H 'Content-Type: application/json' -H "Origin: $ORIGIN" \
  -d "{\"email\":\"admin@nyayavigya.in\",\"password\":\"$PW\"}" \
  https://api.nyayasiddhi.online/api/auth/login >/tmp/jrx-login-code.txt
TOKEN=$(python3 -c "import json; print(json.load(open('/tmp/jrx-login.json')).get('token',''))")
curl -sS -o /tmp/jrx-me.json -w 'me:%{http_code}\n' -m 20 \
  -H "Authorization: Bearer ${TOKEN}" -H "Origin: $ORIGIN" \
  https://api.nyayasiddhi.online/api/auth/me
python3 - <<'PY'
import json
d=json.load(open("/tmp/jrx-me.json"))
err=d.get("error")
if isinstance(err, dict):
    print("me.error", err.get("code"), (err.get("message") or "")[:120])
else:
    print("me.keys", sorted(d)[:12], "err", str(err)[:80] if err else "-")
PY
