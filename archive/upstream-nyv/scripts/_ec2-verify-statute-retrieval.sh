#!/usr/bin/env bash
set +e
CANON="/opt/Nyayavigya/secrets/.env.production"
NV_DEMO_PW="$(grep -E '^NV_DEMO_PASSWORD=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')"
code=$(curl -sS -o /tmp/login.json -w '%{http_code}' -m 20 -X POST http://127.0.0.1:5000/api/jrx/auth/login \
  -H 'Content-Type: application/json' -H 'Origin: https://api.nyayasiddhi.online' \
  -d "{\"email\":\"admin@nyayavigya.in\",\"password\":\"${NV_DEMO_PW}\"}")
TOKEN="$(python3 -c 'import json;d=json.load(open("/tmp/login.json"));print(d.get("token") or d.get("accessToken") or "")' 2>/dev/null)"
echo "login=$code token_len=${#TOKEN}"

retrieve() {
  local JUR="$1"; local Q="$2"
  curl -sS -m 60 -X POST http://127.0.0.1:5000/api/jrx/rag/collections/auto/retrieve \
    -H 'Content-Type: application/json' -H "Authorization: Bearer ${TOKEN}" -H 'Origin: https://api.nyayasiddhi.online' \
    -d "{\"query\":\"${Q}\",\"jurisdiction\":\"${JUR}\",\"topK\":5}" \
  | python3 -c 'import json,sys
d=json.load(sys.stdin).get("data",{})
print(f"  layers={d.get(\"layersUsed\")} methods={d.get(\"retrievalMethods\")} chunks={d.get(\"chunkCount\")} conf={d.get(\"confidence\")}")
for c in (d.get("chunks") or [])[:2]:
    t=(c.get("content") or c.get("text") or "")[:90].replace(chr(10)," ")
    print(f"    - {t}")' 2>/dev/null
}
echo "[UK] bribery / failure to prevent:"; retrieve UK "corporate failure to prevent bribery adequate procedures"
echo "[US] antitrust monopoly:"; retrieve US "monopolizing trade Sherman Act restraint of trade"
echo "[EU] competition dominant position:"; retrieve EU "abuse of dominant position anti-competitive agreements"
echo "[SG] data protection consent:"; retrieve SG "personal data protection purpose limitation consent"

echo "=== tsvector statute search (direct nv_statutes) ==="
for QQ in "bribery" "fair use copyright" "abuse of dominant position" "corporate tax UAE"; do
  curl -sS -m 30 "http://127.0.0.1:5000/api/jrx/statutes/search?q=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote('$QQ'))")&limit=2" \
    -H "Authorization: Bearer ${TOKEN}" -H 'Origin: https://api.nyayasiddhi.online' \
  | python3 -c 'import json,sys
try:
  d=json.load(sys.stdin)
  rows=d.get("results") or (d.get("data") or {}).get("results") or []
  print(f"  q-results={len(rows)}: "+", ".join((r.get("act_short_title","?")+" §"+str(r.get("section_number","?"))) for r in rows[:2]))
except Exception as e: print("  parse-err",e)' 2>/dev/null
done
