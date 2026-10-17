#!/usr/bin/env bash
# NV-DETERMINISTIC-COVERAGE-001 — prove which of today's LLM-answered queries
# NYS can already answer deterministically, and how fast.
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"
NSPK=$(grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')

g() {
  local label="$1" path="$2"
  printf '%-38s ' "$label"
  curl -sS -m 30 -o /tmp/dc.json -w "HTTP %{http_code} t=%{time_total} " \
    -H "X-API-Key: ${NSPK}" "${API}${path}" || printf 'HTTP 000 '
  python3 - <<'PY'
import json
try:
    d = json.load(open("/tmp/dc.json"))
except Exception:
    print("unparseable"); raise SystemExit
n = d.get("data") if isinstance(d.get("data"), dict) else d
keys = [k for k in ("found", "total", "method", "intent", "llmRequired") if k in n]
print(" ".join(f"{k}={n[k]}" for k in keys) or f"keys={list(n.keys())[:6]}")
PY
}

echo "=== can NYS answer these WITHOUT an LLM? ==="
g "statute lookup BNS 103"      "/api/jrx/knowledge/statutes/search?q=BNS%20103&limit=3"
g "statute lookup BNS 318"      "/api/jrx/knowledge/statutes/search?q=BNS%20318%20cheating&limit=3"
g "compare ipc-bns 302"         "/api/jrx/knowledge/statutes/compare/ipc-bns?section=302"
g "compare old-new CrPC 438"    "/api/jrx/knowledge/statutes/compare/old-new?from=CrPC&section=438"

echo
echo "=== NYS /retrieve intent + llmRequired per query shape ==="
r() {
  local label="$1" q="$2"
  printf '%-38s ' "$label"
  curl -sS -m 30 -o /tmp/dr.json -w "HTTP %{http_code} t=%{time_total} " \
    -X POST -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' \
    -d "$(python3 -c 'import json,sys;print(json.dumps({"query":sys.argv[1],"jurisdiction":"IN"}))' "$q")" \
    "${API}/api/jrx/knowledge/retrieve" || printf 'HTTP 000 '
  python3 - <<'PY'
import json
try:
    d = json.load(open("/tmp/dr.json"))
except Exception:
    print("unparseable"); raise SystemExit
n = d.get("data") if isinstance(d.get("data"), dict) else d
print(f"intent={n.get('intent')} llmRequired={n.get('llmRequired')} method={n.get('method')} steps={len(n.get('steps') or [])} reason={str(n.get('reason') or '')[:50]}")
PY
}
r "What is BNS 103?"            "What is BNS 103?"
r "mapping question"            "What BNS section replaced IPC 302?"
r "anticipatory bail BNS 318(4)" "Is anticipatory bail available for BNS 318(4) cheating?"
r "research question"           "Leading Supreme Court authorities on anticipatory bail in economic offences"
r "drafting request"            "Draft an anticipatory bail application under BNSS 482"
