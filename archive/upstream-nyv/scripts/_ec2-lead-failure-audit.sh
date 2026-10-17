#!/usr/bin/env bash
# NV-LEAD-FAILURE-AUDIT-001 — the cascade lead is Opus 5 but served model is
# Gemini Pro. Prove whether we pay a failed Bedrock attempt on every request.
# No `set -e`: non-matching greps are an expected outcome, not a failure.
set -uo pipefail
CID=$(docker ps --filter 'name=gateway' --format '{{.ID}}' | head -1)
[ -z "$CID" ] && { echo "gateway container not found"; exit 0; }
LOG=/tmp/gw.log
docker logs --tail 8000 "$CID" >"$LOG" 2>&1

echo "=== explicit Bedrock/Anthropic error signatures ==="
grep -oE '(AccessDeniedException|ValidationException|ThrottlingException|ModelNotReadyException|ResourceNotFoundException|ServiceUnavailableException|ExpiredTokenException|UnrecognizedClientException|on-demand throughput|inference profile|temperature)' "$LOG" \
  | sort | uniq -c | sort -rn || echo "(none)"

echo
echo "=== cascade / fallback / hedge phrases ==="
grep -oiE '(cascade[a-z_ -]{0,20}|fallback[a-z_ -]{0,20}|hedge[a-z_ -]{0,20}|failover[a-z_ -]{0,20}|skipping[a-z_ -]{0,20})' "$LOG" \
  | sed -E 's/ +$//' | sort | uniq -c | sort -rn | head -25 || echo "(none)"

echo
echo "=== lines mentioning opus (first 12) ==="
grep -i 'opus' "$LOG" | head -12 | cut -c1-220 || echo "(none)"

echo
echo "=== does Opus 5 answer right now? direct Bedrock probe ==="
for M in us.anthropic.claude-opus-5 global.anthropic.claude-sonnet-5; do
  printf '%-42s ' "$M"
  BODY=$(printf '{"anthropic_version":"bedrock-2023-05-31","max_tokens":64,"messages":[{"role":"user","content":"Reply OK"}]}')
  START=$(date +%s%N)
  if OUT=$(aws bedrock-runtime invoke-model --region us-east-1 --model-id "$M" \
        --content-type application/json --accept application/json \
        --body "$BODY" --cli-binary-format raw-in-base64-out /tmp/bd.json 2>&1); then
    END=$(date +%s%N)
    echo "OK t=$(( (END-START)/1000000 ))ms $(head -c 100 /tmp/bd.json | tr -d '\n')"
  else
    echo "FAIL $(echo "$OUT" | tr '\n' ' ' | cut -c1-180)"
  fi
done

echo
echo "=== embedding vs request volume in same window ==="
echo "gemini-embedding-2 mentions: $(grep -c 'gemini-embedding-2' "$LOG" || echo 0)"
echo "orchestrate requests:       $(grep -cE 'POST /api/jrx/orchestrate' "$LOG" || echo 0)"
echo "retrieve calls:             $(grep -cE '/knowledge/retrieve' "$LOG" || echo 0)"
