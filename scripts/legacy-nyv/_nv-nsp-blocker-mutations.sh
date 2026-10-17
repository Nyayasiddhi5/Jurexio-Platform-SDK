#!/usr/bin/env bash
# NV-ANALYZE-STATUS-005 / NV-NSP-503-PERMANENCE-006 mutation harness.
#
# A test that cannot fail proves nothing. Each mutation below breaks exactly one
# behaviour the new tests claim to protect; every one MUST turn the suite red. Any
# mutation that stays GREEN is reported as a gap rather than quietly dropped.
#
# Restores every file from git at exit (including on failure), and verifies the tree
# is clean afterwards so a mutation can never be left behind.
set -uo pipefail
cd "$(dirname "$0")/.."

FIELDS=src/services/jrx-court-document-fields.ts
CLIENT=src/services/jrx-nys-knowledge-client.ts
ORCH=src/routes/jrx-orchestration-routes.ts
PIPE=src/routes/jrx-sdk-doc-pipeline-routes.ts
DOCSVC=src/services/legal-doc-analyze-service.ts
ALL=("$FIELDS" "$CLIENT" "$ORCH" "$PIPE" "$DOCSVC")

TESTS="tests/unit/jrx-nsp-analyze-status-and-breaker.test.ts tests/unit/jrx-court-doc-fields-all-paths.test.ts tests/unit/jrx-court-document-fields.test.ts tests/unit/jrx-session-header-and-analyze-parity.test.ts"

# Snapshot by COPY, never `git checkout --`. Other agents hold uncommitted work in this
# tree, and an earlier version of this harness restored from git and destroyed the very
# edits it was meant to test. Copies restore exactly what was here on entry.
BAK=$(mktemp -d)
for f in "${ALL[@]}"; do
  mkdir -p "$BAK/$(dirname "$f")"
  cp "$f" "$BAK/$f"
done
echo "snapshot: ${#ALL[@]} files copied to a temp dir (no git operations)"

restore() {
  for f in "${ALL[@]}"; do cp "$BAK/$f" "$f"; done
}
cleanup() { restore; rm -rf "$BAK"; }
trap cleanup EXIT

# Positive control: the suite must be GREEN before any mutation, otherwise a red
# result below says nothing about the mutation.
restore
if npx vitest run $TESTS >/tmp/mut-base.log 2>&1; then
  echo "CONTROL: baseline GREEN (as required)"
else
  echo "CONTROL FAILED: baseline is already RED — harness invalid"; tail -20 /tmp/mut-base.log; exit 1
fi

run_mut() { # name file sed-expr
  local name="$1" file="$2" expr="$3"
  restore
  local before; before=$(cksum < "$file")
  perl -0pi -e "$expr" "$file"
  if [ "$(cksum < "$file")" = "$before" ]; then
    echo "M-$name: SKIPPED (pattern did not apply — mutation not installed)"
    return
  fi
  if npx vitest run $TESTS >/tmp/mut.log 2>&1; then
    echo "M-$name: *** STAYED GREEN — TEST GAP ***"
  else
    echo "M-$name: RED (caught) — $(grep -oE '[0-9]+ failed' /tmp/mut.log | head -1)"
  fi
}

echo "=== NYV-6 analysisStatus mutations ==="
# 1. Status can only ever say "structured" — the "one value" defect in a new key.
run_mut "status-always-structured" "$FIELDS" \
  "s/analysisStatus = 'unstructured';/analysisStatus = 'structured';/"
# 2. A thrown extraction reports as merely empty — the exact NSP defect restored.
run_mut "failed-collapses-to-unstructured" "$FIELDS" \
  "s/if \(outcome\?\.failed\) \{/if (false) {/"
# 3. Populated result mislabelled — success value unreachable.
run_mut "structured-collapses-to-unstructured" "$FIELDS" \
  "s/\} else if \(populated\) \{/} else if (false) {/"
# 4. Reason string emptied — status with no explanation.
run_mut "reason-emptied" "$FIELDS" \
  "s/'Analysis completed and found no structured values in this document; empty arrays are a result, not a failure.'/''/"
# 5. Flat aliases no longer count toward structured (contract case regresses).
run_mut "populated-ignores-flat-aliases" "$FIELDS" \
  "s/fieldCount > 0\n    \|\| statutes\.length > 0/fieldCount > 0 \&\& false || false/s"
# 6. Orchestrate reverts to the fieldCount>0 gate — three-of-four paths again.
run_mut "orchestrate-refits-fieldcount-gate" "$ORCH" \
  "s/courtDocFieldBlock = buildCourtDocFieldBlock\(extraction, null, null\);/if (extraction \&\& extraction.fieldCount > 0) { courtDocFieldBlock = buildCourtDocFieldBlock(extraction, null, null); }/"
# 7. Degraded docs-pipeline branch stops reporting failure.
run_mut "degraded-drops-failed-flag" "$PIPE" \
  "s/failed: true,\n          reason: sanitizeErrorForClient/failed: false,\n          reason: sanitizeErrorForClient/s"
# 8. EDJ worker stops recording rejected extractors. Mutates the pure helper now that
#    the derivation is extracted — the earlier source-grep-only assertion could not see
#    this and the mutation stayed green.
run_mut "edj-drops-failed-extractors" "$DOCSVC" \
  "s/\.filter\(\(\[, s\]\) => s\.status === 'rejected'\)/.filter(() => false)/"
# 8b. EDJ reports failure as merely empty.
run_mut "edj-failed-reads-unstructured" "$DOCSVC" \
  "s/if \(failedExtractors\.length > 0\) \{/if (false) {/"
# 8c. analyzeDocument stops using the derivation at all.
run_mut "edj-status-block-not-spread" "$DOCSVC" \
  "s/\.\.\.statusBlock,/analysisStatus: 'structured', analysisStatusReason: 'x', failedExtractors: [],/"

echo "=== NYV-10 breaker partition mutations ==="
# 9. Breaker reverts to process-global — hybrid takes fts (and everything) down.
run_mut "breaker-global-again" "$CLIENT" \
  "s/return path\.split\('\?'\)\[0\]\.split\('\/'\)\.filter\(Boolean\)\.slice\(0, 2\)\.join\('\/'\) \|\| 'root';/return 'global';/"
# 10. Breaker never opens at all — protection lost (opposite failure).
run_mut "breaker-never-opens" "$CLIENT" \
  "s/if \(b\.consecutiveFailures < cbFailures\(\)\) return 'closed';/return 'closed';/"
# 11. Surface name dropped from the message — operator cannot see which tripped.
run_mut "breaker-message-loses-surface" "$CLIENT" \
  "s/error: \`NYS knowledge circuit open \(\\\$\{key\}\)\`/error: 'NYS knowledge circuit open'/"
# 12. openCircuits always empty — stats hide a tripped surface.
run_mut "breaker-stats-hide-open" "$CLIENT" \
  "s/openCircuits: \[\.\.\.breakers\.keys\(\)\]\.filter\(\(k\) => circuitState\(k\) === 'open'\)/openCircuits: []/"

restore
echo "=== restoration check ==="
ok=1
for f in "${ALL[@]}"; do
  if ! cmp -s "$BAK/$f" "$f"; then echo "*** RESTORE FAILED: $f ***"; ok=0; fi
done
if [ "$ok" = 1 ]; then
  echo "RESTORED: all mutated files byte-identical to the entry snapshot"
else
  exit 1
fi
