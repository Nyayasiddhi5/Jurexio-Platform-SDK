#!/usr/bin/env bash
# NV-DRAFT-STREAM-TTFB — measure sync vs stream TTFB for draft paths on nysdev.
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

def load_env(name):
    pref = f"{name}="
    for line in open(CANON):
        if line.startswith(pref):
            return line.strip().split("=", 1)[1].strip().strip('"').strip("'")
    return None

def sync_orchestrate(api_key, task, prompt, extra=None, timeout=180):
    body = {"prompt": prompt, "taskType": task, "jurisdiction": "IN", "maxTokens": 512}
    if extra:
        body.update(extra)
    headers = {
        "Content-Type": "application/json",
        "X-API-Key": api_key,
        "X-NYV-Platform": "nsp",
    }
    if extra and extra.get("syncTimeoutMs"):
        headers["X-NYV-Partner-Sync-Timeout-Ms"] = str(extra["syncTimeoutMs"])
    data = json.dumps(body).encode()
    req = urllib.request.Request(f"{BASE}/api/jrx/orchestrate", data=data, headers=headers, method="POST")
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        j = json.loads(resp.read().decode())
    ms = int((time.time() - t0) * 1000)
    d = j.get("data") or j
    routing = d.get("routing") or {}
    return ms, routing.get("path"), len(str(d.get("content") or "")), d.get("taskType"), j.get("success")

def stream_ttfb(api_key, task, prompt, timeout=180):
    body = json.dumps({"prompt": prompt, "taskType": task, "jurisdiction": "IN", "maxTokens": 512}).encode()
    headers = {
        "Content-Type": "application/json",
        "X-API-Key": api_key,
        "X-NYV-Platform": "nsp",
    }
    req = urllib.request.Request(f"{BASE}/api/jrx/orchestrate/stream", data=body, headers=headers, method="POST")
    t0 = time.time()
    ttfb = None
    deltas = 0
    total_bytes = 0
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        while True:
            line = resp.readline()
            if not line:
                break
            total_bytes += len(line)
            if ttfb is None and line.strip():
                ttfb = int((time.time() - t0) * 1000)
            if b"text_delta" in line or b'"delta"' in line:
                deltas += 1
    total_ms = int((time.time() - t0) * 1000)
    return ttfb, total_ms, deltas, total_bytes

key = load_key("NYV_SDK_KEY_NSP")
if not key or len(key) < 16:
    print("PROBE BROKEN: no NSP key")
    raise SystemExit(3)

print("=== DEPLOY ===")
try:
    print("CURRENT=" + open("/opt/nyayavigya/CURRENT_DEPLOY").read().strip())
except Exception:
    print("CURRENT=missing")

print("\n=== ENV LENS (names/values non-secret) ===")
for name in [
    "NYV_PARTNER_MAX_TOKENS_DRAFT_FAST",
    "NYV_NSP_COUNSEL_QUEEN",
    "NYV_PARTNER_SYNC_BUDGET_MS",
]:
    v = load_env(name)
    print(f"{name}={v if v else '(unset/default)'}")

stamp = uuid.uuid4().hex[:8]
prompt = f"Draft one paragraph bail application prayer under BNSS. Ref {stamp}"

print(f"\n=== STREAM + SYNC PROBE stamp={stamp} ===")
ms, path, clen, tt, ok = sync_orchestrate(key, "legal-draft-fast", prompt)
print(f"sync legal-draft-fast: ms={ms} path={path} content_len={clen} success={ok}")

ttfb, total_ms, deltas, nbytes = stream_ttfb(key, "legal-draft-fast", prompt + " stream")
print(f"stream legal-draft-fast: ttfb_ms={ttfb} total_ms={total_ms} delta_events={deltas} bytes={nbytes}")

ms2, path2, clen2, tt2, ok2 = sync_orchestrate(
    key, "legal-draft", prompt + " bare", {"syncTimeoutMs": 90000}
)
print(
    f"bare legal-draft+syncBudget90s: ms={ms2} path={path2} "
    f"effective_taskType={tt2} content_len={clen2} success={ok2}"
)

ms3, path3, clen3, tt3, ok3 = sync_orchestrate(key, "legal-draft", prompt + " bareNoBudget")
print(
    f"bare legal-draft (no sync budget): ms={ms3} path={path3} "
    f"taskType={tt3} content_len={clen3} success={ok3}"
)
PY
