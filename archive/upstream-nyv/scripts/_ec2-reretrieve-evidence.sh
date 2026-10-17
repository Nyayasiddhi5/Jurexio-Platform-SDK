#!/usr/bin/env bash
# NV-RERETRIEVE-EVIDENCE-001 — the RRF arithmetic says confidence can never
# reach the 0.55 threshold, so re-retrieval must fire on every RAG request.
# Confirm from live logs rather than the response envelope.
set -uo pipefail
CID=$(docker ps --filter 'name=gateway' --format '{{.ID}}' | head -1)
[ -z "$CID" ] && { echo "gateway not found"; exit 0; }
docker logs --tail 20000 "$CID" >/tmp/gw4.log 2>&1

echo "=== auto-rag confidence values actually logged ==="
grep -oE '"confidence":[0-9.]+' /tmp/gw4.log | sort | uniq -c | sort -rn | head -20

echo
echo "=== re-retrieval / reformulate markers ==="
grep -oiE '(re-?retriev[a-z]*|reformulat[a-z]*|reretrieve[a-z_]*)' /tmp/gw4.log \
  | tr 'A-Z' 'a-z' | sort | uniq -c | sort -rn | head -12

echo
echo "=== auto-rag summary lines (last 12) ==="
grep -iE 'auto-rag|autorag' /tmp/gw4.log | tail -12 | cut -c1-300

echo
echo "=== retrievalMethods / layers actually fused ==="
grep -oE '"retrievalMethods":\[[^]]*\]' /tmp/gw4.log | sort | uniq -c | sort -rn | head -10

echo
echo "=== adaptive / corrective / selfrag LLM activity ==="
for p in adaptive-rag corrective-rag self-rag lightrag graphrag; do
  printf '%-16s %s\n' "$p" "$(grep -ci "$p" /tmp/gw4.log || echo 0)"
done

echo
echo "=== embedding calls vs orchestrate requests (embedding cache check) ==="
E=$(grep -c 'GEMINI-EMBED' /tmp/gw4.log || echo 0)
R=$(grep -cE 'POST /api/jrx/orchestrate' /tmp/gw4.log || echo 0)
echo "embeddings=$E orchestrate=$R ratio=$(python3 -c "print(round($E/max($R,1),2))")"
