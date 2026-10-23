#!/usr/bin/env bash
set -euo pipefail
CANON="/opt/Jurexio/secrets/.env.production"
API="https://api.jurexio.com"
NSPK=$(grep -E '^JRX_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')
curl -sf -m 90 -X POST -H "X-API-Key: ${NSPK}" -H 'X-JRX-Platform: nsp' -H 'Content-Type: application/json' \
  -d '{"cnr":"RJHC010324382023","options":{"profile":"caseCreate","includeDocuments":false,"includeExtractPreview":false}}' \
  "${API}/api/jrx/v1/sdk/cnr/resolve" > /tmp/cnr-pub.json
python3 - <<'PY'
import json
d = json.load(open("/tmp/cnr-pub.json"))
assert d.get("success") is True, d
inner = d.get("data") or {}
assert inner.get("claimEcourts") is False, inner.get("claimEcourts")
cc = inner.get("caseCreate")
print("PUBLIC status", inner.get("status"), "claimEcourts", inner.get("claimEcourts"))
print("caseCreate", "yes" if cc else "no")
if cc:
    print("title", (cc.get("header") or {}).get("caseTitle", {}).get("value"))
    print("timeline_len", len(cc.get("timeline") or []))
    print("clients", len(cc.get("clients") or []))
    print("manifest_missing", (cc.get("fieldManifest") or {}).get("missing"))
print("source", inner.get("source"), "latencyMs", (inner.get("meta") or {}).get("latencyMs"))
PY
curl -sf -o /dev/null -w "health_http=%{http_code}\n" "${API}/api/jrx/health"
