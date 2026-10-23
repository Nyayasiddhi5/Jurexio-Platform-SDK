#!/usr/bin/env bash
# NV-GOOD-LAW-PANEL-001 — mutation harness.
#
# A test that cannot fail is not a guard. Each mutation below breaks ONE honesty
# rule in the source and the suite must go RED. A mutation that stays GREEN is
# the valuable result: it means the guard was untested.
#
# Reverts with `cp` from an in-place backup — never `git checkout`/`git stash`,
# because concurrent agents hold uncommitted work in this tree.
set -uo pipefail
cd "$(dirname "$0")/.."

LIB=client/src/lib/jrx-good-law.ts
PANEL=client/src/components/execution/GoodLawPanel.tsx
RAIL=client/src/components/execution/ExecutionTraceRail.tsx
SVC=src/services/jrx-nys-judgment-fulltext.ts
SUITE_UI=tests/unit/jrx-good-law-panel.test.tsx
SUITE_SVC=tests/unit/jrx-nys-judgment-fulltext.test.ts

BK=$(mktemp -d)
cp "$LIB" "$BK/lib" && cp "$PANEL" "$BK/panel" && cp "$SVC" "$BK/svc" && cp "$RAIL" "$BK/rail"
restore() { cp "$BK/lib" "$LIB"; cp "$BK/panel" "$PANEL"; cp "$BK/svc" "$SVC"; cp "$BK/rail" "$RAIL"; }
trap 'restore; rm -rf "$BK"' EXIT

PASS=0; SURVIVED=0

# $1 = label, $2 = suite, $3.. = perl -pi -e expressions already applied by caller
run_case() {
  local label="$1" suite="$2"
  if npx vitest run "$suite" >/tmp/jrx-mut.log 2>&1; then
    echo "  SURVIVED (green) — $label"
    SURVIVED=$((SURVIVED+1))
  else
    echo "  killed (red)    — $label  [$(grep -Eo '[0-9]+ failed' /tmp/jrx-mut.log | head -1)]"
    PASS=$((PASS+1))
  fi
  restore
}

echo "== control: unmutated suites must be GREEN =="
if npx vitest run "$SUITE_UI" "$SUITE_SVC" >/tmp/jrx-mut.log 2>&1; then
  echo "  control green (instrument valid)"
else
  echo "  CONTROL RED — the harness is broken, not the mutations. Aborting."
  tail -30 /tmp/jrx-mut.log
  exit 1
fi

echo "== M1: 'unknown' verdict reports itself as good law =="
perl -0pi -e "s/state: 'unknown',\n        headline: 'Treatment unknown — not cleared'/state: 'unknown',\n        headline: 'Good law'/" "$LIB"
run_case "M1 unknown headline says 'Good law'" "$SUITE_UI"

echo "== M2: unknown becomes non-adverse AND severity 'ok'-like (adverse flag flipped on overruled) =="
perl -0pi -e "s/severity: 'adverse',\n        adverse: true,/severity: 'unknown',\n        adverse: false,/g" "$LIB"
run_case "M2 overruled downgraded to severity=unknown/adverse=false" "$SUITE_UI"

echo "== M3: unreachable 'good' verdict becomes a clearance =="
perl -0pi -e "s/    default:\n      \/\*/    case 'good':\n      return { state: 'unknown', headline: 'Good law — cleared', detail: 'x', severity: 'unknown', adverse: false };\n    default:\n      \/\*/" "$LIB"
run_case "M3 'good' handled as a cleared verdict" "$SUITE_UI"

echo "== M4: missing resolution block defaults to matched =="
perl -0pi -e "s/  const matched = r\?\.matched === true;/  const matched = r?.matched !== false;/" "$LIB"
run_case "M4 absent resolution treated as matched" "$SUITE_UI"

echo "== M5: matched:false no longer outranks the wire verdict =="
perl -0pi -e "s/  if \(matched === false\) \{/  if (false) {/" "$LIB"
run_case "M5 unresolved authority no longer overrides verdict" "$SUITE_UI"

echo "== M6: coverage hidden when the payload omits the block =="
perl -0pi -e "s/  if \(!coverage\) \{\n    return \{\n      headline: 'Coverage not reported',/  if (!coverage) {\n    return {\n      headline: '',/" "$LIB"
run_case "M6 missing coverage renders empty headline" "$SUITE_UI"

echo "== M7: coverage element removed from the DOM entirely =="
perl -0pi -e "s/data-testid=\"good-law-coverage-headline\"/data-testid=\"good-law-coverage-headline-HIDDEN\"/" "$PANEL"
run_case "M7 coverage headline testid removed (element gone)" "$SUITE_UI"

echo "== M8: coverage moved behind the rows expander =="
perl -0pi -e "s/(\n      \{\/\* Coverage is a sibling)/\n      \{showRows ? \(<>\1/s" "$PANEL"
perl -0pi -e "s/(data-testid=\"good-law-coverage-detail\"\>\n          \{coverage.detail\}\n        <\/p>\n      <\/div>)/\1\n      <\/>\) : null\}/s" "$PANEL"
# Instrument check: the mutation MUST have changed the file, or a green result
# says nothing. M8 silently no-op'd on the first run and looked like a survivor.
if cmp -s "$BK/panel" "$PANEL"; then echo "  !! M8 DID NOT APPLY (instrument failure)"; fi
run_case "M8 coverage block gated on showRows" "$SUITE_UI"

echo "== M9: unlabelled row defaults to 'deterministic' =="
perl -0pi -e "s/    default:\n      return \{\n        key: 'unknown',\n        label: 'Provenance unknown',\n        reproducible: false,/    default:\n      return {\n        key: 'deterministic',\n        label: 'Verified phrase',\n        reproducible: true,/" "$LIB"
run_case "M9 unknown provenance defaults to Verified phrase" "$SUITE_UI"

echo "== M10: extractedBy chip removed from the row =="
perl -0pi -e "s/                        testId=\"good-law-row-extracted-by\"/                        testId=\"good-law-row-extracted-by-HIDDEN\"/" "$PANEL"
run_case "M10 per-row provenance chip removed" "$SUITE_UI"

echo "== M11: llm rows relabelled identically to deterministic =="
perl -0pi -e "s/        label: 'AI-suggested',/        label: 'Verified phrase',/" "$LIB"
run_case "M11 llm row labelled 'Verified phrase'" "$SUITE_UI"

echo "== M12: platform limitation text dropped from the UI =="
perl -0pi -e "s/^export const NV_GOOD_LAW_LIMITATION =\$/export const NV_GOOD_LAW_LIMITATION = '';\nconst _unused_NV_GOOD_LAW_LIMITATION =/m" "$LIB"
run_case "M12 limitation string emptied" "$SUITE_UI"

echo "== M13: panel auto-fires the check on mount =="
# Replace the abort-cleanup effect with one that fires the check. `runCheck` is
# already declared above this line, so this compiles and really does auto-fire —
# the first version referenced an undeclared ref and TS-erred without failing a
# runtime assertion, which is why it looked like a survivor.
perl -0pi -e "s/  useEffect\(\(\) => \(\) => abortRef.current\?\.abort\(\), \[\]\);/  \/* mutated *\//" "$PANEL"
perl -0pi -e "s/(  const verdict = readGoodLaw\(payload\);)/  useEffect\(\() => \{ void runCheck\(exact\); \}, \[runCheck, exact\]\);\n\1/" "$PANEL"
if cmp -s "$BK/panel" "$PANEL"; then echo "  !! M13 DID NOT APPLY (instrument failure)"; fi
run_case "M13 check fired on mount (cost + no reader intent)" "$SUITE_UI"

echo "== M14: stale verdict retained across a failed re-check =="
perl -0pi -e "s/        setPayload\(null\);\n        setError\(e instanceof Error/        setError(e instanceof Error/" "$PANEL"
run_case "M14 failed re-check keeps the previous verdict" "$SUITE_UI"

echo "== M15: exact-mode retry never offered (unmatched branch) =="
perl -0pi -e "s/      offerExactMode: !exactModeRequested,/      offerExactMode: false,/" "$LIB"
if cmp -s "$BK/lib" "$LIB"; then echo "  !! M15 DID NOT APPLY (instrument failure)"; fi
run_case "M15 exact-mode retry withheld on unresolved authority" "$SUITE_UI"

echo "== M16: absent upstream truncated flag coerced to false =="
perl -0pi -e "s/    typeof extract.data\?\.truncated === 'boolean' \? extract.data.truncated : null;/    extract.data?.truncated === true;/" "$SVC"
run_case "M16 truncated:null coerced to false" "$SUITE_SVC"

echo "== M17: truncated dropped from the service result =="
# /mg not /m: `truncated: upstreamTruncated,` appears TWICE (logger + return).
# Without /g perl replaced only the logger line, leaving the returned value
# intact — a no-op mutation that read as a survivor on the first run.
perl -0pi -e "s/^    truncated: upstreamTruncated,\$/    truncated: null,/mg" "$SVC"
if cmp -s "$BK/svc" "$SVC"; then echo "  !! M17 DID NOT APPLY (instrument failure)"; fi
run_case "M17 truncated always null (upstream flag discarded)" "$SUITE_SVC"

echo "== M18: PDF byte cap reverted to the stale 20 MB =="
perl -0pi -e "s/export const JRX_ECOSYSTEM_EXTRACT_MAX_PDF_BYTES = 96 \* 1024 \* 1024;/export const JRX_ECOSYSTEM_EXTRACT_MAX_PDF_BYTES = 20 * 1024 * 1024;/" "$SVC"
run_case "M18 cap back to 20 MB" "$SUITE_SVC"

echo "== M19: route truncated computed from maxChars only (upstream flag ignored) =="
perl -0pi -e "s/    truncated: up \|\| local,/    truncated: local,/" "$SVC"
if cmp -s "$BK/svc" "$SVC"; then echo "  !! M19 DID NOT APPLY (instrument failure)"; fi
run_case "M19 upstream budget truncation masked by maxChars-only flag" "$SUITE_SVC"

echo "== M20: one truncation cause masks the other in the reason =="
perl -0pi -e "s/        \? 'upstream-extraction-budget\+maxChars'/        ? 'maxChars'/" "$SVC"
if cmp -s "$BK/svc" "$SVC"; then echo "  !! M20 DID NOT APPLY (instrument failure)"; fi
run_case "M20 combined truncation reason collapsed to maxChars" "$SUITE_SVC"

echo "== M21: unreported upstream flag flattened to false in the merge =="
perl -0pi -e "s/    upstreamTruncated: input.upstreamTruncated,/    upstreamTruncated: input.upstreamTruncated === true,/" "$SVC"
if cmp -s "$BK/svc" "$SVC"; then echo "  !! M21 DID NOT APPLY (instrument failure)"; fi
run_case "M21 upstreamTruncated:null flattened to false" "$SUITE_SVC"

echo "== M22: rail mounts the panel unconditionally (auto-fires on six surfaces) =="
perl -0pi -e "s/      \{goodLawCitation \? \(/      {true ? (/" "$RAIL"
if cmp -s "$BK/rail" "$RAIL"; then echo "  !! M22 DID NOT APPLY (instrument failure)"; fi
run_case "M22 rail renders GoodLawPanel with no authority" "$SUITE_UI"

echo
echo "killed=$PASS survived=$SURVIVED"
[ "$SURVIVED" -eq 0 ] || echo "!! survivors above are untested guards — report them"
