#!/usr/bin/env bash
# NV-RAG-CONF-VERIFY-001 — the RRF ceiling predicts confidence can never reach
# the 0.55 re-retrieval threshold. If true, ragConfidence is a near-constant
# ~0.47-0.53 across wildly different queries, and re-retrieval fires 100%.
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"
NSPK=$(grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')

probe() {
  local label="$1" q="$2"
  printf '%-34s ' "$label"
  curl -sS -m 200 -o /tmp/rc.json -w "t=%{time_total} " \
    -X POST -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' -H 'X-NYV-Consent: granted' \
    -d "$(python3 -c 'import json,sys;print(json.dumps({"prompt":sys.argv[1],"jurisdiction":"IN","enableRAG":True}))' "$q")" \
    "${API}/api/jrx/orchestrate" >/dev/null 2>&1 || printf 't=ERR '
  python3 - <<'PY'
import json
try:
    d = json.load(open("/tmp/rc.json"))
except Exception:
    print("parse_fail"); raise SystemExit
n = d.get("data") if isinstance(d.get("data"), dict) else d
def dig(o, *names, depth=0):
    if depth > 4 or not isinstance(o, (dict, list)): return None
    if isinstance(o, dict):
        for k, v in o.items():
            if k in names and isinstance(v, (int, float)): return v
            r = dig(v, *names, depth=depth+1)
            if r is not None: return r
    else:
        for v in o:
            r = dig(v, *names, depth=depth+1)
            if r is not None: return r
    return None
conf = dig(n, "ragConfidence", "confidence")
tk = n.get("tokens") or {}
layers = n.get("layersUsed") or n.get("layers") or []
print(f"conf={conf}  in={tk.get('prompt')}  model={str(n.get('model'))[:26]}  layers={len(layers) if isinstance(layers,list) else layers}")
PY
}

echo "=== ragConfidence across very different query shapes ==="
probe "statute micro-FAQ"   "What is BNS 103?"
probe "criminal procedure"  "Anticipatory bail conditions under BNSS 482"
probe "contract"            "Is a liquidated damages clause enforceable under the Indian Contract Act?"
probe "tax"                 "GST input tax credit reversal rules for exempt supplies"
probe "nonsense control"    "zzqq wibble frobnicate quuxbar"
echo
echo "Prediction: all non-empty retrievals cluster in 0.46-0.53 and never reach 0.55,"
echo "so agenticReretrieval fires on every one of them."
