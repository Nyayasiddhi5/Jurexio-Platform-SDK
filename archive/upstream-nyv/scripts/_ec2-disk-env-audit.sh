#!/usr/bin/env bash
# NV-DISK-ENV-AUDIT-001 — disk + env preservation crosscheck (no secret values)
set -euo pipefail

echo "=== DISK AUDIT $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "--- df -h / /opt/Nyayavigya ---"
df -h / /opt/Nyayavigya 2>/dev/null || df -h /

echo "--- docker system df ---"
docker system df 2>/dev/null || echo "docker unavailable"

echo "--- deploy pointers ---"
echo -n "CURRENT_DEPLOY="; cat /opt/Nyayavigya/CURRENT_DEPLOY 2>/dev/null || echo "MISSING"
echo -n "LAST_GOOD_DEPLOY="; cat /opt/Nyayavigya/LAST_GOOD_DEPLOY 2>/dev/null || echo "MISSING"

echo "--- secrets file presence (count, not contents) ---"
ls -la /opt/Nyayavigya/secrets/.env.production /opt/Nyayavigya/secrets/LAST_GOOD.env 2>/dev/null | wc -l

echo "--- NYV_ key count in .env.production ---"
grep -c '^NYV_' /opt/Nyayavigya/secrets/.env.production 2>/dev/null || echo "0"

echo "--- .env.production byte size ---"
wc -c < /opt/Nyayavigya/secrets/.env.production 2>/dev/null || echo "0"

echo "--- LAST_GOOD.env byte size ---"
wc -c < /opt/Nyayavigya/secrets/LAST_GOOD.env 2>/dev/null || echo "0"

echo "--- root disk use % ---"
df / | tail -1 | awk '{print "root_used_pct=" $5}'

echo "=== AUDIT COMPLETE ==="
