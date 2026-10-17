#!/usr/bin/env bash
# NV-INLINE-DOC-PROMPT-001 mutation harness.
# Breaks one guard at a time in the SOURCE and asserts the suite goes red.
# A mutation that stays GREEN means the guard is untested — that is the finding.
set -uo pipefail

SUITE="tests/unit/jrx-orchestrate-inline-document.test.ts"
ROUTES="src/routes/jrx-orchestration-routes.ts"
SVC="src/services/jrx-inline-document-prompt.ts"
BAK_DIR=".local/mutation-backup-inline-doc"
mkdir -p "$BAK_DIR"
cp "$ROUTES" "$BAK_DIR/routes.ts"
cp "$SVC" "$BAK_DIR/svc.ts"

restore() { cp "$BAK_DIR/routes.ts" "$ROUTES"; cp "$BAK_DIR/svc.ts" "$SVC"; }
trap restore EXIT

run_suite() {
  npx vitest run "$SUITE" --reporter=dot >/tmp/mut-out.txt 2>&1
  echo $?
}

mutate() { # name file python-replacement-script
  local name="$1" file="$2" script="$3"
  restore
  python3 - "$file" <<PY
import sys
p = sys.argv[1]
s = open(p).read()
$script
open(p, 'w').write(s)
PY
  if [ $? -ne 0 ]; then echo "MUTATION-BROKEN  $name (patch did not apply)"; return; fi
  local rc
  rc=$(run_suite)
  if [ "$rc" -ne 0 ]; then
    echo "KILLED  $name  ($(rg -c '✓|×' /tmp/mut-out.txt >/dev/null 2>&1; rg -o 'Tests +.*' /tmp/mut-out.txt | tail -1))"
  else
    echo "SURVIVED  $name  <-- GUARD UNTESTED"
  fi
}

echo "=== baseline ==="
rc=$(run_suite); echo "baseline rc=$rc  $(rg -o 'Tests +.*' /tmp/mut-out.txt | tail -1)"

# M1 — the sync route stops injecting: dispatch the bare instruction again.
mutate "M1 sync specialist ignores document" "$ROUTES" \
"o='    const groundedPrompt = inlineDoc.injected ? inlineDoc.prompt : prompt;'
assert s.count(o)==1, s.count(o)
s=s.replace(o, '    const groundedPrompt = prompt;')"

# M2 — the Queen branch alone regresses (the historical failure shape).
mutate "M2 queen branch ignores document" "$ROUTES" \
"o='''          prompt: groundedPrompt,
          // NV-REQID-CORRELATION-001'''
assert s.count(o)==1, s.count(o)
s=s.replace(o, '''          prompt,
          // NV-REQID-CORRELATION-001''')"

# M3 — the stream route alone regresses.
mutate "M3 stream branch ignores document" "$ROUTES" \
"o='    const streamGroundedPrompt = streamInlineDoc.injected ? streamInlineDoc.prompt : String(prompt);'
assert s.count(o)==1, s.count(o)
s=s.replace(o, '    const streamGroundedPrompt = String(prompt);')"

# M4 — the doc-pipeline branch alone regresses.
mutate "M4 doc-pipeline branch ignores document" "$ROUTES" \
"o='''          capabilityIds: adaptiveDecision.primaryCapabilityIds,
          prompt: groundedPrompt,'''
assert s.count(o)==1, s.count(o)
s=s.replace(o, '''          capabilityIds: adaptiveDecision.primaryCapabilityIds,
          prompt,''')"

# M5 — the instruction is clobbered by the document (concatenation without task).
mutate "M5 instruction dropped, document only" "$SVC" \
"o='    TASK_BLOCK_START,\n    effectiveInstruction,'
assert s.count(o)==1, s.count(o)
s=s.replace(o, \"    TASK_BLOCK_START,\n    '',\")"

# M6 — truncation stops being enforced: the whole document goes in.
mutate "M6 no budget enforcement" "$SVC" \
"o='  const included = sliceToTokenBudget(documentText, budget.maxContextTokens);'
assert s.count(o)==1, s.count(o)
s=s.replace(o, '  const included = documentText;')"

# M7 — truncation happens but is NOT signalled to the model.
mutate "M7 truncation silent to model" "$SVC" \
"o='  const truncationNotice = truncated'
assert s.count(o)==1, s.count(o)
s=s.replace(o, '  const truncationNotice = false')"

# M8 — truncation is not signalled to the caller.
mutate "M8 truncation silent to caller" "$SVC" \
"o='  if (!c.injected) return null;'
assert s.count(o)==1, s.count(o)
s=s.replace(o, '  if (!c.injected || true) return null;')"

# M9 — document-only request 400s again.
mutate "M9 document-only rejected again" "$ROUTES" \
"o='''    if (req.body && typeof req.body === 'object' && !req.body.prompt && hasInlineDocumentPayload(req.body)) {
      (req.body as Record<string, unknown>).prompt = DEFAULT_DOCUMENT_INSTRUCTION;
    }
    const {
      prompt, agentKey, systemPrompt,'''
assert s.count(o)==1, s.count(o)
s=s.replace(o, '''    const {
      prompt, agentKey, systemPrompt,''')"

# M10 — first-present instead of longest-wins (masks a document behind an instruction).
mutate "M10 first-present candidate selection" "$SVC" \
"o='    if (text.length > best.text.length) best = { text, sourceKey: key };'
assert s.count(o)==1, s.count(o)
s=s.replace(o, '    if (!best.text && text) best = { text, sourceKey: key };')"

# M11 — a plain chat turn gets wrapped anyway (the no-op guarantee breaks).
mutate "M11 wraps requests with no document (single guard)" "$SVC" \
"o='  if (!documentText) return notInjected;'
assert s.count(o)==1, s.count(o)
s=s.replace(o, '  if (false) return notInjected;')"

# M11b — both no-op guards removed. Distinguishes an EQUIVALENT mutant (behaviour
# preserved by the identity guard downstream) from a genuinely untested guard.
mutate "M11b both no-op guards removed" "$SVC" \
"o='''  if (!documentText) return notInjected;
  /* Already inside the prompt (a caller that pasted the document AND mirrored it
   * into \`content\`): injecting again would double the token cost for nothing. */
  if (instruction.includes(documentText)) return notInjected;'''
assert s.count(o)==1, s.count(o)
s=s.replace(o, '  if (false) return notInjected;')"

# M12 — the duplicate candidate list comes back in the route.
mutate "M12 duplicate candidate list restored" "$ROUTES" \
"o='    const docFieldSourceText = selectInlineDocumentText(req.body, prompt, true).text;'
assert s.count(o)==1, s.count(o)
s=s.replace(o, '''    const bodyRec = (req.body || {}) as Record<string, unknown>;
    const docFieldCandidates = [bodyRec.documentContent, bodyRec.documentText, bodyRec.content, bodyRec.text, prompt];
    const docFieldSourceText = docFieldCandidates
      .map((v) => (typeof v === 'string' ? v : ''))
      .reduce((longest, v) => (v.length > longest.length ? v : longest), '');''')"

# M13 — `prompt` becomes a document key, so every chat turn looks "grounded".
mutate "M13 prompt treated as a document key" "$SVC" \
"o='  const selection = selectInlineDocumentText(input.body, null, false);'
assert s.count(o)==1, s.count(o)
s=s.replace(o, '  const selection = selectInlineDocumentText(input.body, instruction, true);')"

echo '=== done ==='
