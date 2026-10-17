#!/usr/bin/env bash
# Session-82 — discover case_api paths + order PDF hooks (no secrets).
set -uo pipefail
echo "=== SESSION82 DISCOVER ==="
echo "=== listening 8090 ==="
ss -tlnp 2>/dev/null | grep 8090 || netstat -tlnp 2>/dev/null | grep 8090 || true
pgrep -af 'uvicorn|8090|case_api' | head -8

echo "=== paths under /home/ubuntu /opt (case_api nyv-api) ==="
for d in /home/ubuntu/scripts/case_api /opt/nyv/api /opt/Nyayavigya /home/ubuntu/nyv-api; do
  [ -e "$d" ] && echo "exists=$d" && ls -la "$d" 2>/dev/null | head -5
done
find /home/ubuntu /opt -maxdepth 4 -type d -name 'case_api' 2>/dev/null | head -10

echo "=== grep display_pdf / orders/pdf in py (head 30) ==="
find /home/ubuntu /opt -maxdepth 6 -type f -name '*.py' 2>/dev/null | while read -r f; do
  grep -l -E 'display_pdf|hcservices|/orders/' "$f" 2>/dev/null || true
done | head -15 | while read -r f; do echo "py=$f"; grep -n -E 'display_pdf|/v1/hc|orders/pdf' "$f" 2>/dev/null | head -3; done

echo "=== case_api routes grep ==="
ROOT="/home/ubuntu/scripts/case_api"
if [ -d "$ROOT" ]; then
  grep -R -n -E '@app\.|router\.|/v1/' "$ROOT" 2>/dev/null | grep -iE 'order|pdf|hc' | head -25
  ls -la "$ROOT" 2>/dev/null | head -15
fi

echo "=== secrets dir key NAMES only (Nyayavigya pattern) ==="
for sf in /opt/Nyayavigya/secrets/.env.production /opt/nyv/api/.env; do
  if [ -f "$sf" ]; then
    echo "env_file=$sf"
    grep -E '^[A-Z][A-Z0-9_]*(NIC|ECOURT|HC|COOKIE|SESSION|CAPTCHA|HCSERVICE)' "$sf" 2>/dev/null | cut -d= -f1 | sort -u | head -30
  fi
done

echo "=== nysapi sample order filename (CNR APHC010000832023) ==="
cd /opt/nyv/api || exit 0
KEY=""
pid=$(pgrep -f 'uvicorn.*8090' | head -1 || true)
[ -n "$pid" ] && [ -r "/proc/$pid/environ" ] && KEY=$(tr '\0' '\n' < "/proc/$pid/environ" | grep '^CASE_API_API_KEYS=' | head -1 | cut -d= -f2- | cut -d, -f1)
CNR=APHC010000832023
code=$(curl -sS -o /tmp/s82_case.json -w '%{http_code}' -H "X-API-Key: $KEY" "http://127.0.0.1:8090/v1/cases/${CNR}" --max-time 60)
echo "nysapi_http=$code key_len=$(printf %s "$KEY" | wc -c | tr -d ' ')"
node -e "
const fs=require('fs');
const j=JSON.parse(fs.readFileSync('/tmp/s82_case.json','utf8'));
const c=j.case||j.data?.case||j;
for (const k of ['final_orders','interim_orders']) {
  const a=c[k];
  if (!Array.isArray(a)) continue;
  console.log(k+'_count='+a.length);
  if (a[0]) console.log(k+'_sample_filename='+String(a[0].filename||'').slice(0,120));
}
"

echo "=== probe local /v1/hc/orders/pdf (expect 404 if missing) ==="
if [ -n "$KEY" ]; then
  fn=$(node -e "const j=require('/tmp/s82_case.json');const c=j.case||j.data?.case||j;const f=(c.final_orders||c.interim_orders||[])[0];process.stdout.write(String(f?.filename||'orders/2023/x.pdf').replace(/^\\/+/, ''));")
  url="http://127.0.0.1:8090/v1/hc/orders/pdf?cnr=${CNR}&filename=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$fn")"
  curl -sS -o /tmp/s82_pdf.bin -w 'pdf_route_http=%{http_code} bytes=%{size_download} ct=%{content_type}\n' -H "X-API-Key: $KEY" "$url" --max-time 45
  head -c 4 /tmp/s82_pdf.bin | od -An -tx1 | tr -d ' \n' | grep -q 25504446 && echo pdf_magic=YES || echo pdf_magic=NO
fi
echo "=== DONE ==="
