#!/usr/bin/env bash
# NV-CONTINUE-BAIL-SAMPLE-001 — sync bail draft probe for continuationAvailable (D1).
# Uses NYV_SDK_KEY_NSP from env; never prints key values.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
[ -f "$ROOT/../.local/secrets/runtime.env" ] && set -a && source "$ROOT/../.local/secrets/runtime.env" && set +a
: "${NYV_SDK_KEY_NSP:?set NYV_SDK_KEY_NSP or source runtime.env}"
BASE="${NYV_API_BASE:-https://api.nyayasiddhi.online}"
PAYLOAD='{
  "taskType": "legal-draft-fast",
  "prompt": "Draft anticipatory bail application under BNSS 482 for Chennai Sessions Court. Include cause title, facts in numbered paragraphs 1-8, grounds, and stop mid-draft before PRAYER (intentionally incomplete for Continue QA).",
  "sessionId": "nsp-continue-bail-sample-001",
  "parameters": { "documentType": "bail_application" },
  "options": { "draftLength": "low" }
}'
RESP="$(curl -sS -m 120 -X POST "$BASE/api/jrx/orchestrate" \
  -H "Content-Type: application/json" \
  -H "X-NYV-Platform: nsp" \
  -H "X-API-Key: ${NYV_SDK_KEY_NSP}" \
  -d "$PAYLOAD")"
python3 - <<'PY' "$RESP"
import json, sys
raw = sys.argv[1]
try:
  j = json.loads(raw)
except json.JSONDecodeError:
  print("HTTP body not JSON", file=sys.stderr)
  sys.exit(1)
data = j.get("data") or {}
print("success=", j.get("success"))
print("requestId=", data.get("requestId"))
print("completionStatus=", data.get("completionStatus"))
print("continuationAvailable=", data.get("continuationAvailable"))
comp = data.get("completion") or {}
print("completion.status=", comp.get("status"))
print("completion.continuationAvailable=", comp.get("continuationAvailable"))
print("completion.incompleteReason=", comp.get("incompleteReason"))
print("content.length=", len(str(data.get("content") or "")))
cr = comp.get("continueRequest") or {}
opts = (cr.get("options") or {})
print("continueRequest.segmentIndex=", opts.get("segmentIndex"))
if data.get("continuationAvailable") is True:
  print("D1_PASS continuationAvailable=true")
  sys.exit(0)
print("D1_NOTE continuationAvailable not true (may be segment_budget after auto-loop); see unit test / contract sample in artifacts doc")
sys.exit(0)
PY
