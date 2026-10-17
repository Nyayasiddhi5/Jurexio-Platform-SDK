#!/usr/bin/env bash
# Trace one orchestration in the gateway logs: providers/models used, latencies,
# and whether it completed. Arg1 = orchestrationId substring.
set -uo pipefail
GW=$(docker ps --format '{{.Names}}' | grep -Ei 'gateway' | head -1)
echo "gateway=$GW (scanning last 20m)"
echo "=== provider/model dispatches + latencies (last 20m) ==="
docker logs --since 20m "$GW" 2>&1 | grep -iE "dispatched agent to LLM|llm-orchestrator: success|run_complete|maker|checker|provider" | grep -iE "openrouter|anthropic|opus|run_complete|maker|checker|latencyMs" | tail -30
echo
echo "=== any errors in last 20m (credit/quota/timeout) ==="
docker logs --since 20m "$GW" 2>&1 | grep -ciE "credit balance|insufficient_quota|ETIMEDOUT|per-node timeout" || true
echo "  (count of error lines above)"
echo "DONE"
