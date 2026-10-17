#!/usr/bin/env bash
# NV-HC-MIRROR-P1-001 probe3 — PDF magic-byte check + judgment-key fallback + case_api code discovery.
set -uo pipefail
CNR="${1:-APHC010000832023}"
cd /opt/nyv/api || exit 1
echo "=== NV-HC-ORDER-MIRROR-P1-PROBE3 $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

KEY=""
pid=$(pgrep -f 'uvicorn.*8090' | head -1 || true)
[ -n "$pid" ] && [ -r "/proc/$pid/environ" ] && KEY=$(tr '\0' '\n' < "/proc/$pid/environ" | grep '^CASE_API_API_KEYS=' | head -1 | cut -d= -f2- | cut -d, -f1)
fn=""
if [ "$(printf %s "$KEY" | wc -c)" -gt 8 ]; then
  fn=$(curl -sS --max-time 60 -H "X-API-Key: $KEY" "http://127.0.0.1:8090/v1/cases/${CNR}" 2>/dev/null \
    | python3 -c "import json,sys; c=json.load(sys.stdin).get('case') or {}; fo=c.get('final_orders') or []; print((fo[0].get('filename') or '') if fo else '')" 2>/dev/null || true)
fi
fn="${fn#/}"
base=$(basename "${fn:-none.pdf}")
rel="${fn:-orders/2023/${base}}"
echo "order_rel_len=$(printf %s "$rel" | wc -c | tr -d ' ') base_len=$(printf %s "$base" | wc -c | tr -d ' ')"

probe_pdf() {
  local label="$1" url="$2"
  local tmp; tmp=$(mktemp)
  local code bytes magic
  code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 30 -L "$url" 2>/dev/null || echo ERR)
  bytes=$(wc -c < "$tmp" | tr -d ' ')
  magic=$(head -c 5 "$tmp" 2>/dev/null | od -An -tx1 | tr -d ' \n')
  echo "fetch label=$label http=$code bytes=$bytes magic_hex=${magic:-empty}"
  rm -f "$tmp"
}

probe_pdf "display_pdf" "https://hcservices.ecourts.gov.in/hcservices/cases/display_pdf.php?filename=${rel}"
probe_pdf "main_php" "https://hcservices.ecourts.gov.in/hcservices/main.php?filename=${rel}"
probe_pdf "direct_orders" "https://hcservices.ecourts.gov.in/hcservices/${rel}"

echo "=== owned HC judgment keys for CNR (list, max 5) ==="
for bucket in ns-indian-highcourt-judgements-2 ns-highcourt-data-bucket; do
  n=$(aws s3api list-objects-v2 --bucket "$bucket" --prefix "data/pdf/" --max-items 2000 2>/dev/null \
    | python3 -c "import json,sys; cnr=sys.argv[1]; d=json.load(sys.stdin); print(sum(1 for x in d.get('Contents') or [] if cnr in x.get('Key','')))" "$CNR" 2>/dev/null || echo 0)
  echo "s3_judgment_hits bucket=$bucket cnr_in_key_count=$n"
done

echo "=== case_api tree: order pdf helpers (grep, no secrets) ==="
for root in /opt/nyv/case_api /opt/nyv/api/case_api /home/ubuntu/case_api; do
  [ -d "$root" ] || continue
  echo "root=$root"
  grep -R -l -E 'display_pdf|final_orders|interim_orders|orders/' "$root" 2>/dev/null | head -8 | while read -r f; do echo "  file=${f#$root/}"; done
done

echo "=== nysapi timeline doc_url sample ==="
if [ "$(printf %s "$KEY" | wc -c)" -gt 8 ]; then
  tmp=$(mktemp)
  code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 60 -H "X-API-Key: $KEY" \
    "http://127.0.0.1:8090/v1/cases/${CNR}/timeline" 2>/dev/null || echo ERR)
  python3 - "$code" "$tmp" <<'PY'
import json, sys
code, path = sys.argv[1], sys.argv[2]
d = json.load(open(path))
items = d.get("timeline") or d.get("items") or []
with_doc = [x for x in items if isinstance(x, dict) and x.get("doc_url")]
print(f"timeline_http={code} items={len(items)} with_doc_url={len(with_doc)}")
for x in with_doc[:2]:
    u = x.get("doc_url") or ""
    print(f"  doc_url_len={len(u)} kind={x.get('kind')!r} tail={u[-40:]!r}")
PY
  rm -f "$tmp"
fi
echo "=== DONE ==="
