#!/usr/bin/env bash
# Verify NV-SME-OPUS-OPENROUTER-001 is live: flag in container env, new code in
# image, and no fresh direct-anthropic credit-balance failures post-restart.
set -uo pipefail
GW=$(docker ps --format '{{.Names}}' | grep -Ei 'gateway' | head -1)
echo "gateway=$GW"
echo "started=$(docker inspect -f '{{.State.StartedAt}}' "$GW" 2>/dev/null)  restarts=$(docker inspect -f '{{.RestartCount}}' "$GW" 2>/dev/null)"
echo
echo "=== flag in container env ==="
docker exec "$GW" sh -c 'echo NYV_ANTHROPIC_DIRECT_DISABLED=$NYV_ANTHROPIC_DIRECT_DISABLED' 2>/dev/null || echo "exec failed"
echo
echo "=== new code present in image (directAnthropicDisabled) ==="
docker exec "$GW" sh -c "grep -rl 'directAnthropicDisabled' /app/src /app/dist 2>/dev/null | head -3" 2>/dev/null || echo "grep failed"
echo
echo "=== direct-anthropic credit-balance failures in last 8m (should be 0) ==="
docker logs --since 8m "$GW" 2>&1 | grep -c 'credit balance is too low' || true
echo "=== openrouter opus dispatches in last 8m (should be >0 once traffic flows) ==="
docker logs --since 8m "$GW" 2>&1 | grep -c 'anthropic/claude-opus' || true
echo "=== DONE ==="
