#!/usr/bin/env bash
# Read-only capacity/latency diagnostic for the gateway container(s) on EC2.
set -uo pipefail
echo "=== containers (gateway/caddy) ==="
docker ps --format '{{.Names}}\t{{.Status}}' | grep -Ei 'gateway|caddy' || true
echo
echo "=== docker stats (one-shot) ==="
docker stats --no-stream --format '{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}' | grep -Ei 'gateway|caddy' || true
echo
echo "=== host load / mem ==="
uptime || true
free -h 2>/dev/null || true
echo
echo "=== gateway restart count + oom ==="
for c in $(docker ps --format '{{.Names}}' | grep -Ei 'gateway'); do
  rc=$(docker inspect -f '{{.RestartCount}}' "$c" 2>/dev/null)
  oom=$(docker inspect -f '{{.State.OOMKilled}}' "$c" 2>/dev/null)
  echo "$c restarts=$rc oomkilled=$oom"
done
echo
echo "=== recent gateway logs (errors/timeouts/llm) ==="
GW=$(docker ps --format '{{.Names}}' | grep -Ei 'gateway' | head -1)
docker logs --since 20m "$GW" 2>&1 | grep -iE 'timeout|ECONNRESET|terminat|429|rate.?limit|overload|ETIMEDOUT|abort|maker.?checker|opus' | tail -25 || true
echo "=== DONE ==="
