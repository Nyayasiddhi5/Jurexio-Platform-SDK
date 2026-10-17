#!/usr/bin/env bash
# Fetch admin JWT from nysdev via SSM login (password never leaves EC2; token to stdout only).
set -euo pipefail
APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -f "$APP_ROOT/../product Documents/env.production" ]; then
  # shellcheck disable=SC1091
  source "$APP_ROOT/scripts/jrx-source-dev-deploy-env.sh" >&2
else
  set -a
  # shellcheck disable=SC1091
  source "$APP_ROOT/.env"
  set +a
  export NYV_AWS_REGION="${NYV_AWS_REGION:-${AWS_REGION:-ap-south-1}}"
  export NYV_EC2_INSTANCE_ID="${NYV_EC2_INSTANCE_ID:-i-0df71e5ea1df8f588}"
fi


REMOTE=$(mktemp)
cat > "$REMOTE" <<'EOS'
#!/usr/bin/env bash
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
PW=$(grep -E '^NV_DEMO_PASSWORD=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')
curl -sS -o /tmp/jrx-jwt.json \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://console.nyayasiddhi.online' \
  -d "{\"email\":\"admin@nyayavigya.in\",\"password\":\"$PW\"}" \
  https://api.nyayasiddhi.online/api/jrx/auth/login
python3 - <<'PY'
import base64, json, sys
d = json.load(open("/tmp/jrx-jwt.json"))
tok = d.get("token") or d.get("accessToken") or (d.get("data") or {}).get("token")
if not tok:
    raise SystemExit("LOGIN_FAIL no token in response")
print(base64.b64encode(tok.encode()).decode())
PY
EOS

B64=$(base64 < "$REMOTE" | tr -d '\n')
rm -f "$REMOTE"

CMD_ID=$(aws ssm send-command \
  --region "$NYV_AWS_REGION" \
  --instance-ids "$NYV_EC2_INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --parameters "commands=[\"echo $B64 | base64 -d | bash\"]" \
  --query Command.CommandId --output text)

for _ in $(seq 1 30); do
  st=$(aws ssm get-command-invocation \
    --region "$NYV_AWS_REGION" \
    --command-id "$CMD_ID" \
    --instance-id "$NYV_EC2_INSTANCE_ID" \
    --query Status --output text 2>/dev/null || echo Pending)
  case "$st" in Success|Failed|Cancelled|TimedOut) break ;; *) sleep 2 ;; esac
done

RAW=$(aws ssm get-command-invocation \
  --region "$NYV_AWS_REGION" \
  --command-id "$CMD_ID" \
  --instance-id "$NYV_EC2_INSTANCE_ID" \
  --query StandardOutputContent --output text 2>/dev/null || true)
ST=$(aws ssm get-command-invocation \
  --region "$NYV_AWS_REGION" \
  --command-id "$CMD_ID" \
  --instance-id "$NYV_EC2_INSTANCE_ID" \
  --query Status --output text)
ERR=$(aws ssm get-command-invocation \
  --region "$NYV_AWS_REGION" \
  --command-id "$CMD_ID" \
  --instance-id "$NYV_EC2_INSTANCE_ID" \
  --query StandardErrorContent --output text 2>/dev/null || true)

OUT=$(printf '%s' "$RAW" | tr -d '\r\n' | grep -E '^[A-Za-z0-9+/=]+$' | tail -1 || true)

if [ "$ST" != Success ] || [ -z "$OUT" ]; then
  echo "jwt_fetch_failed status=$ST stderr=${ERR:-none}" >&2
  exit 1
fi
printf '%s' "$OUT"
