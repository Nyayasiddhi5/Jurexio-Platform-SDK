#!/usr/bin/env bash
set +e
echo "=== hash-chain cron + audit integrity + doc-pipeline wiring ==="
docker logs nyv-gateway 2>&1 | grep -iE "hash-chain|hash_chain|Audit hash|Vector-store eviction|Services initialized" | head -12
