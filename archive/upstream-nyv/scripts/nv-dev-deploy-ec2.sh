#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_ROOT"

# shellcheck disable=SC1091
source "$APP_ROOT/scripts/jrx-source-dev-deploy-env.sh"

if ! command -v aws >/dev/null 2>&1; then
  echo "aws cli not installed. Install AWS CLI v2: https://awscli.amazonaws.com/AWSCLIV2.msi" >&2
  exit 1
fi

bash "$APP_ROOT/scripts/deploy-aws-ssm.sh" "$@"

HEALTH_URL="${NYV_DEV_HEALTH_URL:-https://api.nyayasiddhi.online/api/jrx/health}"
HEALTH_JSON="$(curl -fsS "$HEALTH_URL")"
python3 - "$HEALTH_JSON" <<'PY2'
import json
import sys

data = json.loads(sys.argv[1])
agents = data.get('agents') or {}
registry_version = agents.get('registryVersion') or data.get('registryVersion') or 'unknown'
total_agents = agents.get('totalAgents') or data.get('totalAgents') or 'unknown'
print(f'health ok (registryVersion={registry_version}, totalAgents={total_agents})')
PY2
