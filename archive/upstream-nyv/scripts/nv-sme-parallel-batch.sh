#!/usr/bin/env bash
# NV-SME-PARALLEL-001 — launch the EC2-side SME batch detached, or poll/tail it.
#   bash scripts/jrx-sme-parallel-batch.sh launch   # ship + nohup on EC2
#   bash scripts/jrx-sme-parallel-batch.sh poll      # cat the log
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
source scripts/jrx-source-dev-deploy-env.sh >/dev/null 2>&1 || source scripts/jrx-source-dev-deploy-env.sh
: "${NYV_EC2_INSTANCE_ID:?}"
: "${NYV_AWS_REGION:=ap-south-1}"
LOG=/tmp/jrx-sme-parallel-batch.log
ACTION="${1:-poll}"

ssm_run() {
  local b64 cid status
  b64=$(base64 < /dev/stdin | tr -d '\n')
  cid=$(aws ssm send-command --region "$NYV_AWS_REGION" --instance-ids "$NYV_EC2_INSTANCE_ID" \
    --document-name AWS-RunShellScript --comment "sme-parallel-$ACTION" \
    --parameters "commands=[\"echo $b64 | base64 -d | bash\"]" \
    --query Command.CommandId --output text)
  for _ in $(seq 1 40); do
    status=$(aws ssm get-command-invocation --region "$NYV_AWS_REGION" --command-id "$cid" \
      --instance-id "$NYV_EC2_INSTANCE_ID" --query Status --output text 2>/dev/null || echo Pending)
    case "$status" in Success|Failed|Cancelled|TimedOut) break ;; *) sleep 2 ;; esac
  done
  aws ssm get-command-invocation --region "$NYV_AWS_REGION" --command-id "$cid" \
    --instance-id "$NYV_EC2_INSTANCE_ID" --query StandardOutputContent --output text || true
}

case "$ACTION" in
  launch)
    BATCH_B64=$(base64 < scripts/_ec2-sme-parallel-batch.sh | tr -d '\n')
    {
      echo "set -e"
      echo "echo $BATCH_B64 | base64 -d > /tmp/_ec2-sme-parallel-batch.sh"
      echo "chmod +x /tmp/_ec2-sme-parallel-batch.sh"
      echo ": > /tmp/jrx-sme-parallel-steps.log"
      echo "pkill -f _ec2-sme-parallel-batch.sh 2>/dev/null || true"
      echo "nohup env JURS='${JURS:-US EU GLOBAL}' MODES='${MODES:-free_chat drafting}' MAXT='${MAXT:-420}' bash /tmp/_ec2-sme-parallel-batch.sh > $LOG 2>&1 &"
      echo "echo launched pid=\$! log=$LOG jurs='${JURS:-US EU GLOBAL}' modes='${MODES:-free_chat drafting}'"
    } | ssm_run
    ;;
  poll)
    echo "echo '=== batch log ==='; cat $LOG 2>/dev/null || echo '(no log yet)'; echo '=== step timings ==='; cat /tmp/jrx-sme-parallel-steps.log 2>/dev/null || true" | ssm_run
    ;;
  *) echo "usage: $0 {launch|poll}"; exit 2 ;;
esac
