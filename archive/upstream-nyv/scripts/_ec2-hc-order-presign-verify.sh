#!/usr/bin/env bash
# NV-HC-MIRROR-P1-001 verify — resolve presign + ranged GET (no secret echo).
set -uo pipefail
CNR="${1:-APHC010000832023}"
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"
read_canon_key() {
  grep -E "^${1}=" "$CANON" 2>/dev/null | head -1 | cut -d= -f2- \
    | sed -E 's/^[[:space:]"'\'' ]+//; s/[[:space:]"'\'' ]+$//; s/\r$//'
}
NSPK="$(read_canon_key NYV_SDK_KEY_NSP)"
echo "=== HC ORDER PRESIGN VERIFY cnr=$CNR $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "nsp_key_len=$(printf %s "$NSPK" | wc -c | tr -d ' ')"
tmp=$(mktemp)
code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 120 -X POST \
  -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" -H "Content-Type: application/json" \
  -d "{\"identifier\":\"${CNR}\",\"profile\":\"caseCreate\",\"includeTimeline\":false,\"includeDocuments\":true}" \
  "$API/api/jrx/v1/sdk/cnr/resolve" 2>/dev/null || echo ERR)
python3 - "$code" "$tmp" <<'PY'
import json, sys, urllib.request
code, path = sys.argv[1], sys.argv[2]
d = json.load(open(path))
data = d.get("data") or {}
fields = data.get("fields") or {}
docs = data.get("documents") or []
fo = (fields.get("finalOrders") or {}).get("value") or []
presigned_orders = [r for r in fo if isinstance(r, dict) and r.get("presignedUrl")]
order_docs = [x for x in docs if isinstance(x, dict) and x.get("kind") == "order" and x.get("pdfUrlKind") == "presigned"]
print(f"resolve_http={code} status={data.get('status')}")
print(f"finalOrders={len(fo)} with_presignedUrl={len(presigned_orders)} order_documents={len(order_docs)}")
url = None
if presigned_orders:
    url = presigned_orders[0].get("presignedUrl")
elif order_docs:
    url = order_docs[0].get("url")
if url:
    req = urllib.request.Request(url, headers={"Range": "bytes=0-1023"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read(8)
            print(f"ranged_get_http={resp.status} bytes={len(body)} pdf_magic={body[:4]==b'%PDF'}")
    except Exception as e:
        print(f"ranged_get_err={type(e).__name__}")
else:
    print("presign_active=N")
PY
rm -f "$tmp"
ADM="$(docker exec nyv-gateway printenv DATABASE_URL_ADMIN 2>/dev/null || true)"; ADM="${ADM%\"}"; ADM="${ADM#\"}"
ADM="$(echo "$ADM" | sed -E 's/sslmode=no-verify/sslmode=require/; s/sslmode=verify-full/sslmode=require/')"
if [ -n "$ADM" ]; then
  map_n=$(docker run --rm --network host -e PGURL="$ADM" postgres:16-alpine \
    sh -c 'psql "$PGURL" -At -c "SELECT COUNT(*) FROM public.nv_hc_order_s3_map;"' 2>/dev/null || echo ERR)
  echo "map_row_count=${map_n}"
fi
echo "=== DONE ==="
