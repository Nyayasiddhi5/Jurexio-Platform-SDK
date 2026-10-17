#!/usr/bin/env bash
# NV-AUTHORITY-SALIENCE-001 — probe NYS DIRECTLY.
#
# WHY NOT THROUGH THE GATEWAY: `/api/jrx/knowledge/caselaw/search` builds its
# upstream query as { q, jurisdiction, year, court, limit } and does NOT forward
# `courtType`. So a gateway probe can never exercise the tier filter, and an
# earlier run of this measurement wrongly read "identical results with and
# without courtType=sc" as the filter being ignored. It was the instrument.
# `retrieveTierScopedAuthorities` calls NYS directly, which is what this mirrors.
#
# Read-only. No writes, no compose, no restarts. Prints no secret values.
set -uo pipefail

ENVF="/opt/nyayavigya/secrets/.env.production"
BASE="$( { grep -E '^NYS_KNOWLEDGE_BASE_URL=' "$ENVF" || true; } | head -1 | sed -E 's/^NYS_KNOWLEDGE_BASE_URL=//' | tr -d '"'"'"'\r' )"
NKEY="$( { grep -E '^NYS_KNOWLEDGE_API_KEY=' "$ENVF" || true; } | head -1 | sed -E 's/^NYS_KNOWLEDGE_API_KEY=//' | tr -d '"'"'"'\r' )"
echo "nys_base_host=$(printf '%s' "$BASE" | sed -E 's#https?://##; s#/.*##')  nys_key_len=${#NKEY}"
[ -n "$BASE" ] && [ -n "$NKEY" ] || { echo "ABORT: base or key missing (probe broken)"; exit 1; }

echo -n "PARSER CONTROL: "
printf '{"results":[{"title":"X"}]}' > /tmp/c.json
c=$(jq '.results|length' /tmp/c.json); echo "jq=$c (MUST be 1)"
[ "$c" = "1" ] || { echo ABORT; exit 1; }

get() { local path="$1" code i
  for i in 1 2 3 4 5; do
    # NYS authGuard wants BOTH headers, exactly as nv-nys-knowledge-client sends
    # them (X-API-Key + Authorization: Bearer). An earlier run sent only
    # x-api-key and got a flat 401 on every probe — that was the instrument.
    code=$(curl -s -o /tmp/o.json -w '%{http_code}' --max-time 90 \
      -H "X-API-Key: $NKEY" -H "Authorization: Bearer $NKEY" "$BASE$path")
    [ "$code" = "503" ] || { echo "$code"; return; }
    sleep 6
  done
  echo "$code"; }

probe() { local label="$1" path="$2" code n
  code=$(get "$path")
  echo "--- $label"
  if [ "$code" = "503" ]; then echo "    http=503 BUSY (ingesting — NOT a zero-result finding)"; return; fi
  if [ "$code" != "200" ]; then echo "    http=$code body=$(head -c 200 /tmp/o.json)"; return; fi
  n=$(jq -r '((.results // .data.results) // []) | length' /tmp/o.json)
  # Tier composition is the measurement that matters: how many SC vs HC.
  local sc hc
  sc=$(jq -r '[((.results // .data.results) // [])[] | select((.courtType // .court_type)=="sc")] | length' /tmp/o.json)
  hc=$(jq -r '[((.results // .data.results) // [])[] | select((.courtType // .court_type)=="hc")] | length' /tmp/o.json)
  echo "    http=200 results=$n   SC=$sc  HC=$hc"
  jq -r '((.results // .data.results) // [])[:5] | to_entries[] | "    [\(.key)] tier=\(.value.courtType // .value.court_type // "?") year=\(.value.year // "?") :: \(.value.title // "" | .[0:66])"' /tmp/o.json
}

echo
echo "=========== A. Does courtType=sc actually filter? (the tier leg's premise) ==========="
probe "content-only, NO courtType"       "/caselaw/search?q=anticipatory%20bail%20economic%20offences&jurisdiction=IN&mode=fts&limit=10"
probe "content-only, courtType=sc"       "/caselaw/search?q=anticipatory%20bail%20economic%20offences&jurisdiction=IN&mode=fts&courtType=sc&limit=10"
probe "2-term, courtType=sc"             "/caselaw/search?q=anticipatory%20bail&jurisdiction=IN&mode=fts&courtType=sc&limit=10"
probe "1-term 'bail', courtType=sc"      "/caselaw/search?q=bail&jurisdiction=IN&mode=fts&courtType=sc&limit=10"
probe "FULL reference q, courtType=sc"   "/caselaw/search?q=Leading%20Supreme%20Court%20authorities%20on%20anticipatory%20bail%20for%20economic%20offences&jurisdiction=IN&mode=fts&courtType=sc&limit=10"

echo
echo "=========== B. Can the landmarks be reached WITHOUT naming them? ==========="
probe "anticipatory bail + sc"           "/caselaw/search?q=anticipatory%20bail&jurisdiction=IN&mode=fts&courtType=sc&limit=20"
probe "by name (positive control)"       "/caselaw/search?q=Sushila%20Aggarwal&jurisdiction=IN&mode=fts&limit=3"

echo
echo "=========== C. HC request must promote HC, not SC ==========="
probe "Kerala condonation delay + hc"    "/caselaw/search?q=Kerala%20condonation%20delay&jurisdiction=IN&mode=fts&courtType=hc&limit=5"

echo
echo "=========== D. full_text NULL => treatment language unsearchable ==========="
probe "stands overruled + sc"            "/caselaw/search?q=stands%20overruled&jurisdiction=IN&mode=fts&courtType=sc&limit=5"
echo DONE
