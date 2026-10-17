#!/usr/bin/env bash
# Push updated repair.ts into running gateway container and execute repair.
set -euo pipefail
APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$APP_ROOT/scripts/jrx-source-dev-deploy-env.sh"
MODE="${1:-repair}"
REPAIR_TS="$APP_ROOT/scripts/jrx-audit-hash-chain-repair.ts"
HASH_TS="$APP_ROOT/src/services/jrx-audit-hash.ts"
if base64 -w0 "$REPAIR_TS" >/dev/null 2>&1; then
  B64_REPAIR=$(base64 -w0 "$REPAIR_TS")
  B64_HASH=$(base64 -w0 "$HASH_TS")
else
  B64_REPAIR=$(base64 < "$REPAIR_TS" | tr -d '\n')
  B64_HASH=$(base64 < "$HASH_TS" | tr -d '\n')
fi

REMOTE="echo $B64_HASH | base64 -d > /tmp/jrx-audit-hash.ts"
REMOTE="$REMOTE && echo $B64_REPAIR | base64 -d > /tmp/jrx-audit-hash-chain-repair.ts"
REMOTE="$REMOTE && docker cp /tmp/jrx-audit-hash.ts nyv-gateway:/app/src/services/jrx-audit-hash.ts"
REMOTE="$REMOTE && docker cp /tmp/jrx-audit-hash-chain-repair.ts nyv-gateway:/app/scripts/jrx-audit-hash-chain-repair.ts"
REMOTE="$REMOTE && bash -s $MODE" 

# append ec2 repair runner
if base64 -w0 "$APP_ROOT/scripts/_ec2-audit-hash-chain-repair.sh" >/dev/null 2>&1; then
  B64_RUN=$(base64 -w0 "$APP_ROOT/scripts/_ec2-audit-hash-chain-repair.sh")
else
  B64_RUN=$(base64 < "$APP_ROOT/scripts/_ec2-audit-hash-chain-repair.sh" | tr -d '\n')
fi

CMD="${REMOTE} <<'EOS'
$(cat "$APP_ROOT/scripts/_ec2-audit-hash-chain-repair.sh")
EOS"

# simpler: chain base64 decode of runner
PARAMS="commands=[\"echo $B64_HASH | base64 -d > /tmp/jrx-audit-hash.ts && echo $B64_REPAIR | base64 -d > /tmp/jrx-audit-hash-chain-repair.ts && docker cp /tmp/jrx-audit-hash.ts nyv-gateway:/app/src/services/jrx-audit-hash.ts && docker cp /tmp/jrx-audit-hash-chain-repair.ts nyv-gateway:/app/scripts/jrx-audit-hash-chain-repair.ts && echo $B64_RUN | base64 -d | bash -s $MODE\"]"

CMD_ID=$(aws ssm send-command --region "$NYV_AWS_REGION" --instance-ids "$NYV_EC2_INSTANCE_ID" \
  --document-name AWS-RunShellScript --comment "audit-hash-hotpatch-$MODE-$(date -u +%Y%m%dT%H%M%SZ)" \
  --parameters "$PARAMS" \
  --query Command.CommandId --output text)
echo "SSM command_id=$CMD_ID mode=$MODE"
for _ in $(seq 1 120); do
  st=$(aws ssm get-command-invocation --region "$NYV_AWS_REGION" --command-id "$CMD_ID" \
    --instance-id "$NYV_EC2_INSTANCE_ID" --query Status --output text 2>/dev/null || echo Pending)
  case "$st" in Success|Failed|Cancelled|TimedOut) break ;; *) sleep 4 ;; esac
done
aws ssm get-command-invocation --region "$NYV_AWS_REGION" --command-id "$CMD_ID" \
  --instance-id "$NYV_EC2_INSTANCE_ID" --query '[Status,StandardOutputContent,StandardErrorContent]' --output text
echo "done status=$st command_id=$CMD_ID"
