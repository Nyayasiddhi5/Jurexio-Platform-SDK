#!/usr/bin/env bash
# Ship updated LC5–LC8 Playwright script to nysdev and run (password stays on EC2).
set -euo pipefail
APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UAT_SCRIPT="$APP_ROOT/scripts/jrx-uat-lc5-lc8-browser.mjs"
[ -f "$UAT_SCRIPT" ] || { echo "missing $UAT_SCRIPT" >&2; exit 2; }

if [ -f "$APP_ROOT/scripts/jrx-source-dev-deploy-env.sh" ] && [ -f "$APP_ROOT/../product Documents/env.production" ]; then
  # shellcheck disable=SC1091
  source "$APP_ROOT/scripts/jrx-source-dev-deploy-env.sh"
else
  set -a
  # shellcheck disable=SC1091
  source "$APP_ROOT/.env"
  set +a
  export NYV_AWS_REGION="${NYV_AWS_REGION:-${AWS_REGION:-ap-south-1}}"
  export NYV_EC2_INSTANCE_ID="${NYV_EC2_INSTANCE_ID:-i-0df71e5ea1df8f588}"
fi

UAT_B64=$(base64 < "$UAT_SCRIPT" | tr -d '\n')
REMOTE_SCRIPT=$(mktemp)
python3 - "$REMOTE_SCRIPT" "$UAT_B64" <<'PY'
import pathlib
import sys

out = pathlib.Path(sys.argv[1])
uat_b64 = sys.argv[2]
out.write_text(f"""#!/usr/bin/env bash
set -euo pipefail
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"
CANON="/opt/Nyayavigya/secrets/.env.production"
export UAT_ADMIN_EMAIL="${{UAT_ADMIN_EMAIL:-admin@nyayavigya.in}}"
export UAT_ADMIN_PASSWORD="$(grep -E '^NV_DEMO_PASSWORD=' "$CANON" | head -1 | cut -d= -f2- | tr -d '"\\'' | tr -d '\\r\\n')"
export CONSOLE_URL="${{CONSOLE_URL:-https://console.nyayasiddhi.online}}"
export GATEWAY="${{GATEWAY:-https://api.nyayasiddhi.online}}"
export UAT_SSE_WAIT_MS="${{UAT_SSE_WAIT_MS:-240000}}"
WORKDIR="/tmp/jrx-lc-uat-$$"
mkdir -p "$WORKDIR"
trap 'rm -rf "$WORKDIR"' EXIT
echo '{uat_b64}' | base64 -d > "$WORKDIR/jrx-uat-lc5-lc8-browser.mjs"
cd "$WORKDIR"
if [ ! -d node_modules/@playwright/test ]; then
  /usr/local/bin/npm init -y >/dev/null 2>&1
  /usr/local/bin/npm install @playwright/test@1.59.1 --silent 2>/dev/null
  /usr/local/bin/npx playwright install chromium 2>/dev/null || true
fi
/usr/local/bin/node nv-uat-lc5-lc8-browser.mjs
RC=$?
echo "=== LC_UAT_EXIT=$RC ==="
exit "$RC"
""")
PY

B64_REMOTE=$(base64 < "$REMOTE_SCRIPT" | tr -d '\n')
rm -f "$REMOTE_SCRIPT"

COMMENT="lc5-lc8-browser-uat-$(date -u +%Y%m%dT%H%M%SZ)"
CMD_ID=$(aws ssm send-command \
  --region "$NYV_AWS_REGION" \
  --instance-ids "$NYV_EC2_INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --comment "$COMMENT" \
  --parameters "commands=[\"echo $B64_REMOTE | base64 -d | bash\"]" \
  --query Command.CommandId --output text)

echo "SSM command_id=$CMD_ID instance=$NYV_EC2_INSTANCE_ID (LC5–LC8 browser UAT)"

for _ in $(seq 1 180); do
  st=$(aws ssm get-command-invocation \
    --region "$NYV_AWS_REGION" \
    --command-id "$CMD_ID" \
    --instance-id "$NYV_EC2_INSTANCE_ID" \
    --query Status --output text 2>/dev/null || echo Pending)
  case "$st" in Success|Failed|Cancelled|TimedOut) break ;; *) sleep 5 ;; esac
done

aws ssm get-command-invocation \
  --region "$NYV_AWS_REGION" \
  --command-id "$CMD_ID" \
  --instance-id "$NYV_EC2_INSTANCE_ID" \
  --query '[Status,StandardOutputContent,StandardErrorContent]' \
  --output text
