#!/usr/bin/env bash
# Run nysapi RDS schema + diary crosscheck on caselaw-worker via SSM.
# Usage: cd nyayavigya-platform-312 && npm run probe:nysapi:rds-schema:ec2
set -euo pipefail
APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec bash "$APP_ROOT/scripts/_nys-ssm-run.sh" \
  "$APP_ROOT/scripts/_ec2-nysapi-rds-schema-probe.sh" \
  "nysapi-rds-schema-probe"
