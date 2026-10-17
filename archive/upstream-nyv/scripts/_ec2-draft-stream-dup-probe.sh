#!/usr/bin/env bash
# NV-DRAFT-STREAM-DUP-PROBE — detect repeated text / garbage in stream vs sync.
# Keys from canonical env only. Never echo secret values.
set -uo pipefail

python3 <<'PY'
import json, time, urllib.request, urllib.error, uuid, re, hashlib

CANON = "/opt/Nyayavigya/secrets/.env.production"
BASE = "https://api.nyayasiddhi.online"

BAIL_PROMPT = """Draft a complete bail application under BNSS for anticipatory bail before the Sessions Court, Delhi.

Facts:
- Applicant: Rajesh Kumar, aged 34, resident of Dwarka, Delhi
- FIR No. 245/2025 dated 15-Aug-2025, PS Dwarka South, offences under Sections 420, 468, 471 IPC
- Applicant apprehends arrest; co-accused already in custody; applicant is sole breadwinner
- Applicant undertakes to cooperate with investigation; no flight risk; roots in community

Include: title, court heading, parties, synopsis, grounds, prayer, verification."""

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

def find_repeated_paragraphs(text, min_len=40):
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if len(p.strip()) >= min_len]
    seen = {}
    dups = []
    for p in paras:
        key = re.sub(r"\s+", " ", p.lower())[:200]
        if key in seen:
            dups.append((seen[key], p[:120]))
        else:
            seen[key] = p[:120]
    return dups

def count_prayer_blocks(text):
    return len(re.findall(r"\*\*PRAYER\*\*", text, re.I))

def sync_orchestrate(api_key, body, timeout=180):
    headers = {
        "Content-Type": "application/json",
        "X-API-Key": api_key,
        "X-NYV-Platform": "nsp",
    }
    data = json.dumps(body).encode()
    req = urllib.request.Request(f"{BASE}/api/jrx/orchestrate", data=data, headers=headers, method="POST")
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        j = json.loads(resp.read().decode())
    ms = int((time.time() - t0) * 1000)
    d = j.get("data") or j
    content = str(d.get("content") or "")
    return ms, content, d, j.get("success")

def stream_orchestrate(api_key, body, timeout=180):
    headers = {
        "Content-Type": "application/json",
        "X-API-Key": api_key,
        "X-NYV-Platform": "nsp",
    }
    data = json.dumps(body).encode()
    req = urllib.request.Request(f"{BASE}/api/jrx/orchestrate/stream", data=data, headers=headers, method="POST")
    t0 = time.time()
    events = []
    last_accum = ""
    gated_accum = None
    run_completed_content = None
    delta_count = 0
    gated_count = 0
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        buf = ""
        while True:
            chunk = resp.read(4096)
            if not chunk:
                break
            buf += chunk.decode("utf-8", errors="replace")
            while "\n" in buf:
                line, buf = buf.split("\n", 1)
                line = line.strip()
                if not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if payload == "[DONE]":
                    continue
                try:
                    ev = json.loads(payload)
                except Exception:
                    continue
                events.append(ev)
                et = ev.get("type")
                if et == "text_delta":
                    delta_count += 1
                    acc = ev.get("accumulated") or ""
                    if ev.get("gated"):
                        gated_count += 1
                        gated_accum = acc
                    last_accum = acc
                elif et == "run_completed":
                    res = ev.get("result") or {}
                    run_completed_content = str(res.get("result") or res.get("content") or "")

    ms = int((time.time() - t0) * 1000)
    return {
        "ms": ms,
        "delta_count": delta_count,
        "gated_count": gated_count,
        "last_accum": last_accum,
        "gated_accum": gated_accum,
        "run_completed_content": run_completed_content,
        "event_types": [e.get("type") for e in events],
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

print("\n=== ENV LENS ===")
for name in [
    "NYV_STREAM_TERMINAL_POLISH",
    "NYV_F_PROVIDER_TOKEN_STREAM",
    "NYV_FAST_DELIVERY_POLISH",
    "NYV_PARTNER_MAX_TOKENS_DRAFT_FAST",
]:
    v = load_env(name)
    print(f"{name}={v if v else '(unset/default)'}")

stamp = uuid.uuid4().hex[:8]
body = {
    "prompt": BAIL_PROMPT + f" Ref {stamp}",
    "taskType": "legal-draft-fast",
    "jurisdiction": "IN",
    "parameters": {"documentType": "bail_application"},
    "options": {"draftLength": "medium"},
}

print(f"\n=== SYNC PROBE stamp={stamp} ===")
sync_ms, sync_content, sync_data, sync_ok = sync_orchestrate(key, body)
print(f"sync: ms={sync_ms} len={len(sync_content)} success={sync_ok}")
print(f"sync prayer_blocks={count_prayer_blocks(sync_content)}")
sync_dups = find_repeated_paragraphs(sync_content)
print(f"sync repeated_paras={len(sync_dups)}")
if sync_dups:
    for i, (a, b) in enumerate(sync_dups[:3]):
        print(f"  dup{i}: {a!r} ...")

print(f"\n=== STREAM PROBE stamp={stamp} ===")
stream = stream_orchestrate(key, body)
print(f"stream: ms={stream['ms']} deltas={stream['delta_count']} gated={stream['gated_count']}")
print(f"stream last_accum_len={len(stream['last_accum'] or '')}")
print(f"stream gated_accum_len={len(stream['gated_accum'] or '') if stream['gated_accum'] else 0}")
print(f"stream run_completed_len={len(stream['run_completed_content'] or '')}")

final_stream = stream["gated_accum"] or stream["last_accum"] or ""
print(f"stream prayer_blocks={count_prayer_blocks(final_stream)}")
stream_dups = find_repeated_paragraphs(final_stream)
print(f"stream repeated_paras={len(stream_dups)}")
if stream_dups:
    for i, (a, b) in enumerate(stream_dups[:5]):
        print(f"  dup{i}: {a!r} ...")

# Compare accum vs run_completed — duplication signal
rc = stream["run_completed_content"] or ""
if final_stream and rc:
    if rc == final_stream:
        print("stream accum == run_completed (OK replace semantics)")
    elif final_stream in rc or rc in final_stream:
        print("stream WARNING: one content substring of other (possible append dup)")
    else:
        # check overlap at boundary
        overlap = 0
        for n in range(min(len(final_stream), len(rc)), 50, -1):
            if final_stream[-n:] == rc[:n]:
                overlap = n
                break
        print(f"stream accum vs run_completed overlap_chars={overlap}")

# Sample first/last 500 chars (no secrets)
def sample(text, label):
    if not text:
        print(f"{label}_first500=(empty)")
        print(f"{label}_last500=(empty)")
        return
    print(f"{label}_first500={text[:500]!r}")
    print(f"{label}_last500={text[-500:]!r}")

print("\n=== SAMPLES (first/last 500 chars) ===")
sample(sync_content, "sync")
sample(final_stream, "stream_final")

failures = []
if len(stream_dups) > len(sync_dups) + 1:
    failures.append(f"stream has more repeated paragraphs than sync ({len(stream_dups)} vs {len(sync_dups)})")
if count_prayer_blocks(final_stream) > 2:
    failures.append(f"stream has {count_prayer_blocks(final_stream)} PRAYER blocks (expected <=2)")
if len(final_stream) > 0 and len(final_stream) < 1500:
    failures.append(f"stream content too short ({len(final_stream)} chars) — possible truncation garbage")

if failures:
    print("\nPROBE FAIL:")
    for f in failures:
        print(f"  - {f}")
    raise SystemExit(2)
print("\nPROBE PASS (no obvious duplication signals)")
PY
