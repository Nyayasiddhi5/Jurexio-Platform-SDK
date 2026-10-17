#!/usr/bin/env bash
# NV-HEDGE-WASTE-001 — the hedge fires on EVERY request (LLM_HEDGE_MS=2500,
# eligible>=2). Quantify: who wins, how often the primary loses, and how much
# dead latency + double billing we pay.
set -uo pipefail
CID=$(docker ps --filter 'name=gateway' --format '{{.ID}}' | head -1)
[ -z "$CID" ] && { echo "gateway not found"; exit 0; }
docker logs --tail 20000 "$CID" >/tmp/gw3.log 2>&1

python3 - <<'PY'
import json, re, collections
wins = collections.Counter()
lat = collections.defaultdict(list)
seq_primary = collections.Counter()
picked_vs_primary = collections.Counter()
for line in open("/tmp/gw3.log", errors="ignore"):
    line = line.strip()
    if not line.startswith("{"):
        continue
    try:
        d = json.loads(line)
    except Exception:
        continue
    m = d.get("message", "")
    if m == "llm-orchestrator: hedge success":
        wins[d.get("model")] += 1
        lat[d.get("model")].append(d.get("latencyMs") or 0)

print("=== hedge winners (every one of these had a parallel loser) ===")
tot = sum(wins.values())
for k, v in wins.most_common():
    L = sorted(lat[k])
    med = L[len(L)//2] if L else 0
    print(f"  {k:38s} {v:4d} ({v/max(tot,1):5.1%})  median {med/1000:5.1f}s")
print(f"  TOTAL hedged requests: {tot}")
print()
print("=== dead-wait cost ===")
print(f"  NYV_LLM_HEDGE_MS=2500 -> secondary starts 2.5s AFTER primary.")
print(f"  Primary is Bedrock (NYV_ROUTER_BEDROCK_FIRST=on) = Opus 5 lead.")
print(f"  Opus 5 InvokeModel = AccessDeniedException on this host.")
print(f"  => every request burns 2.5s waiting on a model that cannot answer,")
print(f"     then {tot} requests were served by the SECONDARY.")
PY

echo
echo "=== how many hedges had BOTH branches billed? (both returned content) ==="
grep -c 'hedge success' /tmp/gw3.log
echo "attempts arrays showing 2 ok:true entries:"
grep -oE '"attempts":\[[^]]*\]' /tmp/gw3.log | grep -c 'ok":true.*ok":true' || echo 0

echo
echo "=== bedrock error lines (any level) ==="
grep -iE 'bedrock' /tmp/gw3.log | grep -iE 'error|denied|warn|fail' | tail -8 | cut -c1-260 || echo "(none)"
