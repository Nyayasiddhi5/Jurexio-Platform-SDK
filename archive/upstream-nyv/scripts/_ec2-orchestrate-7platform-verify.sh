#!/usr/bin/env bash
# NV-LLM-EMPTY-001: live 7-platform /orchestrate verification on EC2.
# Confirms NSP, NSPM, NSI, NSM, JRX, NSA, NYM all return non-empty synthesized
# content, plus a NYM Hindi/Indic citizen-path query. Runs calls in parallel
# threads to keep wall time bounded despite per-call LLM latency.
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
[[ -f "$CANON" ]] || { echo "ERROR: missing $CANON" >&2; exit 2; }

python3 <<'PY'
import json, re, time, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

CANON = "/opt/Nyayavigya/secrets/.env.production"
BASE = "https://api.nyayasiddhi.online"
OUT = f"/tmp/orchestrate-7platform-verify-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json"

FACTS = ("Acme Pvt Ltd signed a software development agreement with Globex on 2024-03-01. "
         "Globex missed Milestone 2; Acme withheld the second payment tranche alleging breach. "
         "Globex claims force majeure due to a data-centre outage and demands full payment plus interest.")

def load_key(name):
    pref = f"{name}="
    for line in open(CANON):
        if line.startswith(pref):
            return line.strip().split("=", 1)[1].strip().strip('"').strip("'")
    return None

def http_json(method, url, body=None, api_key=None, timeout=280):
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
        try: j = json.loads(raw)
        except Exception: j = {"error": raw[:500]}
        return e.code, j
    except Exception as e:
        return 0, {"error": f"{type(e).__name__}: {e}"}

EN_BODY = {"prompt": "Summarize this contract dispute in 2 sentences: " + FACTS,
           "agentId": "summarizer", "jurisdiction": "IN", "taskType": "summarize", "mode": "sync"}
HI_BODY = {"prompt": "इस अनुबंध विवाद को सरल हिंदी में दो वाक्यों में समझाइए: " + FACTS,
           "agentId": "summarizer", "jurisdiction": "IN", "taskType": "summarize", "language": "hi", "mode": "sync"}

# (label, platform-key-name, body)
JOBS = [
    ("NSP",       "NYV_SDK_KEY_NSP",  EN_BODY),
    ("NSPM",      "NYV_SDK_KEY_NSPM", EN_BODY),
    ("NSI",       "NYV_SDK_KEY_NSI",  EN_BODY),
    ("NSM",       "NYV_SDK_KEY_NSM",  EN_BODY),
    ("JRX",       "NYV_SDK_KEY_JRX",  EN_BODY),
    ("NSA",       "NYV_SDK_KEY_NSA",  EN_BODY),
    ("NYM",       "NYV_SDK_KEY_NYM",  EN_BODY),
    ("NYM-HINDI", "NYV_SDK_KEY_NYM",  HI_BODY),
]

_, health = http_json("GET", f"{BASE}/api/jrx/health", timeout=20)
print(f"health.version={health.get('version')} registry={health.get('registryVersion')}\n", flush=True)

def run(job):
    label, keyname, body = job
    key = load_key(keyname)
    if not key:
        return {"platform": label, "error": f"{keyname} missing"}
    t0 = time.time()
    status, j = http_json("POST", f"{BASE}/api/jrx/orchestrate", body, api_key=key)
    elapsed = int((time.time() - t0) * 1000)
    data = j.get("data") or j
    content = data.get("content") or ""
    if isinstance(content, dict):
        content = content.get("text") or str(content)
    content = str(content)
    tokens = data.get("tokens")
    warn = (status == 200 and bool(j.get("success")) and not content.strip())
    return {
        "platform": label, "httpStatus": status, "elapsedMs": elapsed,
        "model": data.get("model"), "provider": data.get("provider"), "tier": data.get("tier"),
        "tokens": tokens, "contentLength": len(content.strip()),
        "WARN_EMPTY_CONTENT": warn,
        "contentPreview": " ".join(content.split())[:400],
        "error": j.get("error"),
    }

with ThreadPoolExecutor(max_workers=8) as ex:
    results = list(ex.map(run, JOBS))

order = {j[0]: i for i, j in enumerate(JOBS)}
results.sort(key=lambda r: order.get(r["platform"], 99))

for r in results:
    flag = " <<< WARN_EMPTY_CONTENT" if r.get("WARN_EMPTY_CONTENT") else ""
    tok = r.get("tokens")
    tok = tok.get("total") if isinstance(tok, dict) else tok
    print(f"== {r['platform']} == HTTP {r.get('httpStatus')} | {r.get('elapsedMs')}ms | "
          f"model={r.get('model')} | tokens={tok} | len={r.get('contentLength')}{flag}", flush=True)
    if r.get("error"):
        print(f"   error={r['error']}", flush=True)
    if r.get("contentPreview"):
        print(f"   content: {r['contentPreview']}", flush=True)
    print(flush=True)

non_empty = sum(1 for r in results if r.get("contentLength", 0) > 0 and r.get("httpStatus") == 200)
empties = [r["platform"] for r in results if r.get("WARN_EMPTY_CONTENT")]
verdict = "ALL_NON_EMPTY" if not empties and non_empty == len(results) else (
    "EMPTY_PRESENT" if empties else "SOME_FAILED")
summary = {
    "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    "base": BASE, "healthVersion": health.get("version"),
    "nonEmptyOk": non_empty, "total": len(results),
    "emptyContentPlatforms": empties, "verdict": verdict, "results": results,
}
open(OUT, "w").write(json.dumps(summary, indent=2))
print(f"Wrote {OUT}")
print(f"VERDICT: {verdict} ({non_empty}/{len(results)} non-empty 200; empty-content: {empties or 'none'})")
PY
