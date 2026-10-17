#!/usr/bin/env bash
# NV-AUTHORITY-SALIENCE-001 — measure the corpus claims and the query spread
# against the LIVE gateway from the EC2 host.
#
# `node` is ABSENT on this host (measured) — parsing is jq, which was proven on a
# known-good fixture before any real call. NYS answers 503 "corpus is busy" while
# embed workers run, so every probe retries; a 503 after all retries is reported
# as BUSY, never as "0 results", because those two mean opposite things.
#
# Read-only: no writes, no docker compose, no restart, no redeploy.
set -uo pipefail

ENVF="/opt/nyayavigya/secrets/.env.production"
KEY="$( { grep -E '^NYV_SDK_KEY_NSP=' "$ENVF" || true; } | head -1 | sed -E 's/^NYV_SDK_KEY_NSP=//' | tr -d '"'"'"'\r' )"
echo "key_len=${#KEY}  (0 => probe broken, not platform)"
[ -n "$KEY" ] || { echo ABORT; exit 1; }

echo -n "PARSER CONTROL: "
printf '{"data":{"results":[{"title":"X"}]}}' > /tmp/ctl.json
ctl=$(jq '.data.results|length' /tmp/ctl.json)
echo "jq counts $ctl on a known fixture (MUST be 1)"
[ "$ctl" = "1" ] || { echo "ABORT: parser broken"; exit 1; }

GW="http://localhost:5000"
get() { # get <path> -> writes /tmp/out.json, echoes http code, retries 503
  local path="$1" code i
  for i in 1 2 3 4 5; do
    code=$(curl -s -o /tmp/out.json -w '%{http_code}' --max-time 90 \
      -H "x-api-key: $KEY" -H "x-nyv-platform: nsp" -H "x-nyv-consent: granted" \
      "$GW$path")
    [ "$code" = "503" ] || { echo "$code"; return; }
    sleep 6
  done
  echo "$code"
}

probe() { # probe <label> <path>
  local label="$1" path="$2" code n
  code=$(get "$path")
  if [ "$code" = "503" ]; then
    echo "--- $label"; echo "    http=503 BUSY (corpus ingesting — NOT a zero-result finding)"; return
  fi
  n=$(jq -r '((.data.results // .results) // []) | length' /tmp/out.json 2>/dev/null || echo parse-error)
  echo "--- $label"
  echo "    http=$code results=$n"
  jq -r '((.data.results // .results) // [])[:6] | to_entries[] | "    [\(.key)] tier=\(.value.courtType // .value.court_type // "?") year=\(.value.year // "?") cit=\(if .value.citation then "Y" else "n" end) :: \(.value.title // "" | .[0:70])"' /tmp/out.json 2>/dev/null
}

echo
echo "======== POSITIVE CONTROL: landmarks ARE retrievable by name (mode=fts) ========"
probe "Sushila Aggarwal by name"       "/api/jrx/knowledge/caselaw/search?q=Sushila%20Aggarwal&jurisdiction=IN&mode=fts&limit=3"
probe "Gurbaksh Singh Sibbia by name"  "/api/jrx/knowledge/caselaw/search?q=Gurbaksh%20Singh%20Sibbia&jurisdiction=IN&mode=fts&limit=3"

echo
echo "======== THE DEFECT: full reference query (AND over a metadata-only index) ========"
probe "FULL reference query"           "/api/jrx/knowledge/caselaw/search?q=Leading%20Supreme%20Court%20authorities%20on%20anticipatory%20bail%20for%20economic%20offences&jurisdiction=IN&mode=fts&limit=10"

echo
echo "======== THE FIX: the stripped contentQuery, with and without the tier filter ========"
probe "STRIPPED, no tier filter"       "/api/jrx/knowledge/caselaw/search?q=anticipatory%20bail%20economic%20offences&jurisdiction=IN&mode=fts&limit=10"
probe "STRIPPED + courtType=sc"        "/api/jrx/knowledge/caselaw/search?q=anticipatory%20bail%20economic%20offences&jurisdiction=IN&mode=fts&courtType=sc&limit=10"
probe "2 terms + courtType=sc"         "/api/jrx/knowledge/caselaw/search?q=anticipatory%20bail&jurisdiction=IN&mode=fts&courtType=sc&limit=10"

echo
echo "======== SPREAD: the filter is a REQUEST, not an SC hierarchy ========"
probe "HC state procedure (hc)"        "/api/jrx/knowledge/caselaw/search?q=Kerala%20condonation%20delay&jurisdiction=IN&mode=fts&courtType=hc&limit=5"
probe "SC silent — local body (sc)"    "/api/jrx/knowledge/caselaw/search?q=BBMP%20khata%20transfer&jurisdiction=IN&mode=fts&courtType=sc&limit=5"

echo
echo "======== NSP: treatment language structurally cannot be in a metadata index ========"
probe "q=stands overruled (sc)"        "/api/jrx/knowledge/caselaw/search?q=stands%20overruled&jurisdiction=IN&mode=fts&courtType=sc&limit=5"
probe "q=overruled (sc)"               "/api/jrx/knowledge/caselaw/search?q=overruled&jurisdiction=IN&mode=fts&courtType=sc&limit=5"

echo
echo "======== NSP ask 3: treatment endpoint resolution (verify, do not rebuild) ========"
for c in "Kesavananda%20Bharati%20v.%20State%20of%20Kerala" "Sushila%20Aggarwal%20v.%20State%20(NCT%20of%20Delhi)" "Totally%20Fictional%20Case%20v%20Nobody"; do
  code=$(get "/api/jrx/knowledge/caselaw/treatment?citation=$c&exact=true")
  echo "--- treatment exact=true citation=$c"
  echo "    http=$code"
  [ "$code" = "503" ] && { echo "    BUSY"; continue; }
  jq -r '(.data // .) | "    resolution   = \(.authority.resolution // "ABSENT")\n    title/court/year = \(.authority.title // "null") / \(.authority.court // "null") / \(.authority.year // "null")\n    treatments   = \(if .treatments == null then "WITHHELD" else (.treatments|length|tostring) end)\n    goodLaw      = \(.goodLaw // "null")\n    passagesScanned = \(.passagesScanned // "null")   coveragePct = \(.corpusCoveragePct // "null")"' /tmp/out.json 2>/dev/null
done
echo DONE
