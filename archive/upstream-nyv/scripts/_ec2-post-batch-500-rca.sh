#!/bin/bash
# Isolate the HTTP 500 after deploy 2026-08-16T1238Z.
# Wall time halved (366s -> 176s) so the fan-in bound works, but the request now
# fails AFTER billing 10 completions. Failing fast is WORSE than slow-and-correct:
# we pay for the answer and discard it. Find the throw before optimising further.
set -uo pipefail
G=$(docker ps --filter name=gateway -q | head -1)
L=$(mktemp); docker logs "$G" --since 15m > "$L" 2>&1

echo "=== mandatory-step / envelope / internal error markers ==="
grep -Eio 'mandatory steps missing[^"]*|QualityEnvelopeError|INTERNAL_ERROR' "$L" \
  | sort | uniq -c | sort -rn | head -12

echo
echo "=== orchestration / queen / swarm errors only ==="
grep -Ei '"level":"error"' "$L" | grep -Ei 'orchestrat|queen|envelope|swarm|synthes' | tail -12

echo
echo "=== fan-in bound: did it degrade gracefully or throw? ==="
grep -Eio 'NV-MEM-FANIN[^"]*|fan-in[^"]*|fanin[^"]*' "$L" | sort | uniq -c | head -8

echo
echo "=== memory recall AFTER the bound (was 3x30s, 0 items) ==="
grep -Eo '"recalledCount":[0-9]+|Timed out after [0-9]+ms' "$L" | sort | uniq -c | head -8

echo
echo "=== new stage spans emitting? ==="
grep -Eo 'queen\.mw\.[a-z.]+' "$L" | sort | uniq -c | head -8

echo
echo "=== heap pressure (92% seen earlier - may be the real cause) ==="
grep -Eo '"heapPct":[0-9]+|heap out of memory|OOM' "$L" | sort | uniq -c | head -6

rm -f "$L"
