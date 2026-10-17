#!/usr/bin/env bash
# Dump wrapped NYV knowledge compare bodies (no secrets) + POST vs GET.
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"
NSPK=$(grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')

dump() {
  local method="$1" url="$2" extra="${3:-}"
  echo "=== $method $url ==="
  if [ "$method" = POST ]; then
    curl -sS -m 25 -o /tmp/nvk.json -w "HTTP %{http_code} time=%{time_total}\n" \
      -X POST -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' \
      -d "$extra" "$url" || echo HTTP 000
  else
    curl -sS -m 25 -o /tmp/nvk.json -w "HTTP %{http_code} time=%{time_total}\n" \
      -H "X-API-Key: ${NSPK}" "$url" || echo HTTP 000
  fi
  python3 - <<'PY'
import json
d=json.load(open("/tmp/nvk.json"))
print("top_keys", list(d.keys())[:20] if isinstance(d,dict) else type(d))
data=d.get("data") if isinstance(d,dict) else None
print("success", d.get("success") if isinstance(d,dict) else None)
print("error", str(d.get("error") or d.get("message") or "")[:160])
if isinstance(data, dict):
    print("data_keys", list(data.keys())[:20])
    print("found", data.get("found"))
    print("bns", len(data.get("bnsMatches") or []))
    print("matches", len(data.get("matches") or []))
    ipc=data.get("ipc") or {}
    if isinstance(ipc, dict):
        print("ipc", ipc.get("section"), ipc.get("mappedSections"), str(ipc.get("heading") or "")[:70])
    if data.get("bnsMatches"):
        b=data["bnsMatches"][0]
        print("bns0", b.get("code"), b.get("section"), str(b.get("heading") or "")[:70])
    if data.get("matches"):
        m=data["matches"][0]
        print("m0", m.get("code"), m.get("section"), str(m.get("heading") or "")[:70])
    print("method", data.get("method"), "total", data.get("total"), "results", len(data.get("results") or data.get("steps") or []))
elif data is not None:
    print("data_type", type(data), str(data)[:200])
else:
    print("no_data_wrapper", str(d)[:300])
PY
}

dump GET "${API}/api/jrx/knowledge/statutes/compare/ipc-bns?section=302"
dump GET "${API}/api/jrx/knowledge/statutes/compare/old-new?from=CrPC&section=438"
dump GET "${API}/api/jrx/knowledge/statutes/search?q=IPC%20302&limit=3"
dump POST "${API}/api/jrx/knowledge/statutes/compare/ipc-bns" '{"section":"302","from":"IPC"}'
dump POST "${API}/api/jrx/knowledge/retrieve" '{"query":"What replaced IPC 302?"}'
echo "=== ORCHESTRATE IPC302 (legal-chat, 90s cap) ==="
START=$(date +%s)
code=$(curl -sS -o /tmp/nvk.json -w '%{http_code}' -m 90 \
  -X POST -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' \
  -d '{"prompt":"What BNS section replaced IPC 302? Answer with the BNS number and title only.","jurisdiction":"IN","taskType":"legal-chat","mode":"sync","maxTokens":256}' \
  "${API}/api/jrx/orchestrate" || echo 000)
ELAP=$(( $(date +%s) - START ))
python3 - "$code" "$ELAP" <<'PY'
import json,sys
code,elap=sys.argv[1],sys.argv[2]
try: d=json.load(open("/tmp/nvk.json"))
except Exception: d={}
data=d.get("data") or d
print("HTTP",code,"s=",elap,"model",data.get("model"),"provider",data.get("provider"),
      "content_len", len(str(data.get("content") or "")),
      "err", str(d.get("error") or data.get("error") or "")[:120],
      "preview", str(data.get("content") or "")[:180].replace("\n"," "))
PY
