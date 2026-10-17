#!/usr/bin/env bash
# NYV-2 deployed-state truth + retried gateway repro. Read-only.
set -uo pipefail
OUT=/tmp/nyv2-before.txt
: > "$OUT"
log() { printf '%s\n' "$*" >> "$OUT"; }

log "== what the DEPLOYED container actually has for the search route =="
log "-- /app/src exists? $(docker exec nyv-gateway sh -c 'ls -d /app/src >/dev/null 2>&1 && echo yes || echo no')"
log "-- /app/dist exists? $(docker exec nyv-gateway sh -c 'ls -d /app/dist >/dev/null 2>&1 && echo yes || echo no')"
log "-- baseQuery block as deployed:"
docker exec nyv-gateway sh -c "grep -n 'const baseQuery' -A20 /app/src/routes/jrx-knowledge-plane-routes.ts" >> "$OUT" 2>&1
log "-- does deployed source mention courtType anywhere in this route file?"
log "count=$(docker exec nyv-gateway sh -c "grep -c 'courtType' /app/src/routes/jrx-knowledge-plane-routes.ts || true")"
log "-- deployed authorityTokens filter (numeric defect, as deployed):"
docker exec nyv-gateway sh -c "grep -n 'function authorityTokens' -A8 /app/src/routes/jrx-knowledge-plane-routes.ts" >> "$OUT" 2>&1

KEY=$(docker exec nyv-gateway printenv NYV_SDK_KEY_NSP | tr -d '\r\n')
NYS_BASE=$(docker exec nyv-gateway printenv NYS_KNOWLEDGE_BASE_URL | tr -d '\r\n')
NYS_KEY=$(docker exec nyv-gateway printenv NYS_KNOWLEDGE_API_KEY | tr -d '\r\n')
log ""
log "== instruments: key_len=${#KEY} nys_key_len=${#NYS_KEY} =="
GW=http://127.0.0.1:5000
H=(-H "x-api-key: $KEY" -H "x-nyv-platform: nsp" -H "x-nyv-consent: granted")

# Let the NYS circuit breaker cool down (10s per compose) before measuring.
sleep 20

log ""
log "== gateway search, WITH the full error envelope so ok:false is explained =="
gw() { local label="$1"; shift
  local r; r=$(curl -s --max-time 90 "${H[@]}" --get "$GW/api/jrx/knowledge/caselaw/search" \
      --data-urlencode 'q=anticipatory bail' --data-urlencode 'limit=5' \
      --data-urlencode 'mode=fts' "$@")
  log "--- gw $label"
  printf '%s' "$r" | jq -c '{ok:.success, err:.error.message, total:.data.total,
    offset:.data.offset, sort:.data.sort, lowerBound:.data.totalIsLowerBound,
    fs:(.data.filterSupport|if .==null then "ABSENT" else "present" end),
    courts:[.data.results[]?.court]|unique, ids:[.data.results[]?.id]}' >> "$OUT" 2>/dev/null \
    || log "RAW: $(printf '%s' "$r" | head -c 300)"
  sleep 3
}
gw 'baseline'
gw 'courtType=sc' --data-urlencode 'courtType=sc'
gw 'courtType=hc' --data-urlencode 'courtType=hc'
gw 'offset=5' --data-urlencode 'offset=5'
gw 'sort=date' --data-urlencode 'sort=date'

log ""
log "== NYS-direct on the SAME query, as the positive control for each param =="
ny() { local label="$1"; shift
  local r; r=$(curl -s --max-time 90 -H "X-API-Key: $NYS_KEY" -H "Authorization: Bearer $NYS_KEY" \
      --get "$NYS_BASE/caselaw/search" --data-urlencode 'q=anticipatory bail' \
      --data-urlencode 'jurisdiction=IN' --data-urlencode 'limit=5' \
      --data-urlencode 'mode=fts' "$@")
  log "--- nys $label"
  printf '%s' "$r" | jq -c '{total:.total, offset:.offset, sort:.sort,
    lowerBound:.totalIsLowerBound, fs:(.filterSupport|if .==null then "ABSENT" else "present" end),
    courts:[.results[]?.court]|unique, ids:[.results[]?.id], err:.error}' >> "$OUT" 2>/dev/null \
    || log "RAW: $(printf '%s' "$r" | head -c 300)"
  sleep 2
}
ny 'baseline'
ny 'courtType=sc' --data-urlencode 'courtType=sc'
ny 'courtType=hc' --data-urlencode 'courtType=hc'
ny 'offset=5' --data-urlencode 'offset=5'
ny 'sort=date' --data-urlencode 'sort=date'
log "--- nys filterSupport block verbatim"
curl -s --max-time 90 -H "X-API-Key: $NYS_KEY" -H "Authorization: Bearer $NYS_KEY" \
  --get "$NYS_BASE/caselaw/search" --data-urlencode 'q=anticipatory bail' \
  --data-urlencode 'jurisdiction=IN' --data-urlencode 'limit=1' --data-urlencode 'mode=fts' \
  | jq -c '{filterSupport, slo, countCap, totalCapped, totalIsLowerBound}' >> "$OUT" 2>&1

log ""
log "== END =="
cat "$OUT"
