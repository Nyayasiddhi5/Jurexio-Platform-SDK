#!/usr/bin/env bash
# JRX-OPS-DEPLOY-MODE-001 (2026-05-01)
#
# Convenience wrapper: deploy to the PROD EC2 (blue/green gateway-a +
# gateway-b under docker-compose.ecosystem.yml). Delegates to the canonical
# deploy script so the blue/green logic, preflight, secret-scan, rollback
# markers, and audit log all stay in ONE place.
#
# Usage:
#   bash scripts/deploy-prod.sh                    # full blue/green deploy
#   bash scripts/deploy-prod.sh --status           # status only
#   bash scripts/deploy-prod.sh --rollback         # rollback to LAST_GOOD
#
# Equivalent to:
#   JRX_DEPLOY_COMPOSE=docker-compose.ecosystem.yml bash scripts/deploy-replit-direct.sh "$@"
#
# SAFETY: production deploys ALSO require the standard preflight chain
# (typecheck, lint, vitest, gitleaks, audit). Skipping requires
# JRX_DEPLOY_SKIP_PREFLIGHT=1 which is logged as UNGATED on EC2.

set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
export JRX_DEPLOY_COMPOSE="${JRX_DEPLOY_COMPOSE:-docker-compose.ecosystem.yml}"
exec bash "$HERE/deploy-replit-direct.sh" "$@"
