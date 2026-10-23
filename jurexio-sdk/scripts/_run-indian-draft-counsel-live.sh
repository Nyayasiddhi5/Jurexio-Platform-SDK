#!/usr/bin/env bash
# NV-INDIAN-DRAFT-EVAL-001 — counsel lane only (long-running; run under nohup/setsid).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [[ -f "../.local/secrets/runtime.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "../.local/secrets/runtime.env"
  set +a
fi
CASES=(
  IN-BAIL-001 IN-WS-001 IN-NOTICE-001 IN-SLP-001 IN-WP-001
  IN-CA-001 IN-IA-001 IN-REVIEW-001 IN-EXEC-001 IN-AGREE-001
)
LOG="$ROOT/docs/audit/eval/draft-india-live-counsel-all-2026-10-07.log"
: >"$LOG"
for c in "${CASES[@]}"; do
  echo "=== counsel $c $(date -u +%Y-%m-%dT%H:%M:%SZ) ===" | tee -a "$LOG"
  npm run eval:draft:india:live -- --live --lane=counsel --case="$c" 2>&1 | tee -a "$LOG"
done
echo "=== counsel batch done $(date -u +%Y-%m-%dT%H:%M:%SZ) ===" | tee -a "$LOG"
