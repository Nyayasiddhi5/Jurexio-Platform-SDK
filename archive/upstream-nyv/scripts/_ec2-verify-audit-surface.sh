#!/usr/bin/env bash
set +e
CANON="/opt/Nyayavigya/secrets/.env.production"
NV_DEMO_PW="$(grep -E '^NV_DEMO_PASSWORD=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')"
curl -sS -o /tmp/login.json -m 20 -X POST http://127.0.0.1:5000/api/jrx/auth/login \
  -H 'Content-Type: application/json' -H 'Origin: https://api.nyayasiddhi.online' \
  -d "{\"email\":\"admin@nyayavigya.in\",\"password\":\"${NV_DEMO_PW}\"}" >/dev/null
TOKEN="$(python3 -c 'import json;d=json.load(open("/tmp/login.json"));print(d.get("token") or d.get("accessToken") or "")')"
echo "token_len=${#TOKEN}"
AUTH="Authorization: Bearer ${TOKEN}"; ORG='Origin: https://api.nyayasiddhi.online'

echo "=== 1) /admin/audit-logs — now reads nv_schema.nv_audit_logs (live hash chain) ==="
curl -sS -m 30 "http://127.0.0.1:5000/api/jrx/admin/audit-logs?limit=5" -H "$AUTH" -H "$ORG" \
 | python3 -c 'import json,sys;d=json.load(sys.stdin).get("data",{});print(" total=",d.get("total")," returned=",len(d.get("logs",[])));[print("  -",l.get("action"),"| status=",l.get("statusCode"),"| at=",str(l.get("createdAt"))[:19]) for l in d.get("logs",[])[:5]]' 2>&1

echo "=== 2) /admin/stats — 30d usage requests (view/fallback) ==="
curl -sS -m 30 "http://127.0.0.1:5000/api/jrx/admin/stats" -H "$AUTH" -H "$ORG" \
 | python3 -c 'import json,sys;r=json.load(sys.stdin);d=r.get("data",r);print(" usage=",d.get("usage"))' 2>&1

echo "=== 3) /dashboard — usage total_requests (now via compat view over nv_schema.ai_activity) ==="
curl -sS -m 30 "http://127.0.0.1:5000/api/jrx/dashboard" -H "$AUTH" -H "$ORG" \
 | python3 -c 'import json,sys;r=json.load(sys.stdin);d=r.get("data",r);u=d.get("usage",{});print(" usage=",u)' 2>&1

echo "=== 4) /analytics — provider breakdown (now real from view) ==="
curl -sS -m 30 "http://127.0.0.1:5000/api/jrx/analytics" -H "$AUTH" -H "$ORG" \
 | python3 -c 'import json,sys;r=json.load(sys.stdin);d=r.get("data",r);print(" totals=",d.get("totals") or d.get("usage"));bp=d.get("byProvider") or d.get("providers") or [];print(" byProvider_count=",len(bp));[print("  -",p) for p in bp[:6]]' 2>&1
