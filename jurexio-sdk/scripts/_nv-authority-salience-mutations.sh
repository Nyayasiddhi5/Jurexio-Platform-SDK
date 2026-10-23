#!/usr/bin/env bash
# NV-AUTHORITY-SALIENCE-001 — mutation harness.
#
# A test that cannot fail is not a test. Each mutation below removes exactly one
# property from the implementation; the suite MUST go red for each. A mutation
# that stays GREEN names a guard that was never actually tested — that signal has
# repeatedly exposed untested guards in this codebase, so it is reported, not
# hidden.
#
# Restores every file from git at exit, including on interrupt. Deliberately
# does NOT use `git stash`/`checkout -- .` (other agents hold uncommitted work
# here): it copies the two target files aside and copies them back.
set -uo pipefail
cd "$(dirname "$0")/.."

SAL="src/services/jrx-authority-salience.ts"
BAK="$(mktemp -d)/sal.ts"
cp "$SAL" "$BAK"
restore() { cp "$BAK" "$SAL"; }
trap restore EXIT INT TERM

TESTS="tests/unit/jrx-authority-salience.test.ts tests/unit/jrx-authority-salience-detect.test.ts tests/unit/jrx-authority-gap-disclosure.test.ts"

run() {
  local label="$1"
  # Never pipe when the exit code is the measurement.
  local out; out="$(npx vitest run $TESTS --reporter=dot 2>&1)"
  local rc=$?
  local failed; failed="$(printf '%s' "$out" | grep -cE '^ *FAIL|Tests +[0-9]+ failed' || true)"
  if [ "$rc" -ne 0 ]; then
    echo "  RED   (exit $rc) — mutation caught: $label"
  else
    echo "  GREEN (exit 0)  — ⚠ MUTATION SURVIVED: $label"
    echo "$label" >> /tmp/jrx-salience-survivors.txt
  fi
  restore
}

: > /tmp/jrx-salience-survivors.txt

echo "=== positive control: unmutated suite must be GREEN ==="
if npx vitest run $TESTS --reporter=dot >/dev/null 2>&1; then
  echo "  GREEN — baseline is green, mutations are meaningful"
else
  echo "  ✗ baseline is RED — fix the suite before trusting any mutation result"
  exit 1
fi

echo
echo "=== M1: applyTierSalience becomes the identity (removes the whole reorder) ==="
perl -0pi -e 's/  if \(!request \|\| ranked\.length < 2\) return \[\.\.\.ranked\];/  if (true) return [...ranked];/' "$SAL"
run "M1 identity reorder"

echo "=== M2: credit becomes unbounded (requested tier always wins) ==="
perl -0pi -e 's/effective: chunk\.courtTier === request\.tier \? index - credit : index,/effective: chunk.courtTier === request.tier ? -1000 + index : index,/' "$SAL"
run "M2 unbounded credit — the SC-first regression"

echo "=== M3: within-tier stability removed (tie-break dropped) ==="
perl -0pi -e 's/\.sort\(\(a, b\) => \(a\.effective - b\.effective\) \|\| \(a\.index - b\.index\)\)/.sort((a, b) => (a.effective - b.effective) || (b.index - a.index))/' "$SAL"
run "M3 unstable within tier"

echo "=== M4: inferred credit equals named credit ==="
perl -0pi -e 's/export const INFERRED_TIER_RANK_CREDIT = 2;/export const INFERRED_TIER_RANK_CREDIT = 3;/' "$SAL"
run "M4 inferred credit not weaker"

echo "=== M5: multi-tier ambiguity guess instead of null ==="
perl -0pi -e 's/  if \(named\.size > 1\) return null;/  \/\/ mutated/' "$SAL"
run "M5 ambiguous multi-tier no longer null"

echo "=== M6: stripTierRequestTerms may return empty ==="
perl -0pi -e 's/  return words\.length >= 2 \? words\.join\(. .\) : original;/  return words.join(" ");/' "$SAL"
run "M6 stripping can empty the query"

echo "=== M7: tier phrases no longer stripped (root-cause fix removed) ==="
perl -0pi -e 's/  for \(const \{ re \} of TIER_PHRASES\) out = out\.replace\(new RegExp\(re\.source, re\.flags\), . .\);/  \/\/ mutated/' "$SAL"
run "M7 unmatchable tier words left in the FTS query"

echo "=== M8: assessAuthorityGap never reports unmet ==="
perl -0pi -e 's/    unmet: ofTier\.length === 0,/    unmet: false,/' "$SAL"
run "M8 gap never unmet — disclosure silenced"

echo "=== M9: citableCount ignores reporter citation ==="
perl -0pi -e 's/  const citable = ofTier\.filter\(\(c\) => c\.hasReporterCitation === true\);/  const citable = ofTier;/' "$SAL"
run "M9 citable count conflated with tier count"

echo "=== M10: weight cues no longer infer a tier ==="
perl -0pi -e 's/    tier = .sc.;\n    inferred = true;/    tier = null;/' "$SAL"
run "M10 leading\/landmark stops inferring SC"

echo "=== M11: resolveAuthoritySalience stops deriving the request from the prompt ==="
# The defect this replaced: the request was read off a network hop's result, so
# the disclosure went silent exactly when retrieval had failed.
perl -0pi -e 's/  const request = detectAuthorityTierRequest\(query\);/  const request = null as AuthorityTierRequest | null;/' "$SAL"
run "M11 request no longer derived from the prompt"

echo "=== M12: resolveAuthoritySalience drops the gap while keeping the reorder ==="
perl -0pi -e 's/    gap: assessAuthorityGap\(after, request\),/    gap: null,/' "$SAL"
run "M12 gap dropped from the resolved result"

echo "=== M13: reordered telemetry hard-coded true ==="
perl -0pi -e 's/    reordered: before !== after\.map\(\(c\) => c\.id \?\? ..\)\.join\(.\|.\),/    reordered: true,/' "$SAL"
run "M13 reordered flag always true"

echo
echo "================ SURVIVORS ================"
if [ -s /tmp/jrx-salience-survivors.txt ]; then
  cat /tmp/jrx-salience-survivors.txt
  echo "(each line above is a property with no test that fails when it is removed)"
else
  echo "none — every mutation was caught"
fi
