#!/usr/bin/env bash
set +e
docker restart nyv-gateway >/dev/null 2>&1 && echo "restart issued"
# Wait for health
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:5000/api/jrx/health 2>/dev/null)
  [ "$code" = "200" ] && { echo "healthy after ${i}x2s"; break; }
  sleep 2
done
echo "=== fresh boot wiring lines ==="
docker logs nyv-gateway 2>&1 | rg -i "hash-chain|Audit hash-chain integrity|Vector-store eviction|Services initialized|cron" | head -12
