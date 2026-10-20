#!/usr/bin/env bash
# JRX live SDK matrix — delegates to jrx-partner-smoke (local or ec2).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export NV_TARGET="${NV_TARGET:-local}"
echo "==> jrx-live-sdk-matrix NV_TARGET=${NV_TARGET}"
bash "$ROOT/scripts/jrx-partner-smoke.sh"
