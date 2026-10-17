#!/bin/bash
# Confirms the 2026-08-16 orchestration batch is actually LIVE on nysdev.
# The gateway runs `tsx src/index.ts`, so the shipped artifact is TypeScript
# source under /app/src — NOT a bundle. Grepping /app/dist/index.js silently
# reports 0 for everything (there is no such file), which reads as "nothing
# deployed" and previously cost a wasted redeploy cycle. Grep /app/src.
set -uo pipefail

G=$(docker ps --filter name=gateway -q | head -1)
if [ -z "$G" ]; then echo "FATAL: no gateway container"; exit 1; fi

echo "image built : $(docker inspect --format '{{.Created}}' "$G")"
echo "container   : $(docker ps --filter name=gateway --format '{{.Status}}')"
echo "health      : $(curl -s -o /dev/null -w '%{http_code}' http://localhost:5000/health)"
echo
echo "=== batch markers present in live source ==="
for M in \
  NV-QUEEN-COLLECTIVE-PARALLEL-001 \
  NV-QUEEN-COT-COLLECTIVE-001 \
  NV-CACHE-NS-FORGERY-001 \
  NV-NYS-DETERMINISTIC-WIRE-001 \
  NV-NYS-LLMREQUIRED-001 \
  NV-MEM-TENANT-001 \
  NV-MEM-BUDGET-001 \
  NV-CASCADE-DRIFT-001 \
  NV-METER-WASTE-001 \
  NV-QUEEN-STAGE-ATTRIBUTION-001 \
  NV-MEM-FANIN-BOUND-001 \
  NV-TOKEN-BUDGET-001
do
  N=$(docker exec "$G" sh -c "grep -rl '$M' /app/src 2>/dev/null | wc -l" 2>/dev/null | tr -d '\r ')
  if [ "${N:-0}" -gt 0 ]; then echo "  LIVE    $M  (${N} file(s))"; else echo "  MISSING $M"; fi
done

echo
echo "=== structural spot checks ==="
# Dead Bedrock Haiku rung must be gone from the cascade (allow-list copy is fine).
H=$(docker exec "$G" sh -c "grep -c 'us.anthropic.claude-haiku' /app/src/config/jrx-llm-routing-policy.ts 2>/dev/null" 2>/dev/null | tr -d '\r ')
[ "${H:-1}" = "0" ] && echo "  OK   dead us.haiku rung removed from routing policy" \
                    || echo "  WARN us.haiku still referenced in routing policy (${H})"

# Swarm lanes must dispatch concurrently, not serially.
C=$(docker exec "$G" sh -c "grep -c 'runWithConcurrency' /app/src/orchestration/jrx-queen-orchestrator.ts 2>/dev/null" 2>/dev/null | tr -d '\r ')
[ "${C:-0}" -gt 0 ] && echo "  OK   swarm uses runWithConcurrency (${C} site(s))" \
                    || echo "  WARN swarm still serial"

# New modules from this batch must be on disk.
for F in \
  src/services/jrx-nys-deterministic-answer.ts \
  src/services/memory/jrx-memory-injection-budget.ts \
  src/config/jrx-prompt-budget.ts \
  src/services/intelligent-router/jrx-llm-retry-policy.ts \
  src/services/intelligent-router/jrx-provider-breaker.ts \
  src/services/intelligent-router/jrx-cascade-validator.ts \
  src/services/jrx-lm-cache-key.ts
do
  docker exec "$G" sh -c "test -f /app/$F" 2>/dev/null \
    && echo "  OK   $F" || echo "  MISSING $F"
done
