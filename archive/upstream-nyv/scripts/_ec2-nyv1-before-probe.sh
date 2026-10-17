#!/usr/bin/env bash
# NYV-1/NYV-2 before-state probe. Reproduces (a) the numeric-token wrong-case
# substitution on /caselaw/treatment and (b) the dropped courtType on
# /caselaw/search, against the DEPLOYED gateway. Read-only: no restarts, no
# compose, no writes into the container.
set -uo pipefail
OUT=/tmp/nyv1-before.txt
: > "$OUT"
log() { printf '%s\n' "$*" >> "$OUT"; }

KEY=$(docker exec nyv-gateway printenv NYV_SDK_KEY_NSP 2>/dev/null | tr -d '\r\n')
NYS_BASE=$(docker exec nyv-gateway printenv NYS_KNOWLEDGE_BASE_URL 2>/dev/null | tr -d '\r\n')
NYS_KEY=$(docker exec nyv-gateway printenv NYS_KNOWLEDGE_API_KEY 2>/dev/null | tr -d '\r\n')
log "== instruments =="
log "key_len=${#KEY} nys_key_len=${#NYS_KEY} nys_base_set=$([ -n "$NYS_BASE" ] && echo yes || echo no)"
log "deployed_sha=$(docker exec nyv-gateway printenv NYV_GIT_SHA 2>/dev/null | tr -d '\r\n')"
log "jq=$(command -v jq >/dev/null && echo yes || echo NO)"
if [ "${#KEY}" -lt 8 ]; then log "FATAL: instrument failed, key_len too small"; cat "$OUT"; exit 1; fi

GW=http://127.0.0.1:5000
H=(-H "x-api-key: $KEY" -H "x-nyv-platform: nsp" -H "x-nyv-consent: granted")

# Positive control: the gateway is reachable and authenticating.
log ""
log "== positive control: gateway health + an authenticated search =="
log "health_http=$(curl -s -o /dev/null -w '%{http_code}' "$GW/health")"
CTRL=$(curl -s "${H[@]}" --get "$GW/api/jrx/knowledge/caselaw/search" \
  --data-urlencode 'q=bail' --data-urlencode 'limit=3' --data-urlencode 'mode=fts')
log "control_ok=$(printf '%s' "$CTRL" | jq -r '.success')"
log "control_total=$(printf '%s' "$CTRL" | jq -r '.data.total // "none"')"

treat() { # $1=citation  $2=exact(0|1)  $3=label
  local url="$GW/api/jrx/knowledge/caselaw/treatment"
  local r
  r=$(curl -s "${H[@]}" --get "$url" --data-urlencode "citation=$1" \
      $( [ "$2" = "1" ] && printf '%s' '--data-urlencode exact=true' ) )
  log "--- $3 (exact=$2) citation=$1"
  printf '%s' "$r" | jq -c '{ok:.success, matched:.data.authority.resolution.matched,
    method:.data.authority.resolution.method, conf:.data.authority.resolution.confidence,
    title:.data.authority.title, court:.data.authority.court, year:.data.authority.year,
    goodLaw:.data.goodLaw, unknownReason:.data.unknownReason}' >> "$OUT" 2>/dev/null \
    || log "RAW: $(printf '%s' "$r" | head -c 400)"
}

log ""
log "== FIX 1 REPRO: numeric-token citations =="
treat '[1980] 3 S.C.R. 383' 0 'SCR-1980'
treat '[1980] 3 S.C.R. 383' 1 'SCR-1980'
treat '[2018] 6 S.C.R. 825' 0 'SCR-2018'
treat '[2018] 6 S.C.R. 825' 1 'SCR-2018'

log ""
log "== FIX 1 CONTROLS: real authorities must resolve =="
treat 'Kesavananda Bharati v. State of Kerala' 0 'Kesavananda'
treat 'Maneka Gandhi v. Union of India' 0 'Maneka'
treat 'Vodafone International Holdings' 0 'Vodafone-name'
treat 'Vodafone (2012) 6 SCC 613' 0 'Vodafone-citation'
treat 'State of Kerala' 0 'place-only'

log ""
log "== FIX 2 REPRO: courtType through the gateway =="
gwsearch() { # $1=label, rest=extra --data-urlencode args
  local label="$1"; shift
  local r
  r=$(curl -s "${H[@]}" --get "$GW/api/jrx/knowledge/caselaw/search" \
      --data-urlencode 'q=bail cancellation' --data-urlencode 'limit=5' \
      --data-urlencode 'mode=fts' "$@")
  log "--- gw $label"
  printf '%s' "$r" | jq -c '{ok:.success, total:.data.total,
    lowerBound:.data.totalIsLowerBound, sort:.data.sort,
    filterSupport:(.data.filterSupport|if .==null then "ABSENT" else "present" end),
    courts:[.data.results[]?.court]}' >> "$OUT" 2>/dev/null \
    || log "RAW: $(printf '%s' "$r" | head -c 400)"
}
gwsearch 'no-courtType'
gwsearch 'courtType=sc' --data-urlencode 'courtType=sc'
gwsearch 'offset=5' --data-urlencode 'offset=5'
gwsearch 'sort=date' --data-urlencode 'sort=date'
gwsearch 'judge=chandrachud' --data-urlencode 'judge=chandrachud'
gwsearch 'yearFrom/yearTo' --data-urlencode 'yearFrom=2015' --data-urlencode 'yearTo=2016'
gwsearch 'reporter=SCC' --data-urlencode 'reporter=SCC'
gwsearch 'benchStrength=division' --data-urlencode 'benchStrength=division'
gwsearch 'dateFrom/dateTo' --data-urlencode 'dateFrom=2015-01-01' --data-urlencode 'dateTo=2015-12-31'

log ""
log "== FIX 2 POSITIVE CONTROL: NYS-direct accepts the same params =="
nyssearch() { # $1=label, rest=extra args
  local label="$1"; shift
  local r
  r=$(curl -s -H "X-API-Key: $NYS_KEY" -H "Authorization: Bearer $NYS_KEY" \
      --get "$NYS_BASE/caselaw/search" \
      --data-urlencode 'q=bail cancellation' --data-urlencode 'jurisdiction=IN' \
      --data-urlencode 'limit=5' --data-urlencode 'mode=fts' "$@")
  log "--- nys $label"
  printf '%s' "$r" | jq -c '{total:.total, lowerBound:.totalIsLowerBound, sort:.sort,
    offset:.offset, filterSupport:(.filterSupport|if .==null then "ABSENT" else "present" end),
    courts:[.results[]?.court], err:.error}' >> "$OUT" 2>/dev/null \
    || log "RAW: $(printf '%s' "$r" | head -c 400)"
}
nyssearch 'no-courtType'
nyssearch 'courtType=sc' --data-urlencode 'courtType=sc'
nyssearch 'offset=5' --data-urlencode 'offset=5'
nyssearch 'sort=date' --data-urlencode 'sort=date'
nyssearch 'judge=chandrachud' --data-urlencode 'judge=chandrachud'
nyssearch 'benchStrength=division' --data-urlencode 'benchStrength=division'
log "--- nys courtType=SC (uppercase, out of enum)"
log "http=$(curl -s -o /tmp/nys-upper.json -w '%{http_code}' -H "X-API-Key: $NYS_KEY" \
  -H "Authorization: Bearer $NYS_KEY" --get "$NYS_BASE/caselaw/search" \
  --data-urlencode 'q=bail' --data-urlencode 'jurisdiction=IN' --data-urlencode 'courtType=SC')"
log "body=$(head -c 300 /tmp/nys-upper.json)"

log ""
log "== year column vs reporter year: what does the corpus hold for the two citations =="
for cite in '[1980] 3 S.C.R. 383' '[2018] 6 S.C.R. 825'; do
  r=$(curl -s -H "X-API-Key: $NYS_KEY" -H "Authorization: Bearer $NYS_KEY" \
      --get "$NYS_BASE/caselaw/search" --data-urlencode "q=$cite" \
      --data-urlencode 'jurisdiction=IN' --data-urlencode 'limit=5' --data-urlencode 'mode=fts')
  log "--- nys fts q=$cite"
  printf '%s' "$r" | jq -c '[.results[]?|{title:.title[0:70], court:.court[0:30], year:.year, citation:.citation}]' >> "$OUT" 2>/dev/null || log "RAW: $(printf '%s' "$r"|head -c 300)"
done
# What the gateway's identity lookup actually sends today: the bare numeric token.
for q in '1980' '2018'; do
  r=$(curl -s -H "X-API-Key: $NYS_KEY" -H "Authorization: Bearer $NYS_KEY" \
      --get "$NYS_BASE/caselaw/search" --data-urlencode "q=$q" \
      --data-urlencode 'jurisdiction=IN' --data-urlencode 'limit=5' --data-urlencode 'mode=fts')
  log "--- nys fts q=$q (the token the gateway sends today)"
  printf '%s' "$r" | jq -c '[.results[]?|{title:.title[0:70], court:.court[0:30], year:.year}]' >> "$OUT" 2>/dev/null || log "RAW: $(printf '%s' "$r"|head -c 300)"
done

log ""
log "== END =="
wc -c "$OUT" >> "$OUT"
cat "$OUT"
