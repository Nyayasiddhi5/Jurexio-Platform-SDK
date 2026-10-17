#!/usr/bin/env bash
# Apply faster caselaw embed settings on NYS worker via SSM.
set -euo pipefail
eval "$(aws configure export-credentials --profile nsp-developer --format env 2>/dev/null || true)"
if [[ -z "${AWS_ACCESS_KEY_ID:-}" ]]; then
  export AWS_ACCESS_KEY_ID=$(aws configure get aws_access_key_id --profile nsp-developer)
  export AWS_SECRET_ACCESS_KEY=$(aws configure get aws_secret_access_key --profile nsp-developer)
fi
export AWS_DEFAULT_REGION=ap-south-1
INSTANCE=i-000115b19219bb766
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$ROOT/jrx-search/artifacts/api-server/scripts/jrx-caselaw-embed-loop.sh"
PARAMS=$(mktemp)
python3 - "$SCRIPT" > "$PARAMS" <<'PY'
import json, sys, base64, pathlib
script = pathlib.Path(sys.argv[1]).read_bytes()
b64 = base64.b64encode(script).decode()
remote = f"""set -e
python3 -c "import base64; open('/tmp/jrx-caselaw-embed-loop.sh','wb').write(base64.b64decode('{b64}'))"
sudo cp /tmp/jrx-caselaw-embed-loop.sh /opt/nyv/api/jrx-caselaw-embed-loop.sh
sudo chmod +x /opt/nyv/api/jrx-caselaw-embed-loop.sh
sudo mkdir -p /etc/systemd/system/nyv-caselaw-embed-loop.service.d
printf '%s\\n' '[Service]' 'Environment=EMBED_CONCURRENCY=28' 'Environment=EMBED_BATCH=200' 'Environment=EMBED_HC_MAX_ROWS=200000' 'Environment=EMBED_HC_BATCH=200' 'Environment=EMBED_ALL_MAX_ROWS=40000' 'Environment=EMBED_ALL_BATCH=150' | sudo tee /etc/systemd/system/nyv-caselaw-embed-loop.service.d/override.conf
sudo systemctl daemon-reload
sudo systemctl restart nyv-caselaw-embed-loop
sleep 4
echo ACTIVE:$(systemctl is-active nyv-caselaw-embed-loop)
echo ---OVERRIDE---
cat /etc/systemd/system/nyv-caselaw-embed-loop.service.d/override.conf
echo ---SCRIPT_DEFAULTS---
grep -E 'EMBED_CONCURRENCY=|EMBED_HC_MAX|EMBED_ALL_MAX|EMBED_BATCH=' /opt/nyv/api/jrx-caselaw-embed-loop.sh | head -20
echo ---LOG---
tail -n 10 /opt/nyv/embed-loop.log
"""
print(json.dumps({"commands": [remote], "executionTimeout": ["180"]}))
PY
CMD_ID=$(aws ssm send-command --instance-ids "$INSTANCE" --document-name AWS-RunShellScript --parameters "file://$PARAMS" --query Command.CommandId --output text)
rm -f "$PARAMS"
echo "CMD=$CMD_ID"
for i in $(seq 1 45); do
  sleep 4
  OUT=$(aws ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE" --output json)
  STATUS=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["Status"])' <<<"$OUT")
  echo "poll=$STATUS"
  if [[ "$STATUS" == "Success" || "$STATUS" == "Failed" || "$STATUS" == "Cancelled" || "$STATUS" == "TimedOut" ]]; then
    python3 -c 'import json,sys; j=json.load(sys.stdin); print(j.get("StandardOutputContent") or ""); print("STDERR:", (j.get("StandardErrorContent") or "")[:2000])' <<<"$OUT"
    exit 0
  fi
done
echo TIMEOUT
exit 1
