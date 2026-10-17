#!/usr/bin/env bash
set -uo pipefail
ROOT=/home/ubuntu/scripts/case_api
grep -R -n -E 'display_pdf|hcservices\.ecourts|fetch.*order|order.*download' "$ROOT/app" "$ROOT/build" 2>/dev/null | head -50
echo "--- middleware auth ---"
grep -n -E 'API.?Key|CASE_API|auth|middleware' "$ROOT/app/main.py" | head -30
echo "--- probe display_pdf one order ---"
rel="orders/2023/202100000622023_12.pdf"
for u in \
  "https://hcservices.ecourts.gov.in/hcservices/cases/display_pdf.php?filename=${rel}" \
  "https://hcservices.ecourts.gov.in/hcservices/cases/display_pdf.php?filename=/orders/2023/202100000622023_12.pdf"
do
  tmp=$(mktemp)
  code=$(curl -sS -o "$tmp" -w '%{http_code}' -L --max-time 25 -A 'Mozilla/5.0' "$u" || echo ERR)
  bytes=$(wc -c < "$tmp" | tr -d ' ')
  magic=$(head -c 4 "$tmp" | xxd -p 2>/dev/null || true)
  body_head=$(head -c 80 "$tmp" | tr '\n' ' ')
  echo "url_tail=${u: -60} http=$code bytes=$bytes magic=$magic body_head=${body_head:0:60}"
  rm -f "$tmp"
done
# check local cached order pdfs
find /home/ubuntu /opt -maxdepth 6 -type f -name '*202100000622023_12.pdf' 2>/dev/null | head -5
echo DONE
