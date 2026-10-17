#!/usr/bin/env bash
# Deploy hc_order_pdf.py + main.py route hook on caselaw-worker case_api (SSM).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PATCH="$ROOT/scripts/case_api-patches/hc_order_pdf.py"
MAIN_ROUTE_SNIPPET="$ROOT/scripts/case_api-patches/main_hc_orders_pdf_route.snippet.py"
PAYLOAD="$(mktemp)"
B64_PDF=$(base64 < "$PATCH" | tr -d '\n')
B64_SNIP=$(base64 < "$MAIN_ROUTE_SNIPPET" | tr -d '\n')
PATCH_MAIN="$ROOT/scripts/case_api-patches/patch_main_hc_orders_pdf.py"
B64_PATCH_MAIN=$(base64 < "$PATCH_MAIN" | tr -d '\n')
cat > "$PAYLOAD" <<EOF
#!/usr/bin/env bash
set -euo pipefail
CASE_ROOT=/home/ubuntu/scripts/case_api
echo "$B64_PDF" | base64 -d > "\$CASE_ROOT/app/hc_order_pdf.py"
echo "$B64_SNIP" | base64 -d > /tmp/hc_orders_pdf_route.snippet.py
echo "$B64_PATCH_MAIN" | base64 -d > /tmp/hc_orders_pdf_route.patch_main.py
if grep -q 'hc/orders/pdf' "\$CASE_ROOT/app/main.py"; then
  echo route_already_present
else
  python3 /tmp/hc_orders_pdf_route.patch_main.py
fi
pid=\$(pgrep -f 'uvicorn.*8090' | head -1 || true)
ENV_FILE=/tmp/case_api_uvicorn.env
if [ -n "\$pid" ] && [ -r "/proc/\$pid/environ" ]; then
  tr '\\0' '\\n' < "/proc/\$pid/environ" | grep -E '^CASE_API_|^AWS_|^RDS_|^ATHENA_' > "\$ENV_FILE" || true
  kill "\$pid" 2>/dev/null || true
  sleep 2
fi
cd /home/ubuntu/scripts/case_api
if [ -s "\$ENV_FILE" ]; then
  set +e
  set -a
  # shellcheck disable=SC1090
  source "\$ENV_FILE" 2>/dev/null || true
  set +a
  set -e
fi
nohup ./.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8090 >> /tmp/case_api_uvicorn.log 2>&1 &
sleep 3
curl -sS -o /dev/null -w 'health_http=%{http_code}\n' http://127.0.0.1:8090/health --max-time 10 || true
echo deploy_done
EOF
bash "$ROOT/scripts/_nys-ssm-run.sh" "$PAYLOAD" "./jrx-case-api-hc-order-pdf-deploy"
rm -f "$PAYLOAD"
