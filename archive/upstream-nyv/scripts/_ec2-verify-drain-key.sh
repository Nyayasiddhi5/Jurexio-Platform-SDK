#!/usr/bin/env bash
# Verify the premise of the deploy-aws-ssm.sh change: is NYV_SHUTDOWN_DRAIN_MS
# genuinely absent from the canonical .env.production? If it is present, the
# `|| true` is harmless but the stated cause is wrong. Read-only; prints counts
# and key NAMES only, never a value.
set -uo pipefail
ENVF="/opt/nyayavigya/secrets/.env.production"
echo "envfile exists=$([ -f "$ENVF" ] && echo yes || echo no)"
echo "total keys: $(grep -cE '^[A-Za-z_][A-Za-z0-9_]*=' "$ENVF")"
n=$( { grep -cE '^NYV_SHUTDOWN_DRAIN_MS=' "$ENVF" || true; } )
echo "NYV_SHUTDOWN_DRAIN_MS occurrences: $n   (0 => the || true fix is load-bearing)"
echo "CONTROL — a key that MUST exist:"
echo "  NODE_ENV occurrences: $( { grep -cE '^NODE_ENV=' "$ENVF" || true; } )  (MUST be >=1 or this probe is broken)"
echo
echo "=== stop_grace_period in the live compose file ==="
LIVE=$(ls -d /opt/nyayavigya/repo 2>/dev/null || ls -d /opt/nyayavigya/live 2>/dev/null || echo /opt/nyayavigya)
f="$(find /opt/nyayavigya -maxdepth 3 -name 'docker-compose.aws-dev.yml' 2>/dev/null | head -1)"
echo "compose=$f"
[ -n "$f" ] && { grep -nE 'stop_grace_period' "$f" || echo "  (absent — COMPOSE_GRACE_S also needs || true)"; }
echo DONE
