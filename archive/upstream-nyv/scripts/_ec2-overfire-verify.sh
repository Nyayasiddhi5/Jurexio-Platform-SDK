#!/usr/bin/env bash
# Verify which markers are live in the running gateway source tree.
# The gateway runs `tsx src/index.ts`, so /app/src is the truth, not /app/dist.
echo "container: $(docker ps --format '{{.Names}} {{.Status}}' | head -2 | tr '\n' ' ')"
GW=$(docker ps -q --filter name=gateway | head -1)
[ -n "$GW" ] && echo "created:   $(docker inspect -f '{{.Created}}' "$GW")"
echo "--- markers in /app/src (expect >0 for LIVE) ---"
for pair in \
  "NV-DETERMINISTIC-OVERFIRE-001:/app/src/services/jrx-statute-qa-grounding.ts" \
  "AUTHORITY_ASK_RE:/app/src/services/jrx-statute-qa-grounding.ts" \
  "NV-QUEEN-EARNED-001:/app/src/orchestration/jrx-queen-admission.ts" \
  "heap_size_limit:/app/src/services/jrx-memory-manager.ts" \
  "maybeRunQueenCoT:/app/src/orchestration/jrx-queen-orchestrator.ts"
do
  m="${pair%%:*}"; f="${pair#*:}"
  n=$(docker exec "$GW" grep -c "$m" "$f" 2>/dev/null || echo 0)
  printf "  %-34s %-58s %s\n" "$m" "$f" "$n"
done
echo "--- canary (known-old marker; 0 here means the grep itself is wrong) ---"
