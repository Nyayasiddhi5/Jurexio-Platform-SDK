#!/usr/bin/env bash
# Run nysapi live freshness probe on nysdev via SSM. NV-SECRETS-001 — keys stay on EC2.
# Usage: cd nyayavigya-platform-312 && npm run probe:nysapi:freshness:ec2
set -euo pipefail
APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec bash "$APP_ROOT/scripts/jrx-ec2-ssm-run.sh" \
  "$APP_ROOT/scripts/_nysapi-live-freshness-probe.sh" \
  "nysapi-live-freshness-probe"
