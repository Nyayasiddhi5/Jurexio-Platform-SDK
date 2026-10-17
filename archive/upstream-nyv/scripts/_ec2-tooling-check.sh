#!/usr/bin/env bash
set -uo pipefail
echo "=== host tooling ==="
for t in node nodejs python3 jq curl; do
  p="$(command -v "$t" 2>/dev/null || true)"
  echo "  $t -> ${p:-ABSENT}"
done
echo
echo "=== positive control: parse a KNOWN json with each available parser ==="
printf '{"data":{"results":[{"title":"X","courtType":"sc"}]}}' > /tmp/ctl.json
if command -v python3 >/dev/null 2>&1; then
  echo -n "  python3 says results="; python3 -c 'import json,sys;d=json.load(open("/tmp/ctl.json"));print(len(d.get("data",{}).get("results",[])))'
fi
if command -v jq >/dev/null 2>&1; then
  echo -n "  jq says results="; jq '.data.results|length' /tmp/ctl.json
fi
echo "  (either MUST print 1 — if not, the parser is the problem)"
echo
echo "=== raw shape of one real search response (first 900 chars) ==="
ENVF="/opt/nyayavigya/secrets/.env.production"
KEY="$( { grep -E '^NYV_SDK_KEY_NSP=' "$ENVF" || true; } | head -1 | sed -E 's/^NYV_SDK_KEY_NSP=//' | tr -d '"'"'"'\r' )"
echo "key_len=${#KEY}"
code=$(curl -s -o /tmp/r.json -w '%{http_code}' --max-time 60 \
  -H "x-api-key: $KEY" -H "x-nyv-platform: nsp" -H "x-nyv-consent: granted" \
  "http://localhost:5000/api/jrx/knowledge/caselaw/search?q=Sushila%20Aggarwal&jurisdiction=IN&mode=fts&limit=3")
echo "http=$code bytes=$(wc -c < /tmp/r.json)"
head -c 900 /tmp/r.json; echo
echo DONE
