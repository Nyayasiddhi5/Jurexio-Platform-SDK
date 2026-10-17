#!/usr/bin/env bash
set +e
CANON="/opt/Nyayavigya/secrets/.env.production"
NV_DEMO_PW="$(grep -E '^NV_DEMO_PASSWORD=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')"
curl -sS -o /tmp/login.json -m 20 -X POST http://127.0.0.1:5000/api/jrx/auth/login \
  -H 'Content-Type: application/json' -H 'Origin: https://api.nyayasiddhi.online' \
  -d "{\"email\":\"admin@nyayavigya.in\",\"password\":\"${NV_DEMO_PW}\"}" >/dev/null
TOKEN="$(python3 -c 'import json;d=json.load(open("/tmp/login.json"));print(d.get("token") or d.get("accessToken") or "")')"
echo "token_len=${#TOKEN}"
AUTH="Authorization: Bearer ${TOKEN}"; ORG='Origin: https://api.nyayasiddhi.online'; CT='Content-Type: application/json'

echo "=== 1) /documents/merge (deterministic) ==="
curl -sS -m 60 -X POST http://127.0.0.1:5000/api/jrx/documents/merge -H "$AUTH" -H "$ORG" -H "$CT" \
  -d '{"documents":[{"title":"NDA-A","text":"1. Confidentiality. Each party shall keep information secret.\n\n2. Termination. This agreement terminates after 2 years."},{"title":"NDA-B","text":"1. Confidentiality. Each party shall keep information secret.\n\n2. Termination. This agreement terminates after 5 years upon notice."}],"dedupeClauses":true}' \
  | python3 -c 'import json,sys;d=json.load(sys.stdin).get("data",{});print(" stats=",d.get("stats")," conflicts=",len(d.get("conflicts",[]))," deduped=",d.get("dedupedCount"));[print("  conflict:",c.get("clauseKey"),c.get("sources")) for c in d.get("conflicts",[])]' 2>&1

echo "=== 2) /documents/redline (diff only, fast) ==="
curl -sS -m 60 -X POST http://127.0.0.1:5000/api/jrx/documents/redline -H "$AUTH" -H "$ORG" -H "$CT" \
  -d '{"documentA":"The term is 2 years.\nGoverning law: Delhi.","documentB":"The term is 5 years.\nGoverning law: Mumbai.\nLiability is capped at fees paid.","semantic":false}' \
  | python3 -c 'import json,sys;d=json.load(sys.stdin).get("data",{});print(" stats=",d.get("stats"));print(" unified:\n"+(d.get("unified","")[:300]))' 2>&1

echo "=== 3) /documents/redline (with semantic LLM) ==="
curl -sS -m 180 -X POST http://127.0.0.1:5000/api/jrx/documents/redline -H "$AUTH" -H "$ORG" -H "$CT" \
  -d '{"documentA":"Liability is unlimited. The term is 2 years. Either party may terminate with 30 days notice.","documentB":"Liability is capped at fees paid in the prior 12 months. The term is 5 years. Termination requires 90 days notice.","semantic":true,"jurisdiction":"india"}' \
  | python3 -c 'import json,sys;d=json.load(sys.stdin).get("data",{});print(" summary=",(d.get("semanticSummary","") or "(none)")[:200]);print(" materialChanges=",len(d.get("materialChanges",[])));[print("  -",m.get("category"),m.get("severity")) for m in d.get("materialChanges",[])]' 2>&1

echo "=== 4) /documents/highlight (analyze + spans) ==="
curl -sS -m 180 -X POST http://127.0.0.1:5000/api/jrx/documents/highlight -H "$AUTH" -H "$ORG" -H "$CT" \
  -d '{"text":"SERVICE AGREEMENT. The Provider shall deliver services. Liability of the Provider is unlimited for any damages. Payment is due within 90 days. This agreement contains no confidentiality clause. The Client may terminate at will without notice. Personal data including Aadhaar numbers will be shared with third parties."}' \
  | python3 -c 'import json,sys;d=json.load(sys.stdin).get("data",{});print(" docType=",d.get("documentType")," risks=",len(d.get("risks",[]))," highlights=",len(d.get("highlights",[]))," privacy=",len(d.get("privacyAlerts",[])));[print("  span:",h.get("kind"),h.get("severity"),h.get("label"),"@",h.get("start"),"-",h.get("end")) for h in d.get("highlights",[])[:5]]' 2>&1

echo "=== 5) /compliance/iso (compliance page source) ==="
curl -sS -m 60 "http://127.0.0.1:5000/api/jrx/compliance/iso" -H "$AUTH" -H "$ORG" \
  | python3 -c 'import json,sys;d=json.load(sys.stdin);fw=d.get("frameworks",[]);print(" frameworks=",len(fw));[print("  -",f.get("framework"),"controls=",len(f.get("controls",[])),"counts=",f.get("counts")) for f in fw]' 2>&1
