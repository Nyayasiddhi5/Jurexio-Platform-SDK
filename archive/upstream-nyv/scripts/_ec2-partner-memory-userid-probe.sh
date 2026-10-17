#!/usr/bin/env bash
# NV-MEM-PARTNER-USER-001 — verify durable memory write accepts X-NYV-User-Id / body userId.
# Positive control: key length >= 16; turn A must return sessionId.
set -euo pipefail

CANON="${NV_CANON_ENV:-/opt/Nyayavigya/secrets/.env.production}"
BASE="${NV_BASE_URL:-https://api.nyayasiddhi.online}"
PROBE_USER_ID="${NV_PROBE_USER_ID:-88421}"

if [[ -f "$CANON" ]]; then
  KEY=$(grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')
else
  KEY="${NYV_SDK_KEY_NSP:-}"
fi
KEY_LEN=$(printf '%s' "$KEY" | wc -c | tr -d ' ')
if [[ "$KEY_LEN" -lt 16 ]]; then
  echo "PROBE BROKEN: NSP key length=$KEY_LEN (need >=16)" >&2
  exit 3
fi

post_orchestrate() {
  local outfile="$1"
  local body="$2"
  shift 2
  curl -sS -m 120 -o "$outfile" -w "http=%{http_code} time=%{time_total}s\n" -X POST \
    -H "X-API-Key: $KEY" \
    -H "X-NYV-Platform: nsp" \
    -H "X-NYV-Consent: granted" \
    -H "Content-Type: application/json" \
    "$@" \
    -d "$body" \
    "${BASE}/api/jrx/orchestrate"
}

echo "nsp_key_len=$KEY_LEN"
# Avoid digit runs that trip PHONE redaction on recall output (MEMORY-PROBE-1788… → [PHONE-REDACTED]).
SECRET="MEMPROBE-$(openssl rand -hex 6 2>/dev/null || date +%s | shasum | cut -c1-12)"
PROBE_SESSION="mem-probe-${SECRET}"
echo "probe_session=${PROBE_SESSION}"
echo "=== A: X-NYV-User-Id header stores secret ==="
post_orchestrate /tmp/mem-a.json \
  "{\"prompt\":\"Remember this codeword exactly: ${SECRET}. Acknowledge in one line.\",\"taskType\":\"legal-chat-fast\",\"jurisdiction\":\"IN\",\"enableMemory\":true}" \
  -H "X-NYV-User-Id: ${PROBE_USER_ID}" \
  -H "X-Customer-Session-Id: ${PROBE_SESSION}"
grep -q '"success":true' /tmp/mem-a.json || { echo "FAIL: turn A not success"; exit 2; }

SESSION_ID=$(python3 - <<'PY'
import json
a = json.load(open('/tmp/mem-a.json'))
d = a.get('data') or {}
print(d.get('sessionId') or '')
PY
)
echo "turn_a_sessionId=${SESSION_ID:-<none>}"

echo "=== B: same userId via body.userId recalls secret ==="
BODY_B="{\"prompt\":\"In our prior message I asked you to remember a codeword. Reply with that codeword only, or UNKNOWN if not in Platform Memory.\",\"taskType\":\"legal-chat-fast\",\"jurisdiction\":\"IN\",\"enableMemory\":true,\"userId\":${PROBE_USER_ID}"
if [[ -n "${SESSION_ID:-}" ]]; then
  BODY_B="${BODY_B},\"sessionId\":\"${SESSION_ID}\""
fi
BODY_B="${BODY_B}}"

post_orchestrate /tmp/mem-b.json "$BODY_B"
grep -q '"success":true' /tmp/mem-b.json || { echo "FAIL: turn B not success"; exit 2; }

python3 - "$SECRET" "$PROBE_USER_ID" <<'PY'
import json, sys
secret, uid = sys.argv[1], sys.argv[2]
b = json.load(open('/tmp/mem-b.json'))
d = b.get('data') or {}
content = str(d.get('content') or '')
mem = d.get('memoryContext') or d.get('memoryMeta') or {}
ok_secret = secret in content
print(f"userId_probe={uid}")
print(f"recall_hit={ok_secret}")
print(f"memory_context_keys={list(mem.keys())[:8]}")
print(f"memory_contextUsed={mem.get('contextUsed')}")
print(f"memory_memoriesUsed={mem.get('memoriesUsed')}")
print(f"sessionId_turnB={d.get('sessionId')!r}")
print(f"content_head={content[:200]!r}")
if not ok_secret:
    raise SystemExit(2)
print("PROBE PASS: memory write/read with partner userId")
PY
