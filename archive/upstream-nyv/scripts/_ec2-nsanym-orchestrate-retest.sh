#!/usr/bin/env bash
# NV-LLM-EMPTY-001: live NSA + NYM /orchestrate empty-content re-test on EC2.
# Reproduces the WARN_EMPTY_CONTENT certification failure (docs/canonical/
# 11-consumer-platform-e2e-2026-05-13.md §4/§5) using the exact cert-harness
# payload, then reports content length + model + tokens per call. Run the same
# script before and after the fix deploy to capture before/after evidence.
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
BASE="https://api.nyayasiddhi.online"

[[ -f "$CANON" ]] || { echo "ERROR: missing $CANON" >&2; exit 2; }

python3 <<'PY'
import json, re, time, urllib.request, urllib.error
from datetime import datetime, timezone

CANON = "/opt/Nyayavigya/secrets/.env.production"
BASE = "https://api.nyayasiddhi.online"
OUT = f"/tmp/nsanym-orchestrate-retest-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json"

# Same fact-set the cert harness uses for the orchestrate test.
FACTS_LEGAL = (
    "Acme Pvt Ltd entered a software development agreement with Globex on 2024-03-01. "
    "Globex failed to deliver Milestone 2 by the agreed date, and Acme withheld the "
    "second tranche of payment, alleging breach. Globex claims force majeure due to a "
    "data-centre outage and demands full payment plus interest."
)

def load_key(name):
    pref = f"{name}="
    for line in open(CANON):
        if line.startswith(pref):
            return line.strip().split("=", 1)[1].strip().strip('"').strip("'")
    return None

def http_json(method, url, body=None, api_key=None, timeout=120):
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["X-API-Key"] = api_key
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw.strip() else {}
    except TimeoutError:
        return 504, {"error": f"client timeout after {timeout}s"}
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            j = json.loads(raw)
        except Exception:
            j = {"error": raw[:500]}
        return e.code, j

BODY = {
    "prompt": "Summarize this contract dispute in 2 sentences: " + FACTS_LEGAL,
    "agentId": "summarizer", "jurisdiction": "IN", "taskType": "summarize", "mode": "sync",
}

_, health = http_json("GET", f"{BASE}/api/jrx/health")
print(f"health.version={health.get('version')} registry={health.get('registryVersion')}\n")

ITER = 3
results = []
for plat in ("NSA", "NYM"):
    key = load_key(f"NYV_SDK_KEY_{plat}")
    if not key:
        print(f"{plat}: ERROR NYV_SDK_KEY_{plat} not in canonical env"); 
        results.append({"platform": plat, "error": "key-missing"}); continue
    for i in range(1, ITER + 1):
        t0 = time.time()
        status, j = http_json("POST", f"{BASE}/api/jrx/orchestrate", BODY, api_key=key)
        elapsed = int((time.time() - t0) * 1000)
        data = j.get("data") or j
        content = data.get("content") or ""
        if isinstance(content, dict):
            content = content.get("text") or str(content)
        content = str(content)
        model = data.get("model")
        tokens = data.get("tokens")
        warn = (status == 200 and bool(j.get("success")) and model and not content.strip())
        r = {
            "platform": plat, "iter": i, "httpStatus": status, "elapsedMs": elapsed,
            "model": model, "provider": data.get("provider"), "tier": data.get("tier"),
            "tokens": tokens, "contentLength": len(content.strip()),
            "WARN_EMPTY_CONTENT": warn,
            "contentPreview": " ".join(content.split())[:200],
            "error": j.get("error"),
        }
        results.append(r)
        flag = " <<< WARN_EMPTY_CONTENT" if warn else ""
        print(f"{plat} #{i}: HTTP {status} | {elapsed}ms | model={model} | "
              f"tokens={tokens.get('total') if isinstance(tokens, dict) else tokens} | "
              f"len={len(content.strip())}{flag}")
        if r["error"]:
            print(f"   error={r['error']}")
        if content.strip():
            print(f"   preview={r['contentPreview'][:160]}")
        print()

empty_count = sum(1 for r in results if r.get("WARN_EMPTY_CONTENT"))
verdict = "EMPTY_CONTENT_PRESENT" if empty_count else "ALL_NON_EMPTY"
summary = {
    "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    "base": BASE, "healthVersion": health.get("version"),
    "iterationsPerPlatform": ITER, "emptyContentCount": empty_count,
    "verdict": verdict, "results": results,
}
open(OUT, "w").write(json.dumps(summary, indent=2))
print(f"Wrote {OUT}")
print(f"VERDICT: {verdict} (empty-content occurrences: {empty_count}/{len(results)})")
PY
