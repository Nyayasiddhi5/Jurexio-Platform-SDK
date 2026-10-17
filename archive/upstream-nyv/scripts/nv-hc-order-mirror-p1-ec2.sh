#!/usr/bin/env bash
# Push + run HC order mirror P1 on caselaw-worker via SSM.
# Usage: cd nyayavigya-platform-312 && bash scripts/jrx-hc-order-mirror-p1-ec2.sh [CNR] [apply:0|1]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CNR="${1:-APHC010000832023}"
APPLY="${2:-0}"
export NV_HC_MIRROR_APPLY="$APPLY"

# Embed latest script into run payload
RUN="$(mktemp)"
{
  echo '#!/usr/bin/env bash'
  echo "export NV_HC_MIRROR_APPLY=${APPLY}"
  echo "export CNR=${CNR}"
  cat "$ROOT/scripts/_ec2-hc-order-mirror-p1-run.sh" | tail -n +2
  echo 'bash _inner_run.sh "$CNR"'
} > "$RUN"

# Simpler: base64 the mjs + runner
B64_MJS=$(base64 < "$ROOT/scripts/jrx-hc-order-mirror-p1.mjs" | tr -d '\n')
B64_RUN=$(base64 < "$ROOT/scripts/_ec2-hc-order-mirror-p1-run.sh" | tr -d '\n')

PAYLOAD="$(mktemp)"
cat > "$PAYLOAD" <<EOF
#!/usr/bin/env bash
set -euo pipefail
echo "$B64_MJS" | base64 -d > /tmp/jrx-hc-order-mirror-p1.mjs
echo "$B64_RUN" | base64 -d > /tmp/_ec2-hc-order-mirror-p1-run.sh
chmod +x /tmp/_ec2-hc-order-mirror-p1-run.sh
export NV_HC_MIRROR_APPLY=${APPLY}
bash /tmp/_ec2-hc-order-mirror-p1-run.sh ${CNR}
EOF

bash "$ROOT/scripts/_nys-ssm-run.sh" "$PAYLOAD" "./jrx-hc-mirror-p1-${CNR}-${APPLY}"
rm -f "$RUN" "$PAYLOAD"
