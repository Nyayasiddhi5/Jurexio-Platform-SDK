#!/usr/bin/env bash
# Pull NYV_SDK_KEY_* from EC2 into workspace .local/secrets/runtime.env (no values printed).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/../.local/secrets/runtime.env"
mkdir -m 700 -p "$(dirname "$OUT")"
source "$ROOT/scripts/jrx-source-dev-deploy-env.sh"

SCRIPT=$(mktemp)
cat > "$SCRIPT" <<'EOS'
grep -E '^NYV_SDK_KEY_' /opt/Nyayavigya/secrets/.env.production
EOS

if base64 -w0 "$SCRIPT" >/dev/null 2>&1; then B64=$(base64 -w0 "$SCRIPT"); else B64=$(base64 < "$SCRIPT" | tr -d '\n'); fi
CMD_ID=$(aws ssm send-command --region "$NYV_AWS_REGION" --instance-ids "$NYV_EC2_INSTANCE_ID" \
  --document-name AWS-RunShellScript --comment pull-sdk-keys \
  --parameters "commands=[\"echo $B64 | base64 -d | bash\"]" \
  --query Command.CommandId --output text)
for _ in $(seq 1 30); do
  st=$(aws ssm get-command-invocation --region "$NYV_AWS_REGION" --command-id "$CMD_ID" \
    --instance-id "$NYV_EC2_INSTANCE_ID" --query Status --output text 2>/dev/null || echo Pending)
  case "$st" in Success|Failed) break;; *) sleep 2;; esac
done
aws ssm get-command-invocation --region "$NYV_AWS_REGION" --command-id "$CMD_ID" \
  --instance-id "$NYV_EC2_INSTANCE_ID" --query StandardOutputContent --output text > "$OUT"
chmod 600 "$OUT"
KEYS=$(grep -c '^NYV_SDK_KEY_' "$OUT" || true)
echo "wrote ${KEYS} SDK keys to .local/secrets/runtime.env"
rm -f "$SCRIPT"
