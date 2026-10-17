#!/usr/bin/env bash
# Run partner smoke on EC2 using production SDK keys from canonical env.
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
LIVE_DIR=""
for p in /opt/Nyayavigya/repo/*/ /opt/Nyayavigya/repo/*/*/; do
  if [ -f "${p}package.json" ] && [ -d "${p}scripts" ]; then
    LIVE_DIR="${p%/}"
    break
  fi
done
[ -n "$LIVE_DIR" ] || { echo "no live dir"; exit 1; }
cd "$LIVE_DIR"
set -a
# shellcheck disable=SC1090
source <(grep -E '^(NYV_SDK_KEY_|NV_TARGET=|NYV_PLATFORM=)' "$CANON" | sed 's/^/export /')
set +a
export NV_TARGET=ec2
bash scripts/jrx-partner-smoke.sh
