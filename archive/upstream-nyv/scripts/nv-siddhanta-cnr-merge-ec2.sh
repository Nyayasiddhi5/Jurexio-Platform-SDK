#!/usr/bin/env bash
# Push Siddhanta→staging merge to caselaw-worker via SSM.
set -euo pipefail
APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MERGE_PY="$APP_ROOT/scripts/jrx-case-api-siddhanta-cnr-merge.py"
RUN_SH="$APP_ROOT/scripts/_ec2-siddhanta-cnr-merge-run.sh"
TMP="$(mktemp)"
B64=$(base64 < "$MERGE_PY" | tr -d '\n')
export MERGE_SCRIPT_B64="$B64"
export MERGE_FORCE_RESTART="${MERGE_FORCE_RESTART:-1}"
{
  echo "export MERGE_SCRIPT_B64='$B64'"
  echo "export MERGE_FORCE_RESTART='$MERGE_FORCE_RESTART'"
  cat "$RUN_SH"
} > "$TMP"
bash "$APP_ROOT/scripts/_nys-ssm-run.sh" "$TMP" "siddhanta-cnr-merge-kickoff"
rm -f "$TMP"
