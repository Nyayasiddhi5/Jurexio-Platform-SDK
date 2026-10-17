#!/usr/bin/env bash
# NV-SELECTION-TEXT-PRIORITY-001 — runs ON nysdev EC2.
# Confirms orchestrate uses selectedText (short highlight) not documentText (full file).
# NV-SECRETS-001: key length only; log document block metrics only.
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API_LOCAL="http://127.0.0.1:5000"

read_canon_key() {
  grep -E "^${1}=" "$CANON" 2>/dev/null | head -1 | cut -d= -f2- \
    | sed -E 's/^[[:space:]"'\'' ]+//; s/[[:space:]"'\'' ]+$//; s/\r$//'
}

NSPK="$(read_canon_key NYV_SDK_KEY_NSP)"
echo "=== NV-SELECTION-TEXT-PRIORITY-001 PROBE ==="
echo "CURRENT=$(cat /opt/Nyayavigya/CURRENT_DEPLOY 2>/dev/null || echo missing)"
echo "NSP_key_len=$(printf %s "$NSPK" | wc -c | tr -d ' ')"

if [ "$(printf %s "$NSPK" | wc -c | tr -d ' ')" -le 16 ]; then
  echo "VERDICT=FAIL reason=no_nsp_key"
  exit 1
fi

TMP=$(mktemp)
python3 - "$TMP" <<'PY'
import json, sys
selected = (
    "CLAUSE 12.1 (LIABILITY CAP): aggregate liability shall not exceed fees paid. "
    "NV-PROBE-SENTINEL-001"
)
full_doc = (
    "MASTER SERVICES AGREEMENT\n\n"
    + "Section 1. Definitions. " * 80
    + "\nSection 12. Liability. The aggregate liability cap applies per contract year."
)
payload = {
    "prompt": "Rewrite this clause to be more favorable to the Customer.",
    "selectedText": selected,
    "documentText": full_doc,
    "taskType": "legal-chat-fast",
    "jurisdiction": "IN",
    "maxTokens": 64,
}
with open(sys.argv[1], "w") as f:
    json.dump(payload, f)
print(f"selected_len={len(selected)} full_doc_len={len(full_doc)}")
PY

code=$(curl -sS -o "$TMP.resp" -w '%{http_code}' --max-time 90 -X POST \
  -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" -H "Content-Type: application/json" \
  -d @"$TMP" "$API_LOCAL/api/jrx/orchestrate" 2>/dev/null || echo ERR)

python3 - "$code" "$TMP.resp" <<'PY'
import json, sys
http = sys.argv[1]
path = sys.argv[2]
selected_len = 95  # approximate; actual computed in payload step
try:
    d = json.load(open(path))
except Exception as e:
    print(f"VERDICT=FAIL http={http} parse_err={e}")
    sys.exit(1)

data = d.get("data") or d
ctx = data.get("documentContext") or {}
source = ctx.get("sourceField")
doc_chars = int(ctx.get("documentChars") or 0)
incl_chars = int(ctx.get("includedChars") or 0)
truncated = ctx.get("truncated")
success = d.get("success")
content_len = len(str(data.get("content") or ""))

print(
    f"http={http} success={success} sourceField={source} "
    f"documentChars={doc_chars} includedChars={incl_chars} truncated={truncated} "
    f"response_content_len={content_len}"
)

failures = []
if http != "200":
    failures.append(f"http={http}")
if source != "selectedText":
    failures.append(f"sourceField={source} expected=selectedText")
if doc_chars > 200:
    failures.append(f"documentChars={doc_chars} too_large_for_selection")
if incl_chars > 200:
    failures.append(f"includedChars={incl_chars} too_large_for_selection")
if doc_chars < 50:
    failures.append(f"documentChars={doc_chars} too_small")

if failures:
    print("VERDICT=FAIL " + "; ".join(failures))
    sys.exit(1)
print("VERDICT=PASS selection_beats_full_document")
PY
RC=$?
rm -f "$TMP" "$TMP.resp"
exit $RC
