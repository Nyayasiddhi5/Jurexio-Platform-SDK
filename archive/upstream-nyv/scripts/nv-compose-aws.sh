#!/usr/bin/env bash
# =============================================================================
# nv-compose-aws.sh — NV-DEPLOY-NET-PROJECT-001 guard for MANUAL compose commands
#
# WHY
#   On 2026-08-19 a manual
#     docker rm -f nyv-gateway
#     docker compose -f docker-compose.aws-dev.yml up -d --no-deps gateway
#   run from /opt/Nyayavigya/repo/2026-08-19T1146Z-aws-ssm-7c5b1ff2 (no
#   COMPOSE_PROJECT_NAME exported) put the gateway on a brand-new
#   2026-08-19t1146z-aws-ssm-7c5b1ff2_nyv-net and cost 51 minutes / 511 nginx
#   502s. scripts/deploy-aws-ssm.sh was always safe because it exports
#   COMPOSE_PROJECT_NAME; ad-hoc human commands were not.
#
#   The structural fix is in docker-compose.aws-dev.yml (networks/volumes now
#   carry explicit `name:` keys, so they cannot be project-scoped). This wrapper
#   is the ergonomic half: it makes the safe command the short one, and keeps the
#   compose PROJECT (container/label scope) stable too, which the `name:` pins do
#   not cover.
#
# USAGE — on EC2, from any release dir:
#   bash scripts/jrx-compose-aws.sh ps
#   bash scripts/jrx-compose-aws.sh up -d --no-deps gateway
#   bash scripts/jrx-compose-aws.sh logs --tail 100 gateway
#   npm run compose:aws -- ps
#
#   Anything you would pass to `docker compose` goes after the script name; the
#   -f docker-compose.aws-dev.yml is supplied for you.
#
# THIS SCRIPT NEVER RESTARTS ANYTHING ON ITS OWN. It only fixes the project name
# and then does exactly what you asked.
# =============================================================================
set -euo pipefail

CANONICAL_PROJECT="nyayavigya-platform-312"
COMPOSE_FILE="docker-compose.aws-dev.yml"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

[ -f "$COMPOSE_FILE" ] || { echo "./jrx-compose-aws: $COMPOSE_FILE not found in $ROOT" >&2; exit 1; }

if [ $# -eq 0 ]; then
  echo "./jrx-compose-aws: no compose command given." >&2
  echo "  e.g. bash scripts/jrx-compose-aws.sh ps" >&2
  exit 2
fi

if [ -n "${COMPOSE_PROJECT_NAME:-}" ] && [ "$COMPOSE_PROJECT_NAME" != "$CANONICAL_PROJECT" ]; then
  echo "./jrx-compose-aws: REFUSING — COMPOSE_PROJECT_NAME is '$COMPOSE_PROJECT_NAME'," >&2
  echo "  but this stack must run as '$CANONICAL_PROJECT'. A mismatched project name is" >&2
  echo "  what forked the docker network on 2026-08-19 (51 min outage, 511 nginx 502s)." >&2
  echo "  Unset it, or run:  COMPOSE_PROJECT_NAME=$CANONICAL_PROJECT $0 $*" >&2
  exit 1
fi

if [ -z "${COMPOSE_PROJECT_NAME:-}" ] && [ "$(basename "$ROOT")" != "$CANONICAL_PROJECT" ]; then
  echo "./jrx-compose-aws: NOTE — cwd is '$(basename "$ROOT")', so bare 'docker compose' here"
  echo "  would have derived project name '$(basename "$ROOT" | tr '[:upper:]' '[:lower:]')'."
  echo "  Pinning to '$CANONICAL_PROJECT' instead. This is the guard doing its job."
fi

export COMPOSE_PROJECT_NAME="$CANONICAL_PROJECT"
echo "./jrx-compose-aws: COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT_NAME  file=$COMPOSE_FILE"
echo "./jrx-compose-aws: + docker compose -f $COMPOSE_FILE $*"
exec docker compose -f "$COMPOSE_FILE" "$@"
