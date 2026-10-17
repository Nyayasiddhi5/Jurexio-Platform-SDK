#!/usr/bin/env bash
set +e
echo "=== raw tail 25 ==="
docker logs --tail 25 nyv-gateway 2>&1
echo "=== count lines ==="
docker logs nyv-gateway 2>&1 | wc -l
