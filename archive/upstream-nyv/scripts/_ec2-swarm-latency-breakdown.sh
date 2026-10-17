#!/bin/bash
# Focused: where do the 366 seconds and 89,610 prompt tokens actually go?
# Parallel dispatch is already proven (3 lanes at the same ms), so the remaining
# wall time must be per-call latency, sequential ROUNDS, or the synthesis leg.
set -uo pipefail
G=$(docker ps --filter name=gateway -q | head -1)
L=$(mktemp); docker logs "$G" --since 15m > "$L" 2>&1

echo "=== per-call: model / prompt-in / out / latency (chronological) ==="
python3 - "$L" <<'PY'
import re, sys, json
seen = []
for line in open(sys.argv[1], errors='ignore'):
    if '"llm.latency_ms"' not in line:
        continue
    m = re.search(r'"llm\.model":"([^"]+)"', line)
    i = re.search(r'"llm\.tokens\.input":(\d+)', line)
    o = re.search(r'"llm\.tokens\.output":(\d+)', line)
    l = re.search(r'"llm\.latency_ms":(\d+)', line)
    t = re.search(r'"timestamp":"([^"]+)"', line)
    if not (m and l):
        continue
    key = (t.group(1) if t else '', m.group(1), l.group(1))
    if key in seen:
        continue
    seen.append(key)
    print(f"  {t.group(1)[11:23] if t else '?':>12}  {m.group(1):<42} in={i.group(1) if i else '?':>7} out={o.group(1) if o else '?':>6} {int(l.group(1))/1000:>7.1f}s")
print(f"\n  distinct calls: {len(seen)}")
tot = sum(int(k[2]) for k in seen)
print(f"  sum of per-call latency: {tot/1000:.1f}s  (vs 366s wall)")
PY

echo
echo "=== sequential rounds? (consensus / round markers) ==="
grep -Eio 'round [0-9]+|consensus|synthesis|aggregat[a-z]*' "$L" | sort | uniq -c | sort -rn | head -10

echo
echo "=== retries / breaker / quarantine / timeouts during the probe ==="
grep -Eic 'retry|backoff' "$L" | sed 's/^/  retry-ish lines: /'
grep -Eio 'circuit|quarantin[a-z]*|timed out|timeout|deadline' "$L" | sort | uniq -c | sort -rn | head -8
rm -f "$L"
