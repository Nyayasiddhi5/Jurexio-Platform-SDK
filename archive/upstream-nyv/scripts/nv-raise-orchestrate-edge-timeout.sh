#!/usr/bin/env bash
# NV-EDGE-ORCH-TIMEOUT-001 — raise ALB idle timeout + reload Caddy with long
# orchestrate upstream. SDK keys unchanged.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
source scripts/jrx-source-dev-deploy-env.sh 2>/dev/null || true

REGION="${NYV_AWS_REGION:-ap-south-1}"
ALB_NAME="${NYV_DEV_EDGE_ALB_NAME:-nyv-dev-edge-alb}"
IDLE_SEC="${NYV_ALB_IDLE_TIMEOUT_SEC:-600}"

echo "=== NV-EDGE-ORCH-TIMEOUT-001 ==="
echo "Region: $REGION  ALB: $ALB_NAME  idle_timeout: ${IDLE_SEC}s"

if command -v aws >/dev/null 2>&1; then
  ARN=$(aws elbv2 describe-load-balancers --region "$REGION" \
    --query "LoadBalancers[?LoadBalancerName=='${ALB_NAME}'].LoadBalancerArn | [0]" \
    --output text 2>/dev/null || echo "")
  if [[ -n "$ARN" && "$ARN" != "None" ]]; then
    CUR=$(aws elbv2 describe-load-balancer-attributes --region "$REGION" \
      --load-balancer-arn "$ARN" \
      --query "Attributes[?Key=='idle_timeout.timeout_seconds'].Value | [0]" \
      --output text 2>/dev/null || echo "?")
    echo "ALB current idle_timeout: ${CUR}s"
    aws elbv2 modify-load-balancer-attributes --region "$REGION" \
      --load-balancer-arn "$ARN" \
      --attributes "Key=idle_timeout.timeout_seconds,Value=${IDLE_SEC}" >/dev/null \
      && echo "ALB idle_timeout set → ${IDLE_SEC}s" \
      || echo "WARN: ALB modify failed (check IAM); Caddy-only fix may still help"
  else
    echo "WARN: ALB ${ALB_NAME} not found — skip ALB bump"
  fi
else
  echo "WARN: aws CLI not available — skip ALB bump"
fi

echo ""
echo "=== EC2: patch edge timeouts (console nginx + optional Caddy) ==="
COMBINED="$(mktemp)"
PATCH_B64=$(base64 < scripts/_patch-caddy-orchestrate-timeout.py | tr -d '\n')
{
  echo "#!/usr/bin/env bash"
  echo "set -euo pipefail"
  echo "PATCH_PY=/tmp/_patch-caddy-orchestrate-timeout.py"
  echo "echo \"$PATCH_B64\" | base64 -d > \"\$PATCH_PY\""
  echo "export PATCH_PY"
  cat scripts/_ec2-reload-caddy-orchestrate-timeout.sh
  echo ""
  cat scripts/_ec2-reload-console-orchestrate-timeout.sh
} > "$COMBINED"
chmod +x "$COMBINED"

bash scripts/jrx-ec2-ssm-run.sh "$COMBINED" "./jrx-edge-orch-timeout"
rm -f "$COMBINED"
