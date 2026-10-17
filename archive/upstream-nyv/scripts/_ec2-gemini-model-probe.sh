#!/usr/bin/env bash
# Probe which Gemini models our live key can actually reach (no secret values echoed).
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
KEY=$(grep -E '^(GEMINI_API_KEY|GOOGLE_API_KEY|GOOGLE_GENAI_API_KEY)=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')
if [ -z "$KEY" ]; then echo "NO GEMINI KEY IN CANON"; exit 0; fi
echo "gemini key present len=${#KEY}"

echo "=== ListModels (names only) ==="
curl -sS -m 25 "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200" \
  -H "x-goog-api-key: ${KEY}" -o /tmp/gm.json -w "HTTP %{http_code}\n" || echo "HTTP 000"
python3 - <<'PY'
import json
try:
    d = json.load(open("/tmp/gm.json"))
except Exception as e:
    print("parse_error", e); raise SystemExit
ms = d.get("models") or []
print("total", len(ms))
for m in ms:
    n = m.get("name", "").replace("models/", "")
    if "gemini-3" in n or "flash" in n:
        print(f"  {n:46s} in={m.get('inputTokenLimit')} out={m.get('outputTokenLimit')}")
PY

probe() {
  local model="$1"
  printf '%-34s ' "$model"
  curl -sS -m 60 -o /tmp/gg.json -w "HTTP %{http_code} time=%{time_total} " \
    "https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent" \
    -H "x-goog-api-key: ${KEY}" -H 'Content-Type: application/json' \
    -d '{"contents":[{"parts":[{"text":"Reply with exactly: OK"}]}],"generationConfig":{"maxOutputTokens":16,"temperature":0}}' \
    || printf 'HTTP 000 '
  python3 - <<'PY'
import json
try:
    d = json.load(open("/tmp/gg.json"))
except Exception:
    print("unparseable"); raise SystemExit
if "error" in d:
    print("ERR", str(d["error"].get("message"))[:90])
else:
    c = d.get("candidates") or [{}]
    parts = ((c[0].get("content") or {}).get("parts") or [{}])
    print("OUT", str(parts[0].get("text", ""))[:20].strip())
PY
}

echo "=== generateContent probes ==="
for m in gemini-3.7-flash gemini-3.6-flash gemini-3-flash-preview gemini-3-1-pro-preview gemini-3-1-flash-lite-preview; do
  probe "$m"
done
