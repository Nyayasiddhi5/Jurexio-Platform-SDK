#!/usr/bin/env bash
# NV-HC-MOBILE-DEPTH-TOKEN-001 — run token refetch on caselaw-worker via SSM.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CNR="${1:-APHC010000832023}"
DRY="${2:-1}"
B64=$(base64 < "$ROOT/scripts/case_api-patches/hc_mobile_depth_order_token_refetch.py" | tr -d '\n')
PAYLOAD="$(mktemp)"
cat > "$PAYLOAD" <<EOF
#!/usr/bin/env bash
set -euo pipefail
echo "$B64" | base64 -d > /tmp/hc_mobile_depth_order_token_refetch.py
KEY=\$(tr '\\0' '\\n' < "/proc/\$(pgrep -f 'uvicorn.*8090' | head -1)/environ" | grep '^CASE_API_API_KEYS=' | head -1 | cut -d= -f2- | cut -d, -f1)
export NYSAPI_API_KEY="\$KEY"
export NYSAPI_URL="http://127.0.0.1:8090"
# CASE_API_DATABASE_URL must be set in worker env for --apply
# Optional: refresh staged hcservices depth from Siddhanta (worker-owned pipeline)
if [ -x /home/ubuntu/scripts/case_api/build/refresh_hcservices_depth.sh ]; then
  echo "refresh_hcservices_depth_start"
  timeout 300 /home/ubuntu/scripts/case_api/build/refresh_hcservices_depth.sh 2>&1 | tail -20 || true
  echo "refresh_hcservices_depth_end"
fi
/home/ubuntu/scripts/case_api/.venv/bin/python3 /tmp/hc_mobile_depth_order_token_refetch.py --cnr "$CNR" $([ "$DRY" = "1" ] && echo "--dry-run" || echo "")
EOF
bash "$ROOT/scripts/_nys-ssm-run.sh" "$PAYLOAD" "./jrx-hc-mobile-depth-token-refetch"
rm -f "$PAYLOAD"
