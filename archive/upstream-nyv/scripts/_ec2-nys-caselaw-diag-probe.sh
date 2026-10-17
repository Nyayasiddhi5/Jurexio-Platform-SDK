#!/usr/bin/env bash
# NYS caselaw regression diag — runs ON nysdev. Keys from canonical env only.
# NV-SECRETS-001: never echo secret values.
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"

read_canon_key() {
  grep -E "^${1}=" "$CANON" 2>/dev/null | head -1 | cut -d= -f2- \
    | sed -E 's/^[[:space:]"'\'' ]+//; s/[[:space:]"'\'' ]+$//; s/\r$//'
}

NSPK="$(read_canon_key NYV_SDK_KEY_NSP)"

echo "=== DEPLOY ==="
echo "CURRENT=$(cat /opt/nyayavigya/CURRENT_DEPLOY 2>/dev/null || echo missing)"

echo "=== GATEWAY ENV (key names + presence only) ==="
docker exec nyv-gateway sh -c '
  for k in NYV_F_NYS_KNOWLEDGE_PLANE NYS_KNOWLEDGE_BASE_URL NYS_KNOWLEDGE_API_KEY NYV_CASELAW_HYBRID_BUDGET_MS; do
    v=$(printenv "$k" 2>/dev/null || true)
    if [ -n "$v" ]; then
      if [ "$k" = "NYS_KNOWLEDGE_BASE_URL" ]; then
        echo "$k=set len=$(printf %s "$v" | wc -c)"
      elif [ "$k" = "NYS_KNOWLEDGE_API_KEY" ]; then
        echo "$k=set len=$(printf %s "$v" | wc -c)"
      else
        echo "$k=$v"
      fi
    else
      echo "$k=UNSET"
    fi
  done
' 2>/dev/null || echo "gateway_exec_fail"

echo "=== CANON ENV (NYS keys presence) ==="
for k in NYV_F_NYS_KNOWLEDGE_PLANE NYS_KNOWLEDGE_BASE_URL NYS_KNOWLEDGE_API_KEY; do
  v=$(read_canon_key "$k")
  if [ -n "$v" ]; then
    if [ "$k" = "NYS_KNOWLEDGE_BASE_URL" ]; then
      echo "$k=set len=$(printf %s "$v" | wc -c)"
    elif [ "$k" = "NYS_KNOWLEDGE_API_KEY" ]; then
      echo "$k=set len=$(printf %s "$v" | wc -c)"
    else
      echo "$k=$v"
    fi
  else
    echo "$k=UNSET"
  fi
done

NYS_BASE="$(read_canon_key NYS_KNOWLEDGE_BASE_URL)"
NYS_KEY="$(read_canon_key NYS_KNOWLEDGE_API_KEY)"

echo "=== DIRECT NYS UPSTREAM (from nysdev host) ==="
if [ -n "$NYS_BASE" ] && [ -n "$NYS_KEY" ]; then
  BASE="${NYS_BASE%/}"
  for mode in fts hybrid; do
    tmp=$(mktemp)
    code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 30 \
      -H "x-api-key: $NYS_KEY" \
      "$BASE/caselaw/search?q=Section+420+IPC&limit=5&mode=$mode" 2>/dev/null || echo ERR)
    python3 - "$mode" "$code" "$tmp" <<'PY'
import json, sys
mode, code, path = sys.argv[1:4]
try:
    d = json.load(open(path))
    total = d.get("total", d.get("data", {}).get("total", "?"))
    method = d.get("method", d.get("searchMethod", "-"))
    err = d.get("error", d.get("message", "-"))
    print(f"DIRECT_NYS mode={mode} http={code} total={total} method={method} err={str(err)[:80]}")
except Exception as e:
    raw = open(path).read()[:200]
    print(f"DIRECT_NYS mode={mode} http={code} parse_err={e} raw={raw}")
PY
    rm -f "$tmp"
  done
  # health
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "${BASE%/api}/health" 2>/dev/null || echo ERR)
  echo "DIRECT_NYS health http=$code url=${BASE%/api}/health"
else
  echo "DIRECT_NYS_SKIP=missing_base_or_key"
fi

echo "=== GATEWAY CASELAW (full envelope keys) ==="
if [ "$(printf %s "$NSPK" | wc -c)" -gt 16 ]; then
  tmp=$(mktemp)
  code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 60 \
    -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" \
    "$API/api/jrx/knowledge/caselaw/search?q=Section+420+IPC&limit=5&mode=fts" 2>/dev/null || echo ERR)
  python3 - "$code" "$tmp" <<'PY'
import json, sys
code, path = sys.argv[1:3]
try:
    d = json.load(open(path))
    data = d.get("data") or d
    print(f"GATEWAY http={code} success={d.get('success')} source={d.get('source')}")
    print(f"  total={data.get('total')} degraded={data.get('degraded')} degradedReason={data.get('degradedReason','-')}")
    meta = data.get("metadata") or {}
    print(f"  metadata={meta}")
    print(f"  top_keys={list(d.keys())} data_keys={list(data.keys())[:12]}")
except Exception as e:
    print(f"GATEWAY http={code} parse_err={e}")
PY
  rm -f "$tmp"
fi

echo "=== CNR PROBES ==="
if [ "$(printf %s "$NSPK" | wc -c)" -gt 16 ]; then
  for cnr in TSWL000000742024 RJHC010324382023; do
    tmp=$(mktemp)
    code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 120 -X POST \
      -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" -H "Content-Type: application/json" \
      -d "{\"cnr\":\"$cnr\",\"claimEcourts\":false}" \
      "$API/api/jrx/v1/sdk/cnr/resolve" 2>/dev/null || echo ERR)
    python3 - "$cnr" "$code" "$tmp" <<'PY'
import json, sys
cnr, code, path = sys.argv[1:4]
try:
    d = json.load(open(path))
    err = d.get("error") or {}
    data = d.get("data") or d
    print(f"CNR {cnr} http={code} success={d.get('success')} err_code={err.get('code')} err_msg={str(err.get('message',''))[:80]}")
    print(f"  status={data.get('status')} tier={data.get('tier') or data.get('source')}")
except Exception as e:
    raw = open(path).read()[:150]
    print(f"CNR {cnr} http={code} parse_err={e} raw={raw}")
PY
    rm -f "$tmp"
  done
fi

echo "=== GATEWAY LOG GREP NYS/caselaw 2h ==="
docker logs nyv-gateway --since 2h 2>&1 \
  | grep -iE 'caselaw|nys-knowledge|nysKnowledge|upstream failed|degraded|CNR|503|502|ETIMEDOUT|ECONNREFUSED' \
  | tail -30 || echo gateway_nys_log_clean

echo "=== PROBE COMPLETE ==="
