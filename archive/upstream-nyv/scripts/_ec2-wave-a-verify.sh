#!/bin/sh
# NV-COMPLETION-DRIVEN-001 Wave A post-deploy verify.
# Positive control (NV-VALIDATE-THE-PROBE-001): every marker grep -c must print a
# number, and a KNOWN-OLD marker must also be >=1. If the old marker is 0 the
# grep target is wrong (wrong path / wrong container), not "nothing deployed".

echo "=== health ==="
curl -sS -m 20 -o /dev/null -w "local=%{http_code}\n" http://localhost:5000/health
curl -sS -m 20 -o /dev/null -w "public=%{http_code}\n" https://api.nyayasiddhi.online/health

echo "=== Wave A markers in running image (each must be >=1) ==="
echo -n "completion_driven_module="
docker exec nyv-gateway sh -c 'ls -1 /app/src/orchestration/jrx-completion-driven.ts 2>/dev/null | wc -l'
echo -n "settle_optional="
docker exec nyv-gateway grep -c "settleOptional" /app/src/orchestration/jrx-completion-driven.ts
echo -n "first_useful_grace="
docker exec nyv-gateway grep -c "first_useful_grace" /app/src/orchestration/jrx-memory-fan-in.ts
echo -n "skip_memory_stamp="
docker exec nyv-gateway grep -c "memoryAlreadyApplied = true" /app/src/orchestration/jrx-queen-orchestrator.ts
echo -n "skip_memory_consumed="
docker exec nyv-gateway grep -c "skipMemory" /app/src/orchestration/orchestration-middleware.ts
echo -n "timeout_not_retryable="
docker exec nyv-gateway grep -c "isCapabilityErrorRetryable" /app/src/services/circuit-breaker.ts
echo -n "cot_skipped_progression="
docker exec nyv-gateway grep -c "__queenCotSkippedProgression" /app/src/orchestration/jrx-queen-orchestrator.ts
echo -n "parallel_post_safety="
docker exec nyv-gateway grep -c "safetySettled" /app/src/orchestration/orchestration-middleware.ts
echo -n "request_phase="
docker exec nyv-gateway grep -c "setRequestPhase" /app/src/orchestration/jrx-queen-orchestrator.ts

echo "=== CANARY (known-old marker; 0 here means the probe is broken) ==="
echo -n "canary_maybeRunQueenCoT="
docker exec nyv-gateway grep -c "maybeRunQueenCoT" /app/src/orchestration/jrx-queen-orchestrator.ts

echo "=== container ==="
docker ps --format "{{.Names}} {{.Status}} created={{.CreatedAt}}" | grep nyv-gateway
docker inspect nyv-gateway --format '{{.State.StartedAt}} restarts={{.RestartCount}} oomkilled={{.State.OOMKilled}}'
