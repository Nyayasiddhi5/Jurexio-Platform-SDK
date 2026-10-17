#!/bin/sh
# Root-cause NSP's "upstream HTTP 502" on the durable orchestrate path.
# NYV's own handler returns 503 AI_SERVICE_UNAVAILABLE, never 502 — so a 502
# must be manufactured at the proxy hop. This probe decides which.
# Positive control: nginx access log must be non-empty, else the paths are wrong.

echo "=== nginx containers / proxy layer ==="
docker ps --format "{{.Names}} {{.Image}} {{.Status}}" | head -10

echo "=== find nginx access+error logs ==="
for c in `docker ps --format '{{.Names}}' | grep -Ei 'nginx|proxy'`; do
  echo "-- container $c"
  docker exec "$c" sh -c 'ls -la /var/log/nginx/ 2>/dev/null | head' || true
done

NGX=`docker ps --format '{{.Names}}' | grep -Ei 'nginx|proxy' | head -1`
if [ -z "$NGX" ]; then echo "PROBE NOTE: no nginx container; proxy may be host-level"; fi

echo "=== control: access log line count (0 => wrong path, not zero traffic) ==="
if [ -n "$NGX" ]; then
  docker exec "$NGX" sh -c 'wc -l < /var/log/nginx/access.log 2>/dev/null || echo 0'
else
  wc -l < /var/log/nginx/access.log 2>/dev/null || echo 0
fi

echo "=== 502 / 504 responses on orchestrate in nginx access log ==="
if [ -n "$NGX" ]; then
  docker exec "$NGX" sh -c "grep -E 'orchestrate' /var/log/nginx/access.log 2>/dev/null | grep -E ' (502|504) ' | tail -20"
else
  grep -E 'orchestrate' /var/log/nginx/access.log 2>/dev/null | grep -E ' (502|504) ' | tail -20
fi

echo "=== nginx error log: upstream resets / prematurely closed ==="
if [ -n "$NGX" ]; then
  docker exec "$NGX" sh -c "grep -E 'upstream|recv\(\)|reset|closed|timed out' /var/log/nginx/error.log 2>/dev/null | tail -25"
else
  grep -E 'upstream|recv\(\)|reset|closed|timed out' /var/log/nginx/error.log 2>/dev/null | tail -25
fi

echo "=== proxy timeouts configured (the 502-vs-504 discriminator) ==="
if [ -n "$NGX" ]; then
  docker exec "$NGX" sh -c "grep -rEh 'proxy_(read|send|connect)_timeout|keepalive_timeout|proxy_next_upstream' /etc/nginx/ 2>/dev/null | sort -u | head -20"
fi

echo "=== gateway restarts / OOM (a restart mid-request IS a 502) ==="
docker inspect nyv-gateway --format 'startedAt={{.State.StartedAt}} restarts={{.RestartCount}} oomkilled={{.State.OOMKilled}} exitcode={{.State.ExitCode}}'
docker stats --no-stream --format "{{.Name}} mem={{.MemUsage}} cpu={{.CPUPerc}}" | grep nyv-gateway

echo "=== gateway: 503 AI_SERVICE_UNAVAILABLE + retry-queue evidence (last 6h) ==="
LOG=`docker logs nyv-gateway --since 6h 2>&1`
echo -n "ai_service_unavailable="; printf '%s' "$LOG" | grep -c "AI_SERVICE_UNAVAILABLE" || true
echo -n "retry_enqueued="; printf '%s' "$LOG" | grep -c "orch-retry" || true
echo -n "never_empty_fallback="; printf '%s' "$LOG" | grep -c "nyv-never-empty-fallback" || true
echo -n "provider_all_failed="; printf '%s' "$LOG" | grep -cE "all providers failed|cascade exhausted" || true
echo -n "uncaught="; printf '%s' "$LOG" | grep -cE "UnhandledPromiseRejection|FATAL|heap out of memory" || true
echo "control: gateway_log_lines=`printf '%s' "$LOG" | wc -l`"

echo "=== last provider errors verbatim ==="
printf '%s' "$LOG" | grep -E "providerError|provider error|429|529|ThrottlingException" | tail -12
