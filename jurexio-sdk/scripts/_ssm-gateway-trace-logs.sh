#!/usr/bin/env bash
set -euo pipefail
echo "=== gateway trace logs (30m) ==="
docker logs jrx-gateway --since 30m 2>&1 \
  | grep -iE 'trace|stream|queen|orchestrat|step|latency|timeout|rag|memory|AGUI' \
  | tail -200 || true
echo "=== container health ==="
docker ps --format 'table {{.Names}}\t{{.Status}}' | grep -E 'jrx-|NAMES' || true
