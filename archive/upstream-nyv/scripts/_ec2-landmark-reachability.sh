#!/usr/bin/env bash
# Why the landmarks cannot surface from a CONTENT query, stated falsifiably.
#
# Hypothesis: `search_tsv` covers metadata only, and NEITHER landmark's indexed
# metadata contains the words "anticipatory" or "bail" — their titles are just
# party names. If true, NO content query can reach them via FTS at any tier
# filter, and tier salience cannot fix that. Falsifier: a query containing
# "anticipatory bail" that returns either landmark.
set -uo pipefail
ENVF="/opt/nyayavigya/secrets/.env.production"
BASE="$( { grep -E '^NYS_KNOWLEDGE_BASE_URL=' "$ENVF" || true; } | head -1 | sed -E 's/^NYS_KNOWLEDGE_BASE_URL=//' | tr -d '"'"'"'\r' )"
NKEY="$( { grep -E '^NYS_KNOWLEDGE_API_KEY=' "$ENVF" || true; } | head -1 | sed -E 's/^NYS_KNOWLEDGE_API_KEY=//' | tr -d '"'"'"'\r' )"
echo "nys_key_len=${#NKEY}"; [ -n "$NKEY" ] || exit 1

get() { local p="$1" code i; for i in 1 2 3 4 5; do
  code=$(curl -s -o /tmp/o.json -w '%{http_code}' --max-time 90 \
    -H "X-API-Key: $NKEY" -H "Authorization: Bearer $NKEY" "$BASE$p")
  [ "$code" = "503" ] || { echo "$code"; return; }; sleep 6; done; echo "$code"; }

echo
echo "=== 1. The landmark rows as the index actually holds them ==="
for q in "Sushila%20Aggarwal" "Gurbaksh%20Singh%20Sibbia"; do
  c=$(get "/caselaw/search?q=$q&jurisdiction=IN&mode=fts&courtType=sc&limit=2")
  echo "--- q=$q http=$c"
  jq -r '((.results // .data.results) // [])[] | "    title       : \(.title // "null")\n    citation    : \(.citation // "null")\n    year/court  : \(.year // "?") \(.courtType // .court_type // "?")\n    description : \(if (.description // "") == "" then "NULL/EMPTY" else ((.description|tostring)[0:110]) end)\n    snippet     : \(if (.snippet // "") == "" then "NULL/EMPTY" else ((.snippet|tostring)[0:110]) end)"' /tmp/o.json
done

echo
echo "=== 2. Does the word 'bail' appear in EITHER landmark's indexed metadata? ==="
echo "    (AND-semantics: adding a term that is not in the row removes the row)"
for q in "Sushila%20Aggarwal%20bail" "Sushila%20Aggarwal%20anticipatory" "Gurbaksh%20Sibbia%20bail" "Gurbaksh%20Sibbia%20anticipatory"; do
  c=$(get "/caselaw/search?q=$q&jurisdiction=IN&mode=fts&courtType=sc&limit=3")
  n=$(jq -r '((.results // .data.results) // [])|length' /tmp/o.json 2>/dev/null || echo ERR)
  echo "    q=$q  http=$c results=$n"
done

echo
echo "=== 3. CONTROL: the same names WITHOUT the extra term must still return rows ==="
for q in "Sushila%20Aggarwal" "Gurbaksh%20Sibbia"; do
  c=$(get "/caselaw/search?q=$q&jurisdiction=IN&mode=fts&courtType=sc&limit=3")
  n=$(jq -r '((.results // .data.results) // [])|length' /tmp/o.json)
  echo "    q=$q  http=$c results=$n   (MUST be >0, else this probe proves nothing)"
done

echo
echo "=== 4. How restrictive is the stripped contentQuery? (term-by-term, courtType=sc) ==="
for q in "bail" "anticipatory%20bail" "anticipatory%20bail%20economic" "anticipatory%20bail%20economic%20offences"; do
  c=$(get "/caselaw/search?q=$q&jurisdiction=IN&mode=fts&courtType=sc&limit=20")
  n=$(jq -r '((.results // .data.results) // [])|length' /tmp/o.json)
  echo "    q='$q'  http=$c results=$n"
done
echo DONE
