#!/usr/bin/env bash
# Push shard-aware embed loop + daily monitor to nyv-caselaw-worker and start 3 HC + 1 DC.
set -euo pipefail
eval "$(aws configure export-credentials --profile nsp-developer --format env 2>/dev/null || true)"
if [[ -z "${AWS_ACCESS_KEY_ID:-}" ]]; then
  export AWS_ACCESS_KEY_ID=$(aws configure get aws_access_key_id --profile nsp-developer)
  export AWS_SECRET_ACCESS_KEY=$(aws configure get aws_secret_access_key --profile nsp-developer)
fi
export AWS_DEFAULT_REGION=ap-south-1
INSTANCE=i-000115b19219bb766
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOOP="$ROOT/jrx-search/artifacts/api-server/scripts/jrx-caselaw-embed-loop.sh"
MON="$ROOT/jrx-search/artifacts/api-server/scripts/jrx-caselaw-embed-daily-monitor.sh"
PATCH="$ROOT/jrx-search/artifacts/api-server/scripts/jrx-patch-embed-corpus-shards.py"
PARAMS=$(mktemp)
python3 - "$LOOP" "$MON" "$PATCH" > "$PARAMS" <<'PY'
import json, sys, base64, pathlib
loop = base64.b64encode(pathlib.Path(sys.argv[1]).read_bytes()).decode()
mon = base64.b64encode(pathlib.Path(sys.argv[2]).read_bytes()).decode()
patch = base64.b64encode(pathlib.Path(sys.argv[3]).read_bytes()).decode()
remote = """set -euo pipefail
python3 -c "import base64; open('/tmp/jrx-caselaw-embed-loop.sh','wb').write(base64.b64decode('__LOOP__'))"
python3 -c "import base64; open('/tmp/jrx-caselaw-embed-daily-monitor.sh','wb').write(base64.b64decode('__MON__'))"
python3 -c "import base64; open('/tmp/jrx-patch-embed-corpus-shards.py','wb').write(base64.b64decode('__PATCH__'))"
sudo cp /tmp/jrx-caselaw-embed-loop.sh /opt/nyv/api/jrx-caselaw-embed-loop.sh
sudo cp /tmp/jrx-caselaw-embed-daily-monitor.sh /opt/nyv/api/jrx-caselaw-embed-daily-monitor.sh
sudo chmod +x /opt/nyv/api/jrx-caselaw-embed-loop.sh /opt/nyv/api/jrx-caselaw-embed-daily-monitor.sh
sudo python3 /tmp/jrx-patch-embed-corpus-shards.py /opt/nyv/api/embed-corpus.mjs

sudo tee /etc/systemd/system/nyv-caselaw-embed-loop@.service >/dev/null <<'UNIT'
[Unit]
Description=NYV caselaw embed shard %i
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/nyv/api
EnvironmentFile=-/opt/nyv/api/.env
Environment=EMBED_SCOPE=hc
Environment=EMBED_SHARDS=3
Environment=EMBED_SHARD=%i
Environment=EMBED_CONCURRENCY=8
Environment=EMBED_BATCH=200
Environment=EMBED_HC_MAX_ROWS=200000
Environment=EMBED_SKIP_SC=1
Environment=EMBED_ALL_MAX_ROWS=0
ExecStart=/bin/bash /opt/nyv/api/jrx-caselaw-embed-loop.sh
Restart=always
RestartSec=20
Nice=10

[Install]
WantedBy=multi-user.target
UNIT

sudo tee /etc/systemd/system/nyv-caselaw-embed-dc.service >/dev/null <<'UNIT'
[Unit]
Description=NYV caselaw embed district-court
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/nyv/api
EnvironmentFile=-/opt/nyv/api/.env
Environment=EMBED_SCOPE=dc
Environment=EMBED_SHARDS=1
Environment=EMBED_SHARD=0
Environment=EMBED_CONCURRENCY=6
Environment=EMBED_DC_MAX_ROWS=80000
ExecStart=/bin/bash /opt/nyv/api/jrx-caselaw-embed-loop.sh
Restart=always
RestartSec=20
Nice=10

[Install]
WantedBy=multi-user.target
UNIT

sudo tee /etc/systemd/system/nyv-caselaw-embed-daily-monitor.service >/dev/null <<'UNIT'
[Unit]
Description=NYV caselaw embed daily coverage snapshot

[Service]
Type=oneshot
ExecStart=/bin/bash /opt/nyv/api/jrx-caselaw-embed-daily-monitor.sh
UNIT

sudo tee /etc/systemd/system/nyv-caselaw-embed-daily-monitor.timer >/dev/null <<'UNIT'
[Unit]
Description=Daily caselaw embed coverage snapshot

[Timer]
OnCalendar=*-*-* 06:30:00
Persistent=true
Unit=nyv-caselaw-embed-daily-monitor.service

[Install]
WantedBy=timers.target
UNIT

sudo systemctl stop nyv-caselaw-embed-loop.service 2>/dev/null || true
sudo systemctl disable nyv-caselaw-embed-loop.service 2>/dev/null || true
sudo systemctl daemon-reload
sudo systemctl enable --now nyv-caselaw-embed-loop@0.service nyv-caselaw-embed-loop@1.service nyv-caselaw-embed-loop@2.service nyv-caselaw-embed-dc.service nyv-caselaw-embed-daily-monitor.timer
sudo systemctl start nyv-caselaw-embed-daily-monitor.service || true
sleep 6
echo ---UNITS---
systemctl is-active nyv-caselaw-embed-loop@0 nyv-caselaw-embed-loop@1 nyv-caselaw-embed-loop@2 nyv-caselaw-embed-dc nyv-caselaw-embed-daily-monitor.timer
echo ---PROCS---
pgrep -af embed-corpus.mjs | head -20 || true
echo ---LOOP---
tail -n 20 /opt/nyv/embed-loop.log || true
echo ---DAILY---
cat /opt/nyv/embed-coverage-latest.json 2>/dev/null || echo NO_DAILY_YET
"""
remote = remote.replace("__LOOP__", loop).replace("__MON__", mon).replace("__PATCH__", patch)
print(json.dumps({"commands": [remote], "executionTimeout": ["240"]}))
PY
CMD_ID=$(aws ssm send-command --instance-ids "$INSTANCE" --document-name AWS-RunShellScript --parameters "file://$PARAMS" --query Command.CommandId --output text)
rm -f "$PARAMS"
echo "CMD=$CMD_ID"
for i in $(seq 1 50); do
  sleep 5
  OUT=$(aws ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE" --output json)
  STATUS=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["Status"])' <<<"$OUT")
  echo "poll=$STATUS"
  if [[ "$STATUS" == "Success" || "$STATUS" == "Failed" || "$STATUS" == "Cancelled" || "$STATUS" == "TimedOut" ]]; then
    python3 -c 'import json,sys; j=json.load(sys.stdin); print(j.get("StandardOutputContent") or ""); print("STDERR:", (j.get("StandardErrorContent") or "")[:3000])' <<<"$OUT"
    [[ "$STATUS" == "Success" ]]
    exit $?
  fi
done
echo TIMEOUT
exit 1
