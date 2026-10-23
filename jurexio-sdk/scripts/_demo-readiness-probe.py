#!/usr/bin/env python3
"""Demo readiness probe — runs ON nysdev EC2. Never echo secret values."""
import base64
import json
import math
import struct
import subprocess
import wave

CANON = "/opt/Nyayavigya/secrets/.env.production"
API = "https://api.nyayasiddhi.online"
LOCAL = "http://127.0.0.1:5000"

key = ""
for line in open(CANON, encoding="utf-8", errors="replace"):
    if line.startswith("NYV_SDK_KEY_NSP="):
        key = line.split("=", 1)[1].strip().strip('"').strip("'")
        break
if len(key) < 16:
    print("PROBE BROKEN: no NSP key")
    raise SystemExit(3)


def req(method, url, body=None, timeout=120):
    cmd = [
        "curl", "-sS", "-m", str(timeout), "-w", "\n__HTTP__%{http_code}",
        "-H", f"X-API-Key: {key}", "-H", "X-NYV-Platform: nsp",
        "-H", "Content-Type: application/json",
    ]
    if method == "POST":
        cmd += ["-X", "POST", "-d", json.dumps(body)]
    cmd.append(url)
    out = subprocess.check_output(cmd, text=True)
    body_text, http = out.rsplit("\n__HTTP__", 1)
    try:
        data = json.loads(body_text) if body_text.strip() else {}
    except Exception:
        data = {"_raw": body_text[:200]}
    return data, http


def info(d):
    data = d.get("data") if isinstance(d.get("data"), dict) else d
    route = data.get("routing") or {}
    return {
        "model": data.get("model") or d.get("model"),
        "provider": data.get("provider") or d.get("provider"),
        "sim": data.get("isSimulation"),
        "path": route.get("path") if isinstance(route, dict) else None,
        "phase": data.get("requestPhase") or d.get("requestPhase"),
        "success": d.get("success"),
        "err": (d.get("error") or {}).get("code"),
        "clen": len(str(data.get("content") or "")),
    }


print("=== LIVE AI SMOKE ===")
probes = [
    ("legal-chat-fast", {
        "prompt": "One line: anticipatory bail under BNSS?",
        "taskType": "legal-chat-fast", "jurisdiction": "IN", "maxTokens": 128,
    }),
    ("legal-draft-fast", {
        "prompt": "Draft one sentence bail application.",
        "taskType": "legal-draft-fast", "jurisdiction": "IN", "maxTokens": 128,
    }),
    ("legal_research", {
        "prompt": "Brief PMLA anticipatory bail.",
        "taskType": "legal_research", "jurisdiction": "IN", "maxTokens": 256,
    }),
    ("doc-draft-fast", {
        "prompt": "Draft legal notice unpaid invoice.",
        "taskType": "doc-draft-fast", "jurisdiction": "IN", "maxTokens": 128,
    }),
]
for name, body in probes:
    d, http = req("POST", API + "/api/nv/orchestrate", body, 180)
    i = info(d)
    print(
        f"{name}: http={http} model={i['model']} provider={i['provider']} "
        f"sim={i['sim']} path={i['path']} phase={i['phase']} "
        f"success={i['success']} clen={i['clen']} err={i['err']}"
    )

d, http = req("POST", API + "/api/nv/gateway/translate", {
    "text": "Anticipatory bail", "sourceLanguage": "en", "targetLanguage": "hi",
}, 60)
data = d.get("data") or d
print(f"translate: http={http} success={d.get('success')} model={data.get('model')} provider={data.get('provider')}")

d, http = req("POST", API + "/api/nv/gateway/research/query", {
    "query": "PMLA anticipatory bail?", "jurisdiction": "IN",
}, 120)
data = d.get("data") or d
print(f"research: http={http} success={d.get('success')} model={data.get('model')} provider={data.get('provider')}")

d, http = req("POST", API + "/api/nv/v1/sdk/cnr/resolve", {
    "cnr": "TSWL010000012024", "claimEcourts": False,
}, 60)
data = d.get("data") or d
print(f"cnr: http={http} success={d.get('success')} status={data.get('status') or data.get('analysisStatus')}")

fr = 16000
n = int(fr * 1.0)
samples = [int(3000 * math.sin(2 * math.pi * 440 * i / fr)) for i in range(n)]
with wave.open("/tmp/stt.wav", "w") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(fr)
    w.writeframes(struct.pack("<" + "h" * n, *samples))
b64 = base64.b64encode(open("/tmp/stt.wav", "rb").read()).decode()
for ep in ["/api/nv/legal-chat/voice/transcribe", "/api/nv/voice/transcribe"]:
    d, http = req("POST", LOCAL + ep, {
        "audioBase64": b64, "language": "en-IN", "format": "wav",
    }, 90)
    t = d.get("transcription") or d.get("data") or d
    print(
        f"stt{ep}: http={http} sim={t.get('isSimulation')} "
        f"prov={t.get('provider')} model={t.get('model')} "
        f"text={str(t.get('text', ''))[:60]}"
    )

print("=== SMOKE COMPLETE ===")
