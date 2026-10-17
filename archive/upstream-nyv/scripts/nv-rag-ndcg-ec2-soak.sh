#!/usr/bin/env bash
# Run neural nDCG soak inside nysdev gateway (has COHERE_API_KEY / CROSS_ENCODER_URL).
set -euo pipefail
INSTANCE="${NYV_EC2_INSTANCE:-i-0df71e5ea1df8f588}"
REGION="${AWS_REGION:-ap-south-1}"
CMD_ID="$(aws ssm send-command \
  --instance-ids "$INSTANCE" \
  --document-name AWS-RunShellScript \
  --region "$REGION" \
  --timeout-seconds 300 \
  --output text --query 'Command.CommandId' \
  --parameters commands=["set -euo pipefail","docker exec -e NYV_NDCG_REQUIRE_NEURAL=1 -e NYV_NDCG_MIN_DELTA=0 nyv-gateway sh -lc 'cd /app && npm run rag:ndcg'"])"
echo "SSM=$CMD_ID"
for i in $(seq 1 36); do
  sleep 5
  ST="$(aws ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE" --region "$REGION" --query Status --output text 2>/dev/null || echo Unknown)"
  echo "try=$i status=$ST"
  if [[ "$ST" != "Pending" && "$ST" != "InProgress" && "$ST" != "Delayed" ]]; then
    aws ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE" --region "$REGION" --query StandardOutputContent --output text | tail -80
    aws ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE" --region "$REGION" --query StandardErrorContent --output text | tail -40
    [[ "$ST" == "Success" ]]
    exit $?
  fi
done
exit 1
