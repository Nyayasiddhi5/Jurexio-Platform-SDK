#!/usr/bin/env bash
# Local wrapper: source gitignored keys, inject PATCH_B64, run EC2 SSM script. Never prints values.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
SECRETS="${JRX_DEMO_KEYS_FILE:-$ROOT/../.local/secrets/demo-keys-20260821.env}"
EC2_SCRIPT="$ROOT/scripts/_ec2-go-keys-demo-routing.sh"
TMP="$(mktemp /tmp/jrx-ec2-go-XXXXXX.sh)"
trap 'rm -f "$TMP"' EXIT

if [[ ! -f "$SECRETS" ]]; then
  echo "missing secrets file: $SECRETS" >&2
  exit 1
fi

if printf '' | base64 -w0 >/dev/null 2>&1; then
  PATCH_B64=$(base64 -w0 < "$SECRETS")
else
  PATCH_B64=$(base64 < "$SECRETS" | tr -d '\n')
fi

{
  echo "#!/usr/bin/env bash"
  echo "export PATCH_B64='${PATCH_B64}'"
  cat "$EC2_SCRIPT"
} > "$TMP"
chmod 700 "$TMP"

bash "$ROOT/scripts/jrx-ec2-ssm-run.sh" "$TMP" "go-keys-demo-routing-$(date -u +%Y%m%dT%H%M%SZ)"
