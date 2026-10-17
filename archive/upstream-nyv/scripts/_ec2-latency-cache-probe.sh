#!/usr/bin/env bash
# NV-LATENCY-CACHE-PROBE — repeat-prompt cache + orchestrate latency on nysdev.
# Runs ON nysdev EC2. Keys from canonical env only. Never echo secret values.
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"

python3 <<'PY'
import json, time, urllib.request, urllib.error

CANON = "/opt/Nyayavigya/secrets/.env.production"
BASE = "https://api.nyayasiddhi.online"

def load_key(name):
    pref = f"{name}="
    for line in open(CANON):
        if line.startswith(pref):
            return line.strip().split("=", 1)[1].strip().strip('"').strip("'")
    return None

def orchestrate(api_key, platform, task, prompt, timeout=120):
    body = {
        "prompt": prompt,
        "taskType": task,
        "jurisdiction": "IN",
        "maxTokens": 128,
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

def cache_flags(data):
    orch = data.get("orchestration") or {}
    routing = data.get("routing") or {}
    return {
        "cacheHit": orch.get("cacheHit") or data.get("cacheHit"),
        "cacheTier": orch.get("cacheTier") or data.get("cacheTier"),
        "path": routing.get("path") if isinstance(routing, dict) else routing,
        "model": data.get("model") or orch.get("model"),
    }

def repeat_probe(platform, key, task, prompt):
    print(f"\n=== {platform} {task} REPEAT CACHE ===")
    print(f"prompt_hash={hash(prompt) & 0xFFFFFFFF:08x} prompt_len={len(prompt)}")
    results = []
    for run in (1, 2):
        status, j, ms = orchestrate(key, platform, task, prompt)
        data = j.get("data") or j
        flags = cache_flags(data)
        content_len = len(str(data.get("content") or ""))
        print(
            f"run={run} http={status} ms={ms} success={j.get('success')} "
            f"path={flags['path']} cacheHit={flags['cacheHit']} cacheTier={flags['cacheTier']} "
            f"model={flags['model']} content_len={content_len}"
        )
        results.append({"run": run, "ms": ms, "flags": flags, "status": status})
    if len(results) == 2 and results[0]["ms"] > 0:
        speedup = results[0]["ms"] / max(results[1]["ms"], 1)
        behavioral_cache = results[1]["ms"] < 500 and results[0]["ms"] > 2000
        print(
            f"speedup={speedup:.1f}x behavioral_cache_likely={behavioral_cache} "
            f"(run1={results[0]['ms']}ms run2={results[1]['ms']}ms)"
        )
    return results

print("=== DEPLOY ===")
try:
    print("CURRENT=" + open("/opt/nyayavigya/CURRENT_DEPLOY").read().strip())
except Exception:
    print("CURRENT=missing")
try:
    print("LAST_GOOD=" + open("/opt/nyayavigya/LAST_GOOD_DEPLOY").read().strip())
except Exception:
    print("LAST_GOOD=missing")

PROMPT = "What is anticipatory bail under BNSS? Reply in one short paragraph."
all_results = []

for plat, keyname in [("NSP", "NYV_SDK_KEY_NSP"), ("NYM", "NYV_SDK_KEY_NYM")]:
    key = load_key(keyname)
    if not key or len(key) < 16:
        print(f"SKIP {plat}: no key")
        continue
    for task in ("legal-chat-fast", "legal-draft-fast"):
        all_results.extend(repeat_probe(plat, key, task, PROMPT))

behavioral_hits = sum(
    1 for plat_results in [all_results[i:i+2] for i in range(0, len(all_results), 2)]
    if len(plat_results) == 2 and plat_results[1]["ms"] < 500 and plat_results[0]["ms"] > 2000
)
explicit_hits = sum(
    1 for r in all_results if r.get("flags", {}).get("cacheHit") is True
)
print(
    f"\n=== VERDICT pairs={len(all_results)//2} behavioral_cache_likely={behavioral_hits} "
    f"explicit_cacheHit_true={explicit_hits} ==="
)
PY
