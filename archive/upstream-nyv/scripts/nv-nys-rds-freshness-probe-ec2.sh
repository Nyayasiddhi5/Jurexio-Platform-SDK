#!/usr/bin/env bash
# Run RDS corpus freshness SQL on caselaw-worker via SSM. Read-only. NV-SECRETS-001.
# Usage: cd nyayavigya-platform-312 && npm run probe:nys-rds:freshness:ec2
set -euo pipefail
APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec bash "$APP_ROOT/scripts/_nys-ssm-run.sh" \
  "$APP_ROOT/scripts/_nys-rds-freshness-probe.sh" \
  "nys-rds-freshness-probe"
