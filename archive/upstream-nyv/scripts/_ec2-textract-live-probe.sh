#!/usr/bin/env bash
# NV-TEXTRACT-LIVE-PROBE-001 — docparse job + gateway logs (no secret echo).
set -euo pipefail
DEP="$(cat /opt/Nyayavigya/CURRENT_DEPLOY)"
DEST="/opt/Nyayavigya/repo/${DEP}"
LIVE_DIR="$(find "$DEST" -maxdepth 2 -type d -name 'nyayavigya-platform-312' | head -1)"
[ -n "$LIVE_DIR" ] || LIVE_DIR="$DEST"
ENVF="$LIVE_DIR/.env"
PDF="$LIVE_DIR/packages/docparse-sdk/test/fixtures/type_CAUSE_LIST.pdf"
if [ ! -f "$PDF" ]; then
  PDF="$LIVE_DIR/packages/docparse-sdk/test/fixtures/type_FILING_RECEIPT.pdf"
fi
[ -f "$PDF" ] || { echo "FATAL missing fixture PDF"; exit 1; }

echo "=== TEXTRACT LIVE PROBE ==="
echo "LIVE_DIR=$LIVE_DIR"
echo "fixture=$(basename "$PDF") bytes=$(wc -c < "$PDF")"
echo "NYV_F_TEXTRACT=$(docker exec nyv-gateway printenv NYV_F_TEXTRACT 2>/dev/null || echo unset)"
echo "NYV_F_DOCPARSE_SDK=$(grep -E '^NYV_F_DOCPARSE_SDK=' "$ENVF" | head -1 | sed 's/=.*$/=<set>/')"

NSP_KEY="$(grep -E '^NYV_SDK_KEY_NSP=' "$ENVF" | head -1 | sed 's/^NYV_SDK_KEY_NSP=//; s/^"//; s/"$//; s/^'\''//; s/'\''$//')"
echo "NSP_key_len=${#NSP_KEY}"
[ "${#NSP_KEY}" -gt 20 ] || { echo "FATAL NSP key missing in .env"; exit 1; }

PNG="/tmp/jrx-docparse-probe-page.png"
rm -f "$PNG"
pdftoppm -png -f 1 -l 1 -singlefile "$PDF" /tmp/jrx-docparse-probe-page
[ -f "$PNG" ] || { echo "FATAL rasterize $PDF"; exit 1; }
echo "raster_png_bytes=$(wc -c < "$PNG")"
python3 - <<PY
import base64, json
from pathlib import Path
png = Path("$PNG").read_bytes()
payload = {
  "fileName": "cause-list-page1.png",
  "mimeType": "image/png",
  "base64": base64.standard_b64encode(png).decode("ascii"),
  "domainPackId": "legal-in",
  "forceOcr": True,
  "preferOcr": True,
  "maxPagesPerDoc": 1,
}
Path("/tmp/jrx-textract-job-body.json").write_text(json.dumps(payload))
print("job_body_bytes=", Path("/tmp/jrx-textract-job-body.json").stat().st_size)
PY

JOB_HTTP="$(curl -sS -o /tmp/jrx-textract-job.json -w '%{http_code}' \
  -H "Authorization: Bearer ${NSP_KEY}" \
  -H "Content-Type: application/json" \
  -d @/tmp/jrx-textract-job-body.json \
  http://127.0.0.1:5000/api/jrx/v1/sdk/docparse/jobs)"
echo "POST_jobs http=${JOB_HTTP}"
python3 - <<'PY'
import json
p="/tmp/jrx-textract-job.json"
try:
  d=json.load(open(p))
except Exception:
  print("job_body=invalid_json")
  raise SystemExit(0)
data=d.get("data") or {}
print("jobId=", data.get("jobId"), "status=", data.get("status"))
PY

JOB_ID="$(python3 -c 'import json; print(json.load(open("/tmp/jrx-textract-job.json")).get("data",{}).get("jobId",""))')"
[ -n "$JOB_ID" ] || { echo "FATAL no jobId"; exit 1; }

JOB_ST=""
for i in $(seq 1 36); do
  sleep 5
  curl -sS -H "Authorization: Bearer ${NSP_KEY}" \
    "http://127.0.0.1:5000/api/jrx/v1/sdk/docparse/jobs/${JOB_ID}" \
    -o /tmp/jrx-textract-job-status.json
  JOB_ST="$(python3 - <<'PY'
import json
d=json.load(open("/tmp/jrx-textract-job-status.json"))
data=d.get("data") or {}
st=data.get("status") or "unknown"
err=data.get("error")
print(st)
if err:
  print("error=", str(err)[:200])
if st == "done":
  r=data.get("result") or {}
  meta=r.get("meta") or r.get("docparseMeta") or {}
  ocr=meta.get("ocr") or meta.get("cloudOcr") or {}
  print("result_keys=", sorted(list(r.keys()))[:12])
  if isinstance(ocr, dict):
    print("ocr_provider=", ocr.get("provider") or ocr.get("lastProvider"))
  docs=r.get("documents") or r.get("docs") or []
  if docs and isinstance(docs[0], dict):
    d0=docs[0]
    print("doc0_text_len=", len(str(d0.get("text") or d0.get("plainText") or "")))
PY
)"
  echo "poll_${i}:"
  echo "$JOB_ST"
  echo "$JOB_ST" | head -1 | grep -qx 'done' && break
  echo "$JOB_ST" | head -1 | grep -qx 'failed' && break
done

echo "=== GATEWAY LOG GREP (textract, last 15m) ==="
docker logs nyv-gateway --since 15m 2>&1 \
  | grep -iE 'textract|aws-textract' \
  | tail -20 \
  | sed -E 's/(Bearer|api[_-]?key|NYV_SDK_KEY)[^ ]*/[REDACTED]/gi' \
  || echo "log_grep=no_textract_lines"

echo "=== PROBE COMPLETE ==="
