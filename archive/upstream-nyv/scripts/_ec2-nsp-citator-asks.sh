#!/usr/bin/env bash
# NSP asks 1–3 — verify against the LIVE gateway before building anything.
#
# Ask 3 is claimed already-delivered. The claim names `?citation=Kesavananda
# Bharati v. State of Kerala` resolving to SC 1973 with matched:true. An earlier
# probe of mine sent `&exact=true` and got `unresolved` — `exact=true` demands a
# reporter CITATION and that string is a case NAME, so both can be true. This
# probe runs BOTH modes so the difference is measured, not argued.
set -uo pipefail
ENVF="/opt/nyayavigya/secrets/.env.production"
KEY="$( { grep -E '^NYV_SDK_KEY_NSP=' "$ENVF" || true; } | head -1 | sed -E 's/^NYV_SDK_KEY_NSP=//' | tr -d '"'"'"'\r' )"
echo "key_len=${#KEY}"; [ -n "$KEY" ] || exit 1
GW="http://localhost:5000"

get() { local p="$1" code i; for i in 1 2 3 4 5; do
  code=$(curl -s -o /tmp/t.json -w '%{http_code}' --max-time 90 \
    -H "x-api-key: $KEY" -H "x-nyv-platform: nsp" -H "x-nyv-consent: granted" "$GW$p")
  [ "$code" = "503" ] || { echo "$code"; return; }; sleep 6; done; echo "$code"; }

show() { jq -r '(.data // .) | "    resolution      = \(.authority.resolution // "ABSENT")\n    title           = \(.authority.title // "null")\n    court/year      = \(.authority.court // "null") / \(.authority.year // "null")\n    treatments      = \(if .treatments == null then "WITHHELD (null)" else (.treatments|length|tostring) end)\n    goodLaw         = \(.goodLaw // "null")\n    passagesScanned = \(.passagesScanned // "null")   coveragePct = \(.corpusCoveragePct // "null")"' /tmp/t.json 2>/dev/null || echo "    parse-error"; }

echo
echo "############ ASK 3: exact-citation resolution / trustworthy exactMatch ############"
for c in "Kesavananda%20Bharati%20v.%20State%20of%20Kerala" \
         "Sushila%20Aggarwal%20%26%20ORS.%20versus%20STATE%20(NCT%20OF%20DELHI)%20%26%20ANR." \
         "%5B1980%5D%203%20S.C.R.%20383" \
         "Totally%20Fictional%20Case%20v%20Nobody%20%5B2099%5D%201%20SCC%201"; do
  for mode in "" "&exact=true"; do
    code=$(get "/api/jrx/knowledge/caselaw/treatment?citation=$c$mode")
    echo "--- citation=$c  exact=${mode:-false}  http=$code"
    [ "$code" = "503" ] && { echo "    BUSY"; continue; }
    show
  done
done

echo
echo "############ ASK 1: citation graph prerequisites ############"
echo "--- do the graph tables hold anything? (expect 0 rows, no backfill run) ---"
for p in "/api/jrx/knowledge/graph/stats" "/api/jrx/knowledge/caselaw/stats"; do
  code=$(get "$p"); echo "  GET $p http=$code"
  [ "$code" = "200" ] && head -c 600 /tmp/t.json && echo
done

echo
echo "############ ASK 2: what does the endpoint expose about scan completeness? ############"
code=$(get "/api/jrx/knowledge/caselaw/treatment?citation=Sushila%20Aggarwal")
echo "  http=$code — full envelope keys:"
[ "$code" = "200" ] && jq -r '(.data // .) | keys | "    " + join(", ")' /tmp/t.json
[ "$code" = "200" ] && jq -r '(.data // .) | "    goodLaw=\(.goodLaw // "null")  passagesScanned=\(.passagesScanned // "null")  corpusCoveragePct=\(.corpusCoveragePct // "null")  scanned=\(.scanned // "null")"' /tmp/t.json
echo DONE
