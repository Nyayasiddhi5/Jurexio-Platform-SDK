#!/usr/bin/env bash
# NYV-OPS-DEPLOY-MODE-001 (2026-05-01)
#
# Convenience wrapper: deploy to the DEV EC2 (single nyv-gateway container,
# docker-compose.aws-dev.yml). Delegates to the canonical deploy script so
# the blue/green logic, preflight, secret-scan, rollback markers, and audit
# log all stay in ONE place.
#
# Usage:
#   bash scripts/deploy-dev.sh                     # full deploy
#   bash scripts/deploy-dev.sh --status            # status only (no deploy)
#   bash scripts/deploy-dev.sh --rollback          # rollback to LAST_GOOD
#
# Equivalent to:
#   NYV_DEPLOY_COMPOSE=docker-compose.aws-dev.yml bash scripts/deploy-replit-direct.sh "$@"

set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
export NYV_DEPLOY_COMPOSE="${NYV_DEPLOY_COMPOSE:-docker-compose.aws-dev.yml}"
exec bash "$HERE/deploy-replit-direct.sh" "$@"
