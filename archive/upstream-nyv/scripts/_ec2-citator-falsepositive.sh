#!/usr/bin/env bash
# NSP ask 3 — the false-positive path, isolated.
#
# HYPOTHESIS: `method: 'all-tokens-in-title'` can match a reporter citation's
# NUMERIC tokens against unrelated numbers in an unrelated title. `[1980] 3
# S.C.R. 383` resolved to "The Shalimar Works (1980) Limited ..." (HC Telangana,
# 2010) with matched:true confidence 0.6 — the token "1980" appears in that
# company's name. If so, a fuzzy hit IS being silently substituted for an exact
# citation, which is precisely what NSP's ask 3 asks us to prevent.
#
# FALSIFIER: the same probe returning matched:false, or resolving to Sibbia.
set -uo pipefail
ENVF="/opt/nyayavigya/secrets/.env.production"
KEY="$( { grep -E '^NYV_SDK_KEY_NSP=' "$ENVF" || true; } | head -1 | sed -E 's/^NYV_SDK_KEY_NSP=//' | tr -d '"'"'"'\r' )"
echo "key_len=${#KEY}"; [ -n "$KEY" ] || exit 1
GW="http://localhost:5000"
get() { local p="$1" code i; for i in 1 2 3 4 5; do
  code=$(curl -s -o /tmp/t.json -w '%{http_code}' --max-time 90 \
    -H "x-api-key: $KEY" -H "x-nyv-platform: nsp" -H "x-nyv-consent: granted" "$GW$p")
  [ "$code" = "503" ] || { echo "$code"; return; }; sleep 6; done; echo "$code"; }

echo
echo "=== A. Reporter citations, default mode: is the match the RIGHT case? ==="
# [1980] 3 S.C.R. 383 = Gurbaksh Singh Sibbia. [2020] 2 S.C.R. 1 = Sushila Aggarwal.
for c in "%5B1980%5D%203%20S.C.R.%20383" "%5B2020%5D%202%20S.C.R.%201" "%5B2018%5D%206%20S.C.R.%20825"; do
  code=$(get "/api/jrx/knowledge/caselaw/treatment?citation=$c")
  echo "--- citation=$c http=$code"
  jq -r '(.data // .) | "    matched=\(.authority.resolution.matched // "?") conf=\(.authority.resolution.confidence // "?") method=\(.authority.resolution.method // "?")\n    RESOLVED TO: \(.authority.title // "null")  [\(.authority.court // "?") \(.authority.year // "?")]"' /tmp/t.json
done

echo
echo "=== B. The full coverage / limitations / unknownReason envelope (ask 2 material) ==="
code=$(get "/api/jrx/knowledge/caselaw/treatment?citation=Kesavananda%20Bharati%20v.%20State%20of%20Kerala")
echo "  http=$code"
jq -r '(.data // .) | "    goodLaw       = \(.goodLaw)\n    unknownReason = \(.unknownReason // "null")\n    coverage      = \(.coverage // "null")\n    limitations   = \(.limitations // "null")\n    direction     = \(.direction // "null")\n    treatments    = \(.treatments // "null")"' /tmp/t.json

echo
echo "=== C. Positive control: a nonsense string MUST be unresolved in both modes ==="
for m in "" "&exact=true"; do
  code=$(get "/api/jrx/knowledge/caselaw/treatment?citation=Zzzq%20Nonexistent%20Xyllq%20v%20Qqqq$m")
  echo -n "  exact=${m:-false} http=$code  "
  jq -r '(.data // .) | "matched=\(.authority.resolution.matched) method=\(.authority.resolution.method)"' /tmp/t.json
done
echo DONE
