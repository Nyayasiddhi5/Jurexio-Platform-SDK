#!/usr/bin/env bash
# NV-CASCADE-CONFIG-AUDIT-001 — read live LLM routing flags (names + booleans
# and model IDs only; never secret values).
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"

echo "=== live LLM routing / cascade flags (values shown only for non-secrets) ==="
grep -E '^(NYV_LLM_|NYV_MODEL_|NYV_ROUTER_|NYV_CASCADE_|NYV_QUEEN_|NYV_RAG_|NYV_MEMORY_|NYV_CACHE_|NYV_LM_CACHE|NYV_HEDGE|NYV_TOKEN_|NYV_PROMPT_|NYV_AUTO_RAG|NYV_SELF_RAG|NYV_GRAPH)' "$CANON" 2>/dev/null \
  | sed -E 's/(KEY|SECRET|TOKEN|PASSWORD|PASS|CREDENTIAL)([A-Z_]*)=.*/\1\2=<redacted>/' \
  | sort || echo "(none matched)"

echo
echo "=== what the running container actually sees ==="
CID=$(docker ps --filter 'name=gateway' --format '{{.ID}}' | head -1)
if [ -n "$CID" ]; then
  docker exec "$CID" env 2>/dev/null \
    | grep -E '^(NYV_LLM_|NYV_MODEL_|NYV_ROUTER_|NYV_CASCADE_|NYV_QUEEN_|NYV_RAG_|NYV_MEMORY_|NYV_CACHE_|NYV_LM_CACHE|NYV_HEDGE|NYV_TOKEN_|NYV_PROMPT_|NYV_AUTO_RAG|NYV_SELF_RAG|NYV_GRAPH)' \
    | sed -E 's/(KEY|SECRET|TOKEN|PASSWORD|PASS|CREDENTIAL)([A-Z_]*)=.*/\1\2=<redacted>/' \
    | sort
else
  echo "gateway container not found"
fi

echo
echo "=== model actually chosen over the last 200 orchestrate log lines ==="
if [ -n "$CID" ]; then
  docker logs --tail 4000 "$CID" 2>&1 \
    | grep -oE '"model":"[^"]+"|model=[a-zA-Z0-9._:-]+' \
    | sed 's/"model":"//; s/"$//; s/model=//' \
    | sort | uniq -c | sort -rn | head -20
fi
