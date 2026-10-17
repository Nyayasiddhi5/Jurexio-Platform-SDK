#!/bin/sh
# Why did a correctly-configured A/B show zero delta? Determine whether the
# depth ladder is even on the code path these requests took, before concluding
# anything about whether the restored sections help.
#
# Hypotheses to separate:
#   H1 no registry agent was selected  → layered assembler never ran, depth moot
#   H2 an agent ran but budgets are not enforced → promptDepth defaults wide
#   H3 depth ran, but the legal-intelligence overlay ALREADY supplies the BNS /
#      citation guidance, so §3/§6 are redundant on these prompts
#   H4 the answers route through Queen, whose leaf policy resolves separately

CT=nyv-gateway
echo "== recent prompt-assembly / agent-selection signals =="
docker logs --since 25m $CT 2>&1 | grep -Ei 'promptDepth|full_quality|agent=|specialist|assembl|taskClass|budget' | tail -25

echo
echo "== which path served the requests (deterministic / specialist / queen)? =="
docker logs --since 25m $CT 2>&1 | grep -Ei 'nys-statute-map|deterministic|queen|specialist|orchestrat' | tail -20

echo
echo "== CoT strategy actually chosen (NV-COT-AUTO-STRATEGY-001) =="
docker logs --since 25m $CT 2>&1 | grep -Ei 'CoT:|strategy=' | tail -12

echo
echo "== does the overlay already inject BNS guidance? (H3) =="
grep -c 'BNS 2023' src/services/jrx-legal-intelligence-overlay.ts 2>/dev/null \
  || docker exec $CT sh -lc "grep -c 'BNS 2023' src/services/jrx-legal-intelligence-overlay.ts" 2>/dev/null
echo "(non-zero => overlay already carries the repeal guidance, so restoring §3 is partly redundant on these prompts)"

echo
echo "== is prompt budgeting enforced at all? =="
docker exec $CT sh -lc 'printenv | grep -E "NYV_PROMPT_BUDGET|NYV_TOKEN_BUDGET" | sort' 2>/dev/null | head -10
echo "(absent => defaults apply)"
