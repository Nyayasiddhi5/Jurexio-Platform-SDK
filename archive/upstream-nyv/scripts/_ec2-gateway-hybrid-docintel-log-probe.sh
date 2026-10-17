#!/usr/bin/env bash
# NV-NSP-AI-AUDIT — gateway log patterns last 24h (no secrets)
set -uo pipefail
echo "=== GATEWAY LOG PROBE $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
GW=$(docker ps --format '{{.Names}}' 2>/dev/null | grep -E 'gateway|nyv-api' | head -1)
if [ -z "$GW" ]; then
  echo "NO_GATEWAY_CONTAINER"
  docker ps --format '{{.Names}}' 2>/dev/null | head -10
  exit 0
fi
echo "CONTAINER=$GW"
SINCE="${1:-24h}"
echo "--- caselaw hybrid / fts_fallback / timeout (last $SINCE) ---"
docker logs "$GW" --since "$SINCE" 2>&1 | grep -iE 'fts_fallback|hybridMs|caselaw.*timeout|reason=timeout|searchMode' | tail -15
echo "--- count hybrid timeout-ish ---"
docker logs "$GW" --since "$SINCE" 2>&1 | grep -cE 'fts_fallback|reason=timeout' || true
echo "--- documents/embeddings 400 (last $SINCE) ---"
docker logs "$GW" --since "$SINCE" 2>&1 | grep -E 'documents/embeddings.*400|/embeddings.* 400|embeddings.*status.*400' | tail -10
echo "--- DocIntel / OpenAI embed errors (redacted) ---"
docker logs "$GW" --since "$SINCE" 2>&1 | grep -iE 'docintel|OpenAI.*embed|embedding.*error' | grep -vE 'password|api[_-]?key|Bearer ' | tail -10
echo "--- count embeddings 400 ---"
docker logs "$GW" --since "$SINCE" 2>&1 | grep -cE 'embeddings.*(400|validation)' || true
echo "=== PROBE DONE ==="
