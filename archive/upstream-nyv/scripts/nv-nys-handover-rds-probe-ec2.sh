#!/usr/bin/env bash
# NYS-Search handover vs live RDS/nysapi crosscheck on caselaw-worker via SSM.
# Usage: cd nyayavigya-platform-312 && npm run probe:nys-handover:rds:ec2
set -euo pipefail
APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec bash "$APP_ROOT/scripts/_nys-ssm-run.sh" \
  "$APP_ROOT/scripts/_ec2-nys-handover-rds-lite-probe.sh" \
  "nys-handover-rds-lite-probe"
