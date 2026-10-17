#!/usr/bin/env bash
# Locate the live gateway's env + working dir. Read-only reconnaissance:
# no docker compose, no restarts, no writes. Prints NO secret values, only
# lengths and key NAMES.
set -uo pipefail
echo "=== candidate app dirs ==="
for d in /opt/nyayavigya /opt/nyv /home/ec2-user /home/ubuntu /srv /app; do
  [ -d "$d" ] && ls -la "$d" 2>/dev/null | head -20 && echo "  ^ $d"
done
echo
echo "=== any .env* under likely roots (names only) ==="
find /opt /home /srv -maxdepth 3 -name '.env*' -type f 2>/dev/null | head -20
echo
echo "=== running containers (read-only ps) ==="
docker ps --format '{{.Names}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null
echo
echo "=== does nyv-gateway have the key in its ENV? (length only) ==="
docker exec nyv-gateway sh -lc 'echo "NYV_SDK_KEY_NSP len=${#NYV_SDK_KEY_NSP}"; echo "NYS_KNOWLEDGE_BASE_URL set=${NYS_KNOWLEDGE_BASE_URL:+yes}"' 2>&1 | head -5
echo
echo "=== gateway health from the host (positive control) ==="
code=$(curl -s -o /tmp/h.json -w '%{http_code}' --max-time 20 http://localhost:5000/health)
echo "health http=$code body=$(head -c 200 /tmp/h.json)"
echo DONE
