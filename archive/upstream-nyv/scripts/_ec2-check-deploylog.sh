#!/usr/bin/env bash
echo "=== last 3 deploys.log lines ==="
tail -n 3 /opt/nyayavigya/deploys.log 2>/dev/null
echo "=== gateway container uptime ==="
docker ps --filter name=nyv-gateway --format '{{.Names}} {{.Status}}'
