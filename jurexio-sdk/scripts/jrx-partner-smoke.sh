#!/usr/bin/env bash
# JRX partner smoke — local gateway or SSM on Jurexio EC2. Logs HTTP codes + latency only (NV-SECRETS-001).
set -euo pipefail

NV_TARGET="${NV_TARGET:-local}"
JRX_EC2_INSTANCE_ID="${JRX_EC2_INSTANCE_ID:-i-0fb470b236c14405b}"
JRX_AWS_REGION="${JRX_AWS_REGION:-ap-south-1}"
JRX_SECRETS_FILE="${JRX_SECRETS_FILE:-/opt/Jurexio/secrets/.env.production}"
JRX_SMOKE_BASE_URL="${JRX_SMOKE_BASE_URL:-http://127.0.0.1:5000}"

JRX_FORBIDDEN_EC2="i-0df71e5ea1df8f588"
if [ "$JRX_EC2_INSTANCE_ID" = "$JRX_FORBIDDEN_EC2" ]; then
  echo "Refusing forbidden EC2 deploy target." >&2
  exit 3
fi

# Remote script executed on EC2 (localhost gateway + canonical secrets).
JRX_PARTNER_REMOTE_SCRIPT='#!/usr/bin/env bash
set -uo pipefail
CANON="${JRX_SECRETS_FILE:-/opt/Jurexio/secrets/.env.production}"
BASE="http://127.0.0.1:5000"
NSPK="$(grep -E "^JRX_SDK_KEY_NSP=" "$CANON" 2>/dev/null | head -1 | cut -d= -f2- | tr -d "\r\n\"'"'"'")"
KEY_LEN="$(printf %s "$NSPK" | wc -c | tr -d " ")"
echo "key_lens JRX_SDK_KEY_NSP=${KEY_LEN}"
probe() {
  local id="$1" method="$2" path="$3" auth="$4"
  local url="${BASE}${path}"
  local code time_ms
  if [ "$method" = GET ]; then
    if [ "$auth" = with_key ] && [ "$KEY_LEN" -ge 16 ]; then
      read -r code time_ms < <(curl -sS -m 30 -o /dev/null -w "%{http_code} %{time_total}" -H "X-API-Key: ${NSPK}" -H "X-JRX-Platform: nsp" "$url" 2>/dev/null || echo "000 0")
    elif [ "$auth" = with_key ]; then
      echo "${id} SKIP no_key"
      return 0
    else
      read -r code time_ms < <(curl -sS -m 30 -o /dev/null -w "%{http_code} %{time_total}" "$url" 2>/dev/null || echo "000 0")
    fi
  else
    echo "${id} SKIP post_not_in_smoke"
    return 0
  fi
  time_ms="$(awk "BEGIN {printf \"%.0f\", ${time_ms} * 1000}")"
  echo "${id} http=${code} ms=${time_ms}"
}
probe health GET /api/jrx/health none
probe cnr-health GET /api/jrx/v1/sdk/cnr/health with_key
probe llm-health GET /api/jrx/v1/sdk/llm/router/health with_key
probe gw-models GET /api/jrx/gateway/models with_key
probe legal-feed GET "/api/jrx/v1/sdk/legal-intelligence/feed?jurisdiction=IN" with_key
probe patra-health GET /api/jrx/v1/sdk/patra-mitra/health with_key
probe docparse-health GET /api/jrx/v1/sdk/docparse/health with_key
probe jrx-docparse GET /api/jrx/v1/sdk/jrx/docparse/health with_key
'

run_local_probes() {
  local base="${JRX_SMOKE_BASE_URL%/}"
  local nspk="${JRX_SDK_KEY_NSP:-${JRX_SDK_KEY:-}}"
  local key_len
  key_len="$(printf %s "$nspk" | wc -c | tr -d ' ')"
  echo "key_lens JRX_SDK_KEY_NSP=${key_len}"

  probe() {
    local id="$1" method="$2" path="$3" auth="$4"
    local url="${base}${path}"
    local code time_ms
    if [ "$method" != GET ]; then
      echo "${id} SKIP post_not_in_smoke"
      return 0
    fi
    if [ "$auth" = with_key ] && [ "$key_len" -ge 16 ]; then
      read -r code time_ms < <(curl -sS -m 30 -o /dev/null -w '%{http_code} %{time_total}' \
        -H "X-API-Key: ${nspk}" -H "X-JRX-Platform: nsp" "$url" 2>/dev/null || echo '000 0')
    elif [ "$auth" = with_key ]; then
      echo "${id} SKIP no_key"
      return 0
    else
      read -r code time_ms < <(curl -sS -m 30 -o /dev/null -w '%{http_code} %{time_total}' "$url" 2>/dev/null || echo '000 0')
    fi
    time_ms="$(awk "BEGIN {printf \"%.0f\", ${time_ms} * 1000}")"
    echo "${id} http=${code} ms=${time_ms}"
    if [ "$auth" = none ] && [ "$code" != 200 ]; then return 1; fi
    if [ "$auth" = with_key ] && [ "$key_len" -ge 16 ] && [ "$code" != 200 ] && [ "$code" != 401 ] && [ "$code" != 403 ]; then
      return 1
    fi
    return 0
  }

  local fail=0
  probe health GET /api/jrx/health none || fail=1
  probe cnr-health GET /api/jrx/v1/sdk/cnr/health with_key || fail=1
  probe llm-health GET /api/jrx/v1/sdk/llm/router/health with_key || fail=1
  probe gw-models GET /api/jrx/gateway/models with_key || fail=1
  probe legal-feed GET "/api/jrx/v1/sdk/legal-intelligence/feed?jurisdiction=IN" with_key || fail=1
  probe patra-health GET /api/jrx/v1/sdk/patra-mitra/health with_key || fail=1
  probe docparse-health GET /api/jrx/v1/sdk/docparse/health with_key || fail=1
  probe jrx-docparse GET /api/jrx/v1/sdk/jrx/docparse/health with_key || fail=1
  return "$fail"
}

run_ec2_probes() {
  command -v aws >/dev/null 2>&1 || { echo "aws cli required for NV_TARGET=ec2" >&2; exit 1; }
  local remote_b64
  if printf '' | base64 -w0 >/dev/null 2>&1; then
    remote_b64="$(printf '%s' "$JRX_PARTNER_REMOTE_SCRIPT" | base64 -w0)"
  else
    remote_b64="$(printf '%s' "$JRX_PARTNER_REMOTE_SCRIPT" | base64 | tr -d '\n')"
  fi
  local params
  params="$(jq -n --arg cmd "echo ${remote_b64} | base64 -d | bash" '{commands: [$cmd]}')"
  local cmd_id
  cmd_id="$(aws ssm send-command --region "$JRX_AWS_REGION" --instance-ids "$JRX_EC2_INSTANCE_ID" \
    --document-name AWS-RunShellScript --parameters "$params" \
    --query Command.CommandId --output text)"
  aws ssm wait command-executed --region "$JRX_AWS_REGION" --command-id "$cmd_id" \
    --instance-id "$JRX_EC2_INSTANCE_ID" 2>/dev/null || true
  aws ssm get-command-invocation --region "$JRX_AWS_REGION" --command-id "$cmd_id" \
    --instance-id "$JRX_EC2_INSTANCE_ID" --query StandardOutputContent --output text
  local status
  status="$(aws ssm get-command-invocation --region "$JRX_AWS_REGION" --command-id "$cmd_id" \
    --instance-id "$JRX_EC2_INSTANCE_ID" --query Status --output text)"
  if [ "$status" != Success ]; then
    echo "SSM status=${status}" >&2
    return 1
  fi
  return 0
}

echo "==> jrx-partner-smoke target=${NV_TARGET} instance=${JRX_EC2_INSTANCE_ID}"
case "$NV_TARGET" in
  local) run_local_probes ;;
  ec2)   run_ec2_probes ;;
  *) echo "unknown NV_TARGET=$NV_TARGET (use local|ec2)" >&2; exit 2 ;;
esac
echo "==> jrx-partner-smoke done"
