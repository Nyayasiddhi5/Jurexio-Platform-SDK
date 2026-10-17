#!/usr/bin/env bash
set +e
echo "=== hash-chain / cron lines ==="
docker logs nyv-gateway 2>&1 | rg -i "hash.chain|cron|hash_chain" | tail -10
echo "=== eviction / audit integrity (context) ==="
docker logs nyv-gateway 2>&1 | rg -i "Vector-store eviction|Audit hash-chain integrity|Services initialized" | tail -6
echo "=== gateway uptime / start marker ==="
docker logs nyv-gateway 2>&1 | rg -i "listening|started|gateway ready|Step 5" | tail -8
