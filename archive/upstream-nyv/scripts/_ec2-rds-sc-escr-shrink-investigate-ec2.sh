#!/usr/bin/env bash
# SSM wrapper: SC/ESCR CNR shrink investigation on caselaw-worker.
# Usage: cd nyayavigya-platform-312 && bash scripts/_ec2-rds-sc-escr-shrink-investigate-ec2.sh
set -euo pipefail
APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec bash "$APP_ROOT/scripts/_nys-ssm-run.sh" \
  "$APP_ROOT/scripts/_ec2-rds-sc-escr-shrink-investigate.sh" \
  "rds-sc-escr-shrink-investigate"
