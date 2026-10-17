#!/usr/bin/env bash
# Locate the NYS API listener before probing it (the previous probe assumed
# :5000 and got http=000 — an impossible shape, i.e. my command was wrong).
set -uo pipefail
echo "probe-positive-control 5150"
echo "=== listening tcp sockets owned by node ==="
ss -ltnp 2>/dev/null | grep -i node || ss -ltn 2>/dev/null | head -15
echo "=== PORT in api .env (name only) ==="
grep -oE '^(PORT|API_PORT|HTTP_PORT)=' /opt/nyv/api/.env 2>/dev/null || echo "no PORT key"
grep -m1 -oE '^PORT=[0-9]+' /opt/nyv/api/.env 2>/dev/null || true
echo "=== which auth header does the app expect (grep source, no values) ==="
grep -oE '(x-api-key|authorization|x-nys-api-key|JRX_ECOSYSTEM_SDK_API_KEYS)' /opt/nyv/api/index.mjs 2>/dev/null | sort | uniq -c | head
echo "probe-done 5150"
