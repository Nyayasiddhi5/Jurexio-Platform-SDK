#!/usr/bin/env bash
# User GO — corpus backfill orchestrator (local → SSM)
set -euo pipefail
eval "$(aws configure export-credentials --profile nsp-developer --format env 2>/dev/null || true)"
export AWS_DEFAULT_REGION=ap-south-1
WORKER=i-000115b19219bb766
NYSDEV=i-0df71e5ea1df8f588
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

ssm_run() {
  local instance="$1" timeout="$2"
  shift 2
  local params cmd_id out status
  params=$(mktemp)
  python3 -c 'import json,sys; print(json.dumps({"commands": sys.argv[1:], "executionTimeout": [sys.argv[1+len(sys.argv)-1]]}))' "$@" "$timeout" > "$params" 2>/dev/null || {
    python3 <<PY > "$params"
import json
cmds = """$(printf '%s\n' "$@" | sed 's/"/\\"/g')""".split('\n')
cmds = [c for c in cmds if c]
print(json.dumps({"commands": cmds, "executionTimeout": ["$timeout"]}))
PY
  }
  # reliable: build JSON from args
  python3 - "$timeout" "$@" > "$params" <<'PY'
import json, sys
timeout = sys.argv[1]
cmds = sys.argv[2:]
print(json.dumps({"commands": cmds, "executionTimeout": [timeout]}))
PY
  cmd_id=$(aws ssm send-command --instance-ids "$instance" --document-name AWS-RunShellScript \
    --parameters "file://$params" --query Command.CommandId --output text)
  rm -f "$params"
  echo "SSM_CMD=$cmd_id instance=$instance" >&2
  for _ in $(seq 1 120); do
    sleep 5
    out=$(aws ssm get-command-invocation --command-id "$cmd_id" --instance-id "$instance" --output json)
    status=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["Status"])' <<<"$out")
    if [[ "$status" == "Success" || "$status" == "Failed" || "$status" == "Cancelled" || "$status" == "TimedOut" ]]; then
      python3 -c 'import json,sys; j=json.load(sys.stdin); print(j.get("StandardOutputContent") or ""); e=j.get("StandardErrorContent") or ""; print("STDERR:", e[:4000] if e else "")' <<<"$out"
      [[ "$status" == "Success" ]]
      return $?
    fi
  done
  echo "SSM TIMEOUT" >&2
  return 1
}

ssm_script() {
  local instance="$1" timeout="$2" script="$3"
  local b64 params cmd_id out status
  b64=$(base64 < "$script")
  params=$(mktemp)
  python3 - "$b64" "$timeout" > "$params" <<'PY'
import json, sys, base64
b64 = sys.argv[1]
timeout = sys.argv[2]
remote = f"""set -uo pipefail
python3 -c "import base64; open('/tmp/ssm-script.sh','wb').write(base64.b64decode('{b64}'))"
bash /tmp/ssm-script.sh
"""
print(json.dumps({"commands": [remote], "executionTimeout": [timeout]}))
PY
  cmd_id=$(aws ssm send-command --instance-ids "$instance" --document-name AWS-RunShellScript \
    --parameters "file://$params" --query Command.CommandId --output text)
  rm -f "$params"
  echo "SSM_CMD=$cmd_id instance=$instance script=$(basename "$script")" >&2
  for _ in $(seq 1 120); do
    sleep 5
    out=$(aws ssm get-command-invocation --command-id "$cmd_id" --instance-id "$instance" --output json)
    status=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["Status"])' <<<"$out")
    if [[ "$status" == "Success" || "$status" == "Failed" || "$status" == "Cancelled" || "$status" == "TimedOut" ]]; then
      python3 -c 'import json,sys; j=json.load(sys.stdin); print(j.get("StandardOutputContent") or ""); e=j.get("StandardErrorContent") or ""; print("STDERR:", e[:4000] if e else "")' <<<"$out"
      [[ "$status" == "Success" ]]
      return $?
    fi
  done
  echo "SSM TIMEOUT" >&2
  return 1
}

ssm_upload() {
  local instance="$1" local_path="$2" remote_path="$3"
  local b64 params cmd_id out status
  b64=$(base64 < "$local_path")
  params=$(mktemp)
  python3 - "$b64" "$remote_path" > "$params" <<'PY'
import json, sys
b64, remote = sys.argv[1], sys.argv[2]
cmd = f"python3 -c \"import base64; open('{remote}','wb').write(base64.b64decode('{b64}'))\""
print(json.dumps({"commands": [cmd], "executionTimeout": ["120"]}))
PY
  cmd_id=$(aws ssm send-command --instance-ids "$instance" --document-name AWS-RunShellScript \
    --parameters "file://$params" --query Command.CommandId --output text)
  rm -f "$params"
  for _ in $(seq 1 60); do
    sleep 3
    out=$(aws ssm get-command-invocation --command-id "$cmd_id" --instance-id "$instance" --output json)
    status=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["Status"])' <<<"$out")
    [[ "$status" == "InProgress" || "$status" == "Pending" ]] && continue
    [[ "$status" == "Success" ]]
    return $?
  done
  return 1
}

echo "========== BEFORE COUNTS (worker) =========="
ssm_script "$WORKER" 120 "$ROOT/scripts/_phase-b-corpus-counts.sh"

echo "========== CNR PROBE BEFORE (nysdev) =========="
ssm_script "$NYSDEV" 180 "$ROOT/scripts/_phase-b-probe.sh" | tee /tmp/cnr-before.txt

echo "========== UPLOAD HC/DC SCRIPTS (worker) =========="
for f in backfill-hc-dc-body-fts.mjs apply-hc-dc-body-fts-ddl.mjs _reverse-cursor.mjs _extract-auth.mjs; do
  ssm_upload "$WORKER" "$ROOT/jrx-search/scripts/$f" "/opt/nyv/api/$f"
done

echo "========== THROTTLED EMBED RESUME =========="
ssm_script "$WORKER" 120 "$ROOT/scripts/_phase-b-embed-resume-throttled.sh"

echo "========== SC FTS RETRY =========="
ssm_script "$WORKER" 180 "$ROOT/scripts/_phase-b2-sc-fts-retry.sh"

echo "========== HC/DC FTS DDL + PILOT (HC 25K) =========="
ssm_run "$WORKER" 600 \
  "cd /opt/nyv/api && node apply-hc-dc-body-fts-ddl.mjs" \
  "pkill -f backfill-hc-dc-body-fts.mjs 2>/dev/null || true" \
  "nohup env HC_DC_BODY_FTS_SCOPE=hc HC_DC_BODY_FTS_MAX_HC=25000 HC_DC_BODY_FTS_BATCH=25 HC_DC_BODY_FTS_CONCURRENCY=1 node /opt/nyv/api/backfill-hc-dc-body-fts.mjs >> /opt/nyv/logs/hc-body-fts-pilot.log 2>&1 & echo HC_PILOT_PID=\$!" \
  "sleep 5 && tail -5 /opt/nyv/logs/hc-body-fts-pilot.log 2>/dev/null || true"

echo "========== WAIT 90s for CNR stability =========="
sleep 90

echo "========== CNR PROBE AFTER (nysdev) =========="
ssm_script "$NYSDEV" 180 "$ROOT/scripts/_phase-b-probe.sh" | tee /tmp/cnr-after.txt

echo "========== AFTER COUNTS (worker) =========="
ssm_script "$WORKER" 120 "$ROOT/scripts/_phase-b-corpus-counts.sh"

echo "========== GO COMPLETE =========="
