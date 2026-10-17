#!/usr/bin/env bash
# NV-CNR-P0-ENRICH-001 — post-deploy P0 enrichment probe (fieldAvailability, counts, B9 suggested, includeTimeline).
# Runs ON nysdev EC2. NV-SECRETS-001: counts/lengths only, no secret values.
set -uo pipefail

CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"
DEPLOY_DIR="/opt/nyayavigya/repo/CURRENT_DEPLOY"

read_canon_key() {
  grep -E "^${1}=" "$CANON" 2>/dev/null | head -1 | cut -d= -f2- \
    | sed -E 's/^[[:space:]"'\'' ]+//; s/[[:space:]"'\'' ]+$//; s/\r$//'
}

NSPK="$(read_canon_key NYV_SDK_KEY_NSP)"

probe_json() {
  local label="$1" body="$2"
  local tmp; tmp=$(mktemp)
  local start_ms end_ms ms code
  start_ms=$(date +%s%3N 2>/dev/null || python3 -c 'import time;print(int(time.time()*1000))')
  code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 120 -X POST \
    -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" -H "Content-Type: application/json" \
    -d "$body" "$API/api/jrx/v1/sdk/cnr/resolve" 2>/dev/null || echo ERR)
  end_ms=$(date +%s%3N 2>/dev/null || python3 -c 'import time;print(int(time.time()*1000))')
  ms=$((end_ms - start_ms))
  python3 - "$label" "$code" "$ms" "$tmp" <<'PY'
import json, sys
label, code, ms, path = sys.argv[1:5]
try:
    raw = open(path).read()
    d = json.loads(raw) if raw.strip() else {}
    data = d.get("data") or d
    meta = data.get("meta") or {}
    fa = meta.get("fieldAvailability")
    counts = meta.get("counts")
    candidates = data.get("candidates") or []
    fields = data.get("fields") or {}
    hearings = (fields.get("hearings") or {}).get("value") or []
    docs = data.get("documents") or []
    tl = (data.get("caseCreate") or {}).get("timeline") or []
    doc_urls = sum(1 for h in hearings if isinstance(h, dict) and h.get("docUrl"))
    tl_doc_urls = sum(1 for e in tl if isinstance(e, dict) and e.get("docUrl"))
    print(
        f"PROBE {label} http={code} ms={ms} success={d.get('success')} "
        f"status={data.get('status')} source={data.get('source') or meta.get('tier')} "
        f"fieldAvailability={'yes' if isinstance(fa, dict) and fa else 'no'} "
        f"fa_keys={len(fa) if isinstance(fa, dict) else 0} "
        f"counts={'yes' if isinstance(counts, dict) and counts else 'no'} "
        f"count_keys={len(counts) if isinstance(counts, dict) else 0} "
        f"candidates={len(candidates)} "
        f"hearings={len(hearings) if isinstance(hearings, list) else 0} "
        f"hearing_docUrl={doc_urls} timeline={len(tl)} timeline_docUrl={tl_doc_urls} "
        f"documents={len(docs)} cnr={data.get('cnr')!r}"
    )
    if candidates:
        tiers = [c.get('tier') or c.get('source') for c in candidates[:3] if isinstance(c, dict)]
        print(f"  candidate_tiers={tiers}")
except Exception as e:
    print(f"PROBE {label} http={code} ms={ms} parse_err={e} body_head={open(path).read()[:120]}")
PY
  rm -f "$tmp"
}

echo "=== CNR P0 ENRICH PROBE $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "NSP_key_len=$(printf %s "$NSPK" | wc -c | tr -d ' ')"

if [ -L "$DEPLOY_DIR" ] || [ -d "$DEPLOY_DIR" ]; then
  echo "CURRENT_DEPLOY=$(readlink -f "$DEPLOY_DIR" 2>/dev/null || echo "$DEPLOY_DIR")"
  if [ -f "$DEPLOY_DIR/.deploy-meta" ]; then
    cat "$DEPLOY_DIR/.deploy-meta" 2>/dev/null || true
  fi
fi

if [ -f /opt/nyayavigya/deploys.log ]; then
  echo "last_deploy_line=$(tail -1 /opt/nyayavigya/deploys.log)"
fi

health_code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$API/api/jrx/health" 2>/dev/null || echo ERR)
echo "health_http=$health_code"

if [ "$(printf %s "$NSPK" | wc -c)" -le 16 ]; then echo "SKIP no NSP key"; exit 1; fi

# P0-A: fieldAvailability + counts on HC resolve
probe_json "P0A_HC_CNR" \
  '{"identifier":"RJHC010324382023","options":{"profile":"caseCreate"}}'

# P0-B: B9 duplicate DLCT without courtType → suggested + candidates
probe_json "P0B_B9_DLCT_SUGGESTED" \
  '{"identifier":"DLCT010001232023","options":{"profile":"caseCreate"}}'

# P0-C: includeTimeline forces timeline fetch + docUrl mapping
probe_json "P0C_INCLUDE_TIMELINE" \
  '{"identifier":"RJHC010324382023","options":{"profile":"caseCreate","includeTimeline":true}}'

echo "=== P0 PROBE DONE ==="
