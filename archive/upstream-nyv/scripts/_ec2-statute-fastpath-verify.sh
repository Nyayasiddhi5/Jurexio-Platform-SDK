#!/usr/bin/env bash
# Post-deploy verify for NV-STATUTE-MAP-FASTPATH-001 (2026-08-15T0946Z-aws-ssm).
# Confirms: mapping FAQ answers with no LLM and <2s, POST compare 200, non-mapping chat still counsel-grade.
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"
NSPK=$(grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')

orch() {
  local label="$1" prompt="$2"
  echo "=== ORCHESTRATE: ${label} ==="
  curl -sS -m 120 -o /tmp/nvo.json -w "HTTP %{http_code} time=%{time_total}\n" \
    -X POST -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' \
    -H 'X-NYV-Consent: granted' \
    -d "$(python3 -c 'import json,sys;print(json.dumps({"prompt":sys.argv[1],"jurisdiction":"IN"}))' "$prompt")" \
    "${API}/api/jrx/orchestrate" || echo "HTTP 000"
  python3 - <<'PY'
import json
d = json.load(open("/tmp/nvo.json"))
data = d.get("data") if isinstance(d, dict) else None
node = data if isinstance(data, dict) else d
content = str(node.get("content") or node.get("response") or "")
print("model    ", node.get("model"))
print("provider ", node.get("provider"))
print("len      ", len(content))
print("preview  ", content[:200].replace("\n", " | "))
meta = node.get("orchestration") or node.get("metadata") or {}
if isinstance(meta, dict):
    print("layers   ", meta.get("layersUsed"))
PY
}

cmp_post() {
  local kind="$1" body="$2"
  echo "=== POST compare/${kind} ${body} ==="
  curl -sS -m 30 -o /tmp/nvc.json -w "HTTP %{http_code} time=%{time_total}\n" \
    -X POST -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' \
    -d "$body" "${API}/api/jrx/knowledge/statutes/compare/${kind}" || echo "HTTP 000"
  python3 - <<'PY'
import json
d = json.load(open("/tmp/nvc.json"))
data = d.get("data") if isinstance(d, dict) else None
print("success", d.get("success"), "error", str(d.get("error") or "")[:120])
if isinstance(data, dict):
    print("found", data.get("found"))
    for b in (data.get("bnsMatches") or data.get("matches") or [])[:2]:
        print("  ->", b.get("code"), b.get("section"), str(b.get("heading") or "")[:60])
PY
}

orch "IPC 302 mapping (expect nys-statute-map, <2s, BNS 103)" "What BNS section replaced IPC 302?"
orch "CrPC 438 mapping (expect nys-statute-map, BNSS 482)" "Which BNSS section replaced CrPC 438?"
orch "IRPC 420 mapping alias" "What replaced IRPC 420?"
orch "non-mapping counsel (expect Sonnet 5 / Gemini, NOT 200s)" "Draft a short note on anticipatory bail strategy for a first-time economic offence accused in Telangana."

cmp_post "ipc-bns" '{"section":"302"}'
cmp_post "old-new" '{"from":"CrPC","section":"438"}'
cmp_post "old-new" '{"from":"IRPC","section":"438"}'

echo "=== router primary (env sanity, no values) ==="
docker exec nyv-gateway printenv NYV_LLM_CASCADE_LEAD 2>/dev/null | cut -c1-160 || true
echo "=== recent statute fastpath hits ==="
docker logs --since 10m nyv-gateway 2>&1 | grep -icE 'statute_mapping_fastpath|nys-statute-map' || echo 0
