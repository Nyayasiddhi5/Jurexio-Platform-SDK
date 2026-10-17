#!/usr/bin/env bash
# NV-DOCPARSE-NSP-FLAGS-PROBE-001 — flag-on check for depict + attach-understand (no secret echo).
set -euo pipefail
DEP="$(cat /opt/Nyayavigya/CURRENT_DEPLOY 2>/dev/null || true)"
DEST="/opt/Nyayavigya/repo/${DEP}"
LIVE_DIR="$(find "$DEST" -maxdepth 2 -type d -name 'nyayavigya-platform-312' 2>/dev/null | head -1)"
[ -n "$LIVE_DIR" ] || LIVE_DIR="$DEST"
ENVF="$LIVE_DIR/.env"
CANON="/opt/Nyayavigya/secrets/.env.production"
[ -f "$ENVF" ] || ENVF="$CANON"

GW="$(docker ps --format '{{.Names}}' | grep -E 'gateway' | head -1)"
echo "=== DOCPARSE NSP FLAG PROBE ==="
for k in NYV_F_DOCPARSE_SDK NYV_F_DOCPARSE_LLM_FALLBACK NYV_F_DOCPARSE_EVIDENCE_DEPICT NYV_F_DOCPARSE_ATTACH_UNDERSTAND; do
  v="$(docker exec "$GW" printenv "$k" 2>/dev/null || echo unset)"
  echo "container_${k}=${v}"
done

NSP_KEY="$(grep -E '^NYV_SDK_KEY_NSP=' "$ENVF" | head -1 | sed 's/^NYV_SDK_KEY_NSP=//; s/^"//; s/"$//; s/^'\''//; s/'\''$//')"
echo "NSP_key_len=${#NSP_KEY}"
[ "${#NSP_KEY}" -gt 20 ] || { echo "FATAL NSP key missing"; exit 1; }

# 1x1 PNG
TINY_B64="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

DEPICT_HTTP="$(curl -sS -o /tmp/jrx-depict-probe.json -w '%{http_code}' \
  -H "X-API-Key: ${NSP_KEY}" \
  -H "X-NYV-Platform: nsp" \
  -H "Content-Type: application/json" \
  -d "{\"base64\":\"${TINY_B64}\",\"fileName\":\"probe.png\",\"mimeType\":\"image/png\"}" \
  http://127.0.0.1:5000/api/jrx/v1/sdk/docparse/nsp/evidence-depict)"
echo "evidence_depict http=${DEPICT_HTTP}"
python3 - <<'PY'
import json
try:
  d=json.load(open("/tmp/jrx-depict-probe.json"))
except Exception:
  print("depict_body=invalid_json")
  raise SystemExit(0)
print("depict_code=", d.get("code"), "success=", d.get("success"))
data=d.get("data") or {}
if data.get("mode"):
  print("depict_mode=", data.get("mode"), "promptVersion=", data.get("promptVersion"))
PY

ATTACH_HTTP="$(curl -sS -o /tmp/jrx-attach-probe.json -w '%{http_code}' \
  -H "X-API-Key: ${NSP_KEY}" \
  -H "X-NYV-Platform: nsp" \
  -H "Content-Type: application/json" \
  -d '{"userPrompt":"Summarize this attachment for a draft.","attachContext":{"parseQuality":"partial","visibleText":"Sample FIR excerpt line.","ingestRole":"draft_attachment"}}' \
  http://127.0.0.1:5000/api/jrx/v1/sdk/docparse/nsp/attach-understand)"
echo "attach_understand http=${ATTACH_HTTP}"
python3 - <<'PY'
import json
try:
  d=json.load(open("/tmp/jrx-attach-probe.json"))
except Exception:
  print("attach_body=invalid_json")
  raise SystemExit(0)
print("attach_code=", d.get("code"), "success=", d.get("success"))
data=d.get("data") or {}
if data.get("mode"):
  print("attach_mode=", data.get("mode"), "understanding_len=", len(str(data.get("understanding") or "")))
PY

# Pass: flags on (1) and routes not 503 disabled
FAIL=0
for k in NYV_F_DOCPARSE_EVIDENCE_DEPICT NYV_F_DOCPARSE_ATTACH_UNDERSTAND; do
  v="$(docker exec "$GW" printenv "$k" 2>/dev/null || echo unset)"
  [ "$v" = "1" ] || FAIL=1
done
[ "$DEPICT_HTTP" != "503" ] || FAIL=1
[ "$ATTACH_HTTP" != "503" ] || FAIL=1
[ "$DEPICT_HTTP" = "200" ] || FAIL=1
[ "$ATTACH_HTTP" = "200" ] || FAIL=1

if [ "$FAIL" -eq 0 ]; then
  echo "PROBE_RESULT=PASS"
  exit 0
fi
echo "PROBE_RESULT=FAIL"
exit 1
