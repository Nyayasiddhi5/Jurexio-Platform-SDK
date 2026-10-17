#!/bin/bash
# Why is swarm wall time still ~366s after parallelising the collective path?
# Prints per-node dispatch/finish timestamps so serial-vs-parallel is visible
# directly, plus the prompt size actually sent per node (Phase 3 should have cut
# it, but the probe reported 89,610 prompt tokens across 7 completions ≈ 12.8k
# each, which is nowhere near the 1,048-token micro path).
set -uo pipefail
G=$(docker ps --filter name=gateway -q | head -1)

echo "=== node dispatch timeline (last 12 min) ==="
docker logs "$G" --since 12m 2>&1 \
  | grep -Eo '"timestamp":"[^"]+"[^}]*"(message|model)":"[^"]*"' \
  | grep -Ei 'queen|swarm|agent|node|lane' | tail -40

echo
echo "=== concurrency evidence: runWithConcurrency / lane starts ==="
docker logs "$G" --since 12m 2>&1 | grep -Ei 'runWithConcurrency|lane start|dispatching|concurrency' | tail -20

echo
echo "=== per-call prompt tokens (are Phase 3 cuts reaching the Queen path?) ==="
docker logs "$G" --since 12m 2>&1 \
  | grep -o '"llm.tokens.input":[0-9]*' | sort -t: -k2 -n | uniq -c | tail -15

echo
echo "=== per-call latency ==="
docker logs "$G" --since 12m 2>&1 | grep -o '"llm.latency_ms":[0-9]*' | tail -15

echo
echo "=== which prompt-budget class did the Queen leaves get? ==="
docker logs "$G" --since 12m 2>&1 | grep -Ei 'promptBudget|budget class|maxPrompt|overlay=' | tail -12
