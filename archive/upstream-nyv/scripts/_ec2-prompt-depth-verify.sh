#!/bin/sh
# NV-AGENT-PROMPT-DEPTH-001 — verify the fix is live in the RUNNING container.
#
# Correction to the first version of this script: it grepped only `dist/`, found
# nothing, and I briefly mis-read that as "the deploy did not land". The gateway
# runs the TypeScript sources via tsx, so `src/` is the correct place to look —
# dist/ holds the built Console assets, not the server.

CT=nyv-gateway
echo "container=$CT"
echo "started=$(docker inspect -f '{{.State.StartedAt}}' $CT 2>/dev/null)"

echo
echo "== markers in the running container's src/ (authoritative) =="
for M in NV-AGENT-PROMPT-DEPTH-001 resolveAgentPromptDepth NYV_AGENT_PROMPT_DEPTH \
         NV-COT-AUTO-STRATEGY-001 selectCoTStrategy; do
  N=$(docker exec $CT sh -lc "grep -rl '$M' src/ 2>/dev/null | wc -l" 2>/dev/null | tr -d ' \r')
  echo "$M=${N:-0}"
done

echo
echo "== the six quality sections are now parsed by the bundle =="
for S in section_3_jurisdiction section_4_reasoning section_5_evidence \
         section_6_citation section_17_output section_18_quality_checklist; do
  N=$(docker exec $CT sh -lc "grep -c \"$S\" src/services/jrx-agent-prompt-bundle.ts 2>/dev/null" 2>/dev/null | tr -d ' \r')
  echo "$S=${N:-0}"
done

echo
echo "== depth wired at all three assembly sites =="
for F in src/services/jrx-client.ts src/orchestration/jrx-queen-leaf-prompt.ts; do
  N=$(docker exec $CT sh -lc "grep -c 'depth:' $F 2>/dev/null" 2>/dev/null | tr -d ' \r')
  echo "$F depth-refs=${N:-0}"
done

echo
echo "== override state (unset = shipped budget-derived default) =="
V=$(docker exec $CT sh -lc 'printenv NYV_AGENT_PROMPT_DEPTH' 2>/dev/null)
echo "NYV_AGENT_PROMPT_DEPTH=${V:-<unset>}"

echo
echo "== health =="
docker exec $CT sh -lc 'wget -q -O- --server-response http://127.0.0.1:5000/health 2>&1 | grep -m1 "HTTP/"' 2>/dev/null
echo "restarts=$(docker inspect -f '{{.RestartCount}}' $CT 2>/dev/null)"
echo "health=$(docker inspect -f '{{.State.Health.Status}}' $CT 2>/dev/null)"
