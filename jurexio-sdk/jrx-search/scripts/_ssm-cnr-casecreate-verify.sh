#!/usr/bin/env bash
set -euo pipefail
ENV=/opt/nyv/api/.env
if ! grep -q '^ATHENA_TABLE_HC_CASE_DETAILS=' "$ENV" 2>/dev/null; then
  echo 'ATHENA_TABLE_HC_CASE_DETAILS=judgments_meta_hc_case_details' >> "$ENV"
fi
grep '^ATHENA_TABLE_HC_CASE_DETAILS=' "$ENV" | tail -1
cd /opt/nyv/api
set -a && source "$ENV" && set +a
systemctl is-active nyv-api
md5sum index.mjs | awk '{print "index_md5="$1}'
KEY=$(grep -E '^NYS_SDK_API_KEYS=' "$ENV" | head -1 | cut -d= -f2- | cut -d, -f1 | tr -d "\"'")
curl -sf -m 90 -X POST -H 'Content-Type: application/json' -H "X-API-Key: ${KEY}" \
  -d '{"cnr":"RJHC010324382023","options":{"profile":"caseCreate","includeDocuments":false,"includeExtractPreview":false}}' \
  http://127.0.0.1:8080/api/cnr/resolve > /tmp/cnr-cc.json
python3 - <<'PY'
import json
d = json.load(open("/tmp/cnr-cc.json"))
data = d.get("data") or {}
cc = data.get("caseCreate")
print("success", d.get("success"), "status", data.get("status"), "source", data.get("source"))
print("caseCreate", "yes" if cc else "no")
if cc:
    print("timeline_len", len(cc.get("timeline") or []))
    print("title", (cc.get("header") or {}).get("caseTitle", {}).get("value"))
    fm = cc.get("fieldManifest") or {}
    print("manifest_complete", fm.get("complete"))
print("sourcesTried", data.get("sourcesTried"))
PY
