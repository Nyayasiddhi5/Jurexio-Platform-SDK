#!/usr/bin/env bash
# NV-DRAFT-LATENCY-COMPARISON — cold vs warm draft-fast vs legal-draft on nysdev.
# Keys from canonical env only. Never echo secret values.
set -uo pipefail

python3 <<'PY'
import json, time, urllib.request, urllib.error, uuid

CANON = "/opt/Nyayavigya/secrets/.env.production"
BASE = "https://api.nyayasiddhi.online"

def load_key(name):
    pref = f"{name}="
    for line in open(CANON):
        if line.startswith(pref):
            return line.strip().split("=", 1)[1].strip().strip('"').strip("'")
    return None

def orchestrate(api_key, platform, task, prompt, max_tokens=256, timeout=180):
    body = {
        "prompt": prompt,
        "taskType": task,
        "jurisdiction": "IN",
        "maxTokens": max_tokens,
    }
    headers = {
        "Content-Type": "application/json",
        "X-API-Key": api_key,
        "X-NYV-Platform": platform.lower(),
    }
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        f"{BASE}/api/jrx/orchestrate", data=data, headers=headers, method="POST"
    )
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw), int((time.time() - t0) * 1000)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            j = json.loads(raw)
        except Exception:
            j = {"error": raw[:300]}
        return e.code, j, int((time.time() - t0) * 1000)

def flags(data):
    orch = data.get("orchestration") or {}
    routing = data.get("routing") or {}
    return {
        "cacheHit": orch.get("cacheHit") or data.get("cacheHit"),
        "path": routing.get("path") if isinstance(routing, dict) else routing,
        "model": data.get("model") or orch.get("model"),
        "reason": routing.get("reason") if isinstance(routing, dict) else None,
    }

key = load_key("NYV_SDK_KEY_NSP")
if not key or len(key) < 16:
    print("PROBE BROKEN: no NSP key")
    raise SystemExit(3)

print("=== DEPLOY ===")
try:
    print("CURRENT=" + open("/opt/nyayavigya/CURRENT_DEPLOY").read().strip())
except Exception:
    print("CURRENT=missing")

stamp = uuid.uuid4().hex[:8]
cold_prompt = f"Draft one sentence bail application prayer under BNSS. Ref {stamp}"
warm_prompt = cold_prompt  # repeat identical

scenarios = [
    ("draft-fast-cold", "legal-draft-fast", cold_prompt, 256),
    ("draft-fast-warm", "legal-draft-fast", warm_prompt, 256),
    ("draft-full-cold", "legal-draft", f"Draft one sentence bail prayer. Ref {stamp}b", 256),
    ("chat-fast-cold", "legal-chat-fast", f"What is anticipatory bail under BNSS? Ref {stamp}c", 128),
]

print(f"\n=== NSP LATENCY COMPARISON stamp={stamp} ===")
for label, task, prompt, mt in scenarios:
    status, j, ms = orchestrate(key, "NSP", task, prompt, mt)
    data = j.get("data") or j
    f = flags(data)
    content_len = len(str(data.get("content") or ""))
    print(
        f"{label}: http={status} ms={ms} task={task} path={f['path']} "
        f"cacheHit={f['cacheHit']} model={f['model']} content_len={content_len} "
        f"success={j.get('success')}"
    )
    if f.get("reason"):
        print(f"  routing_reason={str(f['reason'])[:120]}")
PY
