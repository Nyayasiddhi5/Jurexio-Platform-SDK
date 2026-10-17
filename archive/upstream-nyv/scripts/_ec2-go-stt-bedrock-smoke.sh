#!/usr/bin/env bash
# NV-STT-GO-001 + Bedrock cascade trim — nysdev env patch + live probes (no secrets printed).
set -uo pipefail

CANON="/opt/Nyayavigya/secrets/.env.production"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP="${CANON}.stt-go-backup-${STAMP}"
API="https://api.nyayasiddhi.online"
FAIL=0

patch_kv() {
  local k="$1" v="$2"
  if grep -qE "^${k}=" "$CANON"; then
    sed -i "s|^${k}=.*|${k}=${v}|" "$CANON"
  else
    printf '\n%s=%s\n' "$k" "$v" >> "$CANON"
  fi
}

resolve_live_dir() {
  local current live
  current="$(cat /opt/Nyayavigya/CURRENT_DEPLOY 2>/dev/null || true)"
  if [ -n "$current" ]; then
    live="$(ls -dt "/opt/Nyayavigya/repo/${current}"* 2>/dev/null | head -1 || true)"
  fi
  if [ -z "${live:-}" ]; then
    live="$(ls -dt /opt/Nyayavigya/repo/* 2>/dev/null | head -1 || true)"
  fi
  printf '%s' "${live:-}"
}

echo "=== NV-STT-GO nysdev ${STAMP} ==="

# --- 0) Key audit (presence + len only) ---
echo "=== KEY AUDIT (presence + len, no values) ==="
python3 - <<'PY'
import os, re
canon = "/opt/Nyayavigya/secrets/.env.production"
keys = [
  "GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_AI_API_KEY",
  "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "NYV_SARVAM_API_KEY", "SARVAM_API_KEY",
  "AWS_BEARER_TOKEN_BEDROCK", "AWS_BEARER_TOKEN_BEDROCK_US_EAST_1",
  "AWS_BEARER_TOKEN_BEDROCK_AP_SOUTH_1", "BEDROCK_API_KEY", "BEDROCK_API_KEY_US_EAST_1",
  "OPENROUTER_API_KEY", "NYV_OPENROUTER_API_KEY", "XAI_API_KEY", "GROQ_API_KEY",
]
vals = {}
for line in open(canon, encoding="utf-8", errors="replace"):
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    k = k.strip()
    v = v.strip().strip('"').strip("'")
    if k in keys and k not in vals and v:
        vals[k] = v
print(f"{'KEY':<42} {'present':<8} len")
for k in keys:
    v = vals.get(k, "")
    print(f"{k:<42} {'yes' if v else 'no':<8} {len(v) if v else 0}")
PY

# --- 1) STT BEFORE (container env + one probe with current config) ---
echo "=== STT BEFORE PATCH ==="
docker exec nyv-gateway printenv NYV_GEMINI_STT_MODEL NYV_LANGUAGE_PROVIDER 2>/dev/null \
  | sed 's/^/  /' || echo "  gateway_env=unavailable"
NSPK="$(grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')"
python3 - <<'PY' > /tmp/stt-before.json
import base64, json, os, struct, subprocess, sys, urllib.request

def mk_wav(path):
    # Prefer espeak speech WAV; else synthesize 2s tone (valid container, not speech).
    try:
        subprocess.run(
            ["espeak", "-w", path, "Anticipatory bail under BNSS section 482"],
            check=True, capture_output=True, timeout=20,
        )
        if os.path.getsize(path) > 1000:
            return "espeak"
    except Exception:
        pass
    sr, dur, freq = 16000, 2.0, 440.0
    n = int(sr * dur)
    import math
    samples = [int(12000 * math.sin(2 * math.pi * freq * i / sr)) for i in range(n)]
    buf = b"".join(struct.pack("<h", s) for s in samples)
    with open(path, "wb") as f:
        f.write(b"RIFF")
        f.write(struct.pack("<I", 36 + len(buf)))
        f.write(b"WAVEfmt ")
        f.write(struct.pack("<IHHIIHH", 16, 1, 1, sr, sr * 2, 2, 16))
        f.write(b"data")
        f.write(struct.pack("<I", len(buf)))
        f.write(buf)
    return "tone"

wav = "/tmp/nyv-stt-probe.wav"
src = mk_wav(wav)
b64 = base64.b64encode(open(wav, "rb").read()).decode()
key = os.environ.get("NSPK", "")
if not key:
    print(json.dumps({"error": "no_nsp_key", "wav_source": src}))
    sys.exit(0)
body = json.dumps({"audioBase64": b64, "language": "en-IN", "format": "wav"}).encode()
req = urllib.request.Request(
    "http://127.0.0.1:5000/api/jrx/voice/transcribe",
    data=body,
    headers={"Content-Type": "application/json", "X-API-Key": key, "X-NYV-Consent": "granted"},
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=90) as res:
        raw = res.read()
        out = json.loads(raw)
        tr = out.get("transcription") or {}
        print(json.dumps({
            "http": res.status,
            "provider": tr.get("provider"),
            "isSimulation": tr.get("isSimulation"),
            "text_len": len(tr.get("text") or ""),
            "text_preview": (tr.get("text") or "")[:120],
            "wav_source": src,
            "wav_bytes": os.path.getsize(wav),
        }))
except Exception as e:
    print(json.dumps({"http": getattr(e, "code", 0), "error": str(e)[:160], "wav_source": src}))
PY
export NSPK
python3 -c "import json; d=json.load(open('/tmp/stt-before.json')); print('  before', json.dumps(d, ensure_ascii=False))"
BEFORE_SIM="$(python3 -c "import json; d=json.load(open('/tmp/stt-before.json')); print(d.get('isSimulation','?'))" 2>/dev/null || echo '?')"
BEFORE_PROV="$(python3 -c "import json; d=json.load(open('/tmp/stt-before.json')); print(d.get('provider','?'))" 2>/dev/null || echo '?')"

# --- 2) Patch canonical + sync live .env ---
echo "=== PATCH NYV_GEMINI_STT_MODEL=gemini-3.7-flash ==="
cp "$CANON" "$BACKUP"
echo "backup=$BACKUP"
patch_kv NYV_GEMINI_STT_MODEL gemini-3.7-flash
grep -E '^NYV_GEMINI_STT_MODEL=' "$CANON" | sed 's/=.*/=<gemini-3.7-flash>/'

LIVE="$(resolve_live_dir)"
if [ -z "$LIVE" ]; then
  echo "FAIL no LIVE repo dir"; FAIL=$((FAIL+1))
else
  echo "LIVE=$LIVE"
  cp "$CANON" "$LIVE/.env"
  echo "synced canonical -> $LIVE/.env (keys=$(grep -cE '^[A-Z_]+=' "$LIVE/.env" || echo 0))"
fi

# --- 3) Recreate gateway to pick up env_file ---
echo "=== RESTART nyv-gateway (recreate for env_file) ==="
export COMPOSE_PROJECT_NAME=nyayavigya-platform-312
if [ -n "$LIVE" ] && [ -f "$LIVE/docker-compose.aws-dev.yml" ]; then
  cd "$LIVE"
  docker compose -f docker-compose.aws-dev.yml up -d gateway 2>&1 | tail -5
else
  docker restart nyv-gateway 2>/dev/null || true
fi
for i in $(seq 1 12); do
  code=$(curl -sS -m 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:5000/api/jrx/health 2>/dev/null || echo 000)
  echo "health_$i=$code"
  [ "$code" = "200" ] && break
  sleep 4
done
[ "$code" = "200" ] || FAIL=$((FAIL+1))
docker exec nyv-gateway printenv NYV_GEMINI_STT_MODEL 2>/dev/null | sed 's/^/  live NYV_GEMINI_STT_MODEL=/'

# --- 4) STT AFTER ---
echo "=== STT AFTER PATCH ==="
export NSPK
python3 - <<'PY' > /tmp/stt-after.json
import base64, json, os, struct, subprocess, sys, urllib.request

def mk_wav(path):
    try:
        subprocess.run(
            ["espeak", "-w", path, "Anticipatory bail under BNSS section 482"],
            check=True, capture_output=True, timeout=20,
        )
        if os.path.getsize(path) > 1000:
            return "espeak"
    except Exception:
        pass
    sr, dur, freq = 16000, 2.0, 440.0
    n = int(sr * dur)
    import math
    samples = [int(12000 * math.sin(2 * math.pi * freq * i / sr)) for i in range(n)]
    buf = b"".join(struct.pack("<h", s) for s in samples)
    with open(path, "wb") as f:
        f.write(b"RIFF")
        f.write(struct.pack("<I", 36 + len(buf)))
        f.write(b"WAVEfmt ")
        f.write(struct.pack("<IHHIIHH", 16, 1, 1, sr, sr * 2, 2, 16))
        f.write(b"data")
        f.write(struct.pack("<I", len(buf)))
        f.write(buf)
    return "tone"

wav = "/tmp/nyv-stt-probe.wav"
src = mk_wav(wav)
b64 = base64.b64encode(open(wav, "rb").read()).decode()
key = os.environ.get("NSPK", "")
body = json.dumps({"audioBase64": b64, "language": "en-IN", "format": "wav"}).encode()
req = urllib.request.Request(
    "http://127.0.0.1:5000/api/jrx/voice/transcribe",
    data=body,
    headers={"Content-Type": "application/json", "X-API-Key": key, "X-NYV-Consent": "granted"},
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=90) as res:
        out = json.loads(res.read())
        tr = out.get("transcription") or {}
        print(json.dumps({
            "http": res.status,
            "provider": tr.get("provider"),
            "isSimulation": tr.get("isSimulation"),
            "text_len": len(tr.get("text") or ""),
            "text_preview": (tr.get("text") or "")[:120],
            "wav_source": src,
        }))
except Exception as e:
    print(json.dumps({"http": getattr(e, "code", 0), "error": str(e)[:160], "wav_source": src}))
PY
python3 -c "import json; d=json.load(open('/tmp/stt-after.json')); print('  after', json.dumps(d, ensure_ascii=False))"
AFTER_SIM="$(python3 -c "import json; d=json.load(open('/tmp/stt-after.json')); print(d.get('isSimulation','?'))" 2>/dev/null || echo '?')"
AFTER_PROV="$(python3 -c "import json; d=json.load(open('/tmp/stt-after.json')); print(d.get('provider','?'))" 2>/dev/null || echo '?')"
[ "$AFTER_SIM" = "False" ] || [ "$AFTER_SIM" = "false" ] || FAIL=$((FAIL+1))
[ "$AFTER_PROV" = "gemini" ] || FAIL=$((FAIL+1))

# --- 5) Bedrock model probe matrix ---
echo "=== BEDROCK MODEL PROBE MATRIX ==="
bash /tmp/_bedrock-matrix.sh 2>/dev/null || bash - <<'BEDROCK'
set -uo pipefail
TOKEN_FILE=/tmp/.nv-bt
umask 077
docker exec nyv-gateway sh -c 'printf %s "$AWS_BEARER_TOKEN_BEDROCK_US_EAST_1$AWS_BEARER_TOKEN_BEDROCK$BEDROCK_API_KEY"' > /dev/null
docker exec nyv-gateway printenv AWS_BEARER_TOKEN_BEDROCK_US_EAST_1 > "$TOKEN_FILE" 2>/dev/null || true
[ -s "$TOKEN_FILE" ] || docker exec nyv-gateway printenv AWS_BEARER_TOKEN_BEDROCK > "$TOKEN_FILE" 2>/dev/null || true
[ -s "$TOKEN_FILE" ] || docker exec nyv-gateway printenv BEDROCK_API_KEY > "$TOKEN_FILE" 2>/dev/null || true
python3 - <<'PY'
import json, ssl, urllib.error, urllib.parse, urllib.request
from pathlib import Path

token = Path("/tmp/.nv-bt").read_text().strip()
print("bearer_present=" + ("yes" if token else "no") + " len=" + str(len(token)))
if not token:
    raise SystemExit(0)
ctx = ssl.create_default_context()

def invoke(model_id, kind):
    if kind == "claude":
        body = json.dumps({
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 16,
            "messages": [{"role": "user", "content": "Reply OK."}],
        })
    elif kind == "nova":
        body = json.dumps({
            "schemaVersion": "messages-v1",
            "messages": [{"role": "user", "content": [{"text": "Reply OK."}]}],
            "inferenceConfig": {"maxNewTokens": 16, "temperature": 0},
        })
    else:
        body = json.dumps({"messages": [{"role": "user", "content": "Reply OK."}], "max_tokens": 16})
    path = "/model/" + urllib.parse.quote(model_id, safe="") + "/invoke"
    data = body.encode()
    req = urllib.request.Request(
        "https://bedrock-runtime.us-east-1.amazonaws.com" + path,
        data=data,
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=25, context=ctx) as res:
            return res.status, "ok"
    except urllib.error.HTTPError as e:
        raw = e.read(200).decode("utf-8", "replace")
        msg = " ".join(raw.replace('"', "'").split())[:100]
        return e.code, msg
    except Exception as e:
        return 0, str(e)[:80]

models = [
    ("global.anthropic.claude-opus-5", "claude"),
    ("us.anthropic.claude-opus-5", "claude"),
    ("global.anthropic.claude-sonnet-5", "claude"),
    ("us.anthropic.claude-sonnet-5", "claude"),
    ("global.anthropic.claude-sonnet-4-6", "claude"),
    ("global.anthropic.claude-opus-4-6-v1", "claude"),
    ("us.anthropic.claude-opus-4-8", "claude"),
    ("global.anthropic.claude-opus-4-8", "claude"),
    ("global.anthropic.claude-opus-4-7", "claude"),
    ("global.anthropic.claude-haiku-4-5", "claude"),
    ("deepseek.v3.2", "openai"),
    ("qwen.qwen3-235b-a22b-2507-v1:0", "openai"),
    ("moonshotai.kimi-k2.5", "openai"),
    ("apac.amazon.nova-pro-v1:0", "nova"),
    ("us.amazon.nova-pro-v1:0", "nova"),
    ("global.amazon.nova-2-lite-v1:0", "nova"),
]
pass_ids = []
print(f"{'MODEL':<45} {'HTTP':<6} STATUS")
for mid, kind in models:
    status, snippet = invoke(mid, kind)
    ok = status == 200
    print(f"{mid:<45} {status:<6} {'PASS' if ok else 'FAIL'} {snippet[:60]}")
    if ok:
        pass_ids.append(mid)
Path("/tmp/bedrock-pass.txt").write_text(",".join(pass_ids))
print("PASS_IDS=" + ",".join(pass_ids))
PY
rm -f "$TOKEN_FILE"
BEDROCK

# --- 6) Trim cascade to 200-OK Bedrock models only ---
echo "=== CASCADE ENV UPDATE (200-OK bedrock only) ==="
PASS_BEDROCK="$(cat /tmp/bedrock-pass.txt 2>/dev/null || true)"
GEMINI_TAIL="gemini-3-1-pro-preview,gemini-3.7-flash,gemini-3-flash-preview,gemini-3.1-flash-lite"
if [ -n "$PASS_BEDROCK" ]; then
  patch_kv NYV_LLM_CASCADE_LEAD "$PASS_BEDROCK"
  # Premium models: bedrock claude passes + gemini
  PREM="$(echo "$PASS_BEDROCK" | tr ',' '\n' | grep -E 'anthropic|claude' | paste -sd, -)"
  [ -n "$PREM" ] && patch_kv NYV_PARTNER_LEGAL_PREMIUM_MODELS "${PREM},${GEMINI_TAIL}"
  patch_kv NYV_LLM_CASCADE_GEMINI "$GEMINI_TAIL"
  patch_kv NYV_BEDROCK_ENABLED on
  patch_kv NYV_ROUTER_BEDROCK_FIRST on
  if [ -n "$LIVE" ]; then
    cp "$CANON" "$LIVE/.env"
    cd "$LIVE"
    docker compose -f docker-compose.aws-dev.yml up -d gateway 2>&1 | tail -3
    sleep 10
  fi
  echo "NYV_LLM_CASCADE_LEAD=$(grep '^NYV_LLM_CASCADE_LEAD=' "$CANON" | cut -d= -f2- | cut -c1-120)..."
else
  echo "WARN no bedrock passes — cascade unchanged"
fi

# --- 7) legal-chat-fast smoke ---
echo "=== LEGAL-CHAT-FAST SMOKE ==="
if [ -n "$NSPK" ]; then
  curl -sS -m 120 \
    -H "X-API-Key: ${NSPK}" \
    -H "X-NYV-Platform: nsp" \
    -H "X-NYV-Consent: granted" \
    -H "Content-Type: application/json" \
    -d '{"prompt":"In one sentence: what is anticipatory bail under BNSS?","taskType":"legal-chat-fast","jurisdiction":"IN"}' \
    "$API/api/jrx/orchestrate" > /tmp/legal-chat-fast.json 2>/dev/null || true
  python3 - <<'PY'
import json
try:
    d = json.load(open("/tmp/legal-chat-fast.json"))
except Exception:
    print("  smoke parse_fail"); raise SystemExit(0)
ok = d.get("success")
data = d.get("data") or {}
extras = data.get("extras") or {}
meta = data.get("metadata") or {}
model = (
    extras.get("modelUsed") or meta.get("modelUsed") or meta.get("model")
    or (data.get("routing") or {}).get("model")
    or d.get("modelUsed") or "ABSENT"
)
prov = extras.get("provider") or meta.get("provider") or "?"
ans = (data.get("answer") or data.get("content") or d.get("answer") or "")[:100]
print(f"  success={ok} modelUsed={model} provider={prov} answer_len={len(ans)} preview={ans[:80]!r}")
PY
else
  echo "  SKIP no NSP key"
  FAIL=$((FAIL+1))
fi

echo "=== SUMMARY ==="
echo "STT before: provider=$BEFORE_PROV isSimulation=$BEFORE_SIM"
echo "STT after:  provider=$AFTER_PROV isSimulation=$AFTER_SIM"
echo "PROBE_FAILS=$FAIL"
exit 0
