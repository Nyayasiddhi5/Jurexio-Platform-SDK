#!/usr/bin/env bash
# NV-MODEL-BENCH-001 — evidence for the selection algorithm. Measures latency and
# output on a REALISTIC legal task (not a one-liner), so speed/quality scores in
# the catalog are grounded in this account's actual behaviour rather than vendor
# marketing. Every model that the policy may rank MUST appear here.
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
GK=$(grep -E '^(GEMINI_API_KEY|GOOGLE_API_KEY|GOOGLE_AI_API_KEY)=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')

Q='Under Indian law, explain the interplay between anticipatory bail under BNSS section 482 and an attachment order under PMLA section 5. Identify the correct forum, the limitation window, and the sequence in which the remedies should be pursued. Cite the provisions you rely on.'

echo "=== realistic legal task: latency + output size (2 runs each, best of 2) ==="
printf '   %-38s %8s %8s %8s\n' MODEL HTTP SECS CHARS
for M in \
  gemini-3.7-flash \
  gemini-3.6-flash \
  gemini-3.5-flash \
  gemini-3-flash-preview \
  gemini-3.1-pro-preview \
  gemini-3.1-flash-lite \
  gemini-flash-latest \
  gemini-pro-latest
do
  BEST=99999; BH=""; BC=""
  for _ in 1 2; do
    S=$(date +%s.%N)
    H=$(curl -sS -m 180 -o /tmp/b.json -w '%{http_code}' \
      -X POST -H 'Content-Type: application/json' \
      -d "{\"contents\":[{\"parts\":[{\"text\":\"${Q}\"}]}],\"generationConfig\":{\"maxOutputTokens\":2048}}" \
      "https://generativelanguage.googleapis.com/v1beta/models/${M}:generateContent?key=${GK}")
    E=$(date +%s.%N)
    D=$(python3 -c "print(f'{${E}-${S}:.2f}')")
    C=$(python3 -c "
import json
try:
    d=json.load(open('/tmp/b.json'))
    print(len(d['candidates'][0]['content']['parts'][0]['text']))
except Exception:
    try:
        print('ERR:'+str(json.load(open('/tmp/b.json')).get('error',{}).get('status','')))
    except Exception: print('ERR')
" 2>/dev/null)
    if python3 -c "import sys; sys.exit(0 if ${D} < ${BEST} else 1)"; then BEST=$D; BH=$H; BC=$C; fi
  done
  printf '   %-38s %8s %8s %8s\n' "$M" "$BH" "$BEST" "$BC"
done
