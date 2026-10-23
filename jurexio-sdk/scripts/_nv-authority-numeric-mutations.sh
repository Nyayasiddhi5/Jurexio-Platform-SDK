#!/usr/bin/env bash
# JRX-1/JRX-2 mutation harness. Proves each new guard can actually fail.
#
# Snapshots by `cp` and byte-verifies restoration with `cmp` — never git checkout/stash/reset.
set -uo pipefail
cd "$(dirname "$0")/.."

ID=src/services/jrx-authority-identity.ts
RT=src/routes/jrx-knowledge-plane-routes.ts
SNAP=.local/mutation-snapshots
mkdir -p "$SNAP"
cp "$ID" "$SNAP/identity.ts.orig"
cp "$RT" "$SNAP/route.ts.orig"

T_ID=tests/unit/jrx-authority-identity.test.ts
T_RES=tests/unit/jrx-citator-authority-resolve.test.ts
T_FWD=tests/unit/jrx-caselaw-search-filter-forwarding.test.ts

restore() {
  cp "$SNAP/identity.ts.orig" "$ID"
  cp "$SNAP/route.ts.orig" "$RT"
  cmp -s "$SNAP/identity.ts.orig" "$ID" || { echo "RESTORE FAILED: $ID"; exit 2; }
  cmp -s "$SNAP/route.ts.orig" "$RT" || { echo "RESTORE FAILED: $RT"; exit 2; }
}
trap restore EXIT

# mutate <file> <python-literal-old> <python-literal-new>
mutate() {
  python3 - "$1" "$2" "$3" <<'PY'
import sys
p, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p).read()
if s.count(old) != 1:
    print(f"MUTATION-ANCHOR-ERROR count={s.count(old)}"); sys.exit=3; raise SystemExit(3)
open(p, 'w').write(s.replace(old, new))
PY
}

run() { # run <label> <expect: FAIL|PASS> <test files...>
  local label="$1"; local expect="$2"; shift 2
  local out
  out=$(npx vitest run "$@" --reporter=dot 2>&1)
  local rc=$?
  local failed
  failed=$(printf '%s' "$out" | grep -oE 'Tests +[0-9]+ failed' | grep -oE '[0-9]+' | head -1)
  failed=${failed:-0}
  if [ "$expect" = FAIL ]; then
    if [ "$rc" -ne 0 ] && [ "$failed" -gt 0 ]; then
      echo "  MUTATION KILLED  ($failed test(s) failed)  <- $label"
    else
      echo "  *** SURVIVED ***  (rc=$rc failed=$failed)  <- $label  [UNTESTED GUARD]"
    fi
  else
    if [ "$rc" -eq 0 ]; then echo "  baseline green    <- $label"
    else echo "  *** BASELINE RED *** rc=$rc failed=$failed <- $label"; fi
  fi
}

echo "== BASELINE (no mutation) =="
run "baseline" PASS "$T_ID" "$T_RES" "$T_FWD"

echo
echo "== FIX 1 mutations: src/services/jrx-authority-identity.ts =="

echo "M1 numeric tokens allowed back into significant/distinctive"
mutate "$ID" " && !/^\d+\$/.test(t)" "" && run M1 FAIL "$T_ID" "$T_RES"
restore

echo "M2 CITATION_RE_LOOSE loses the bracketed S.C.R. form"
mutate "$ID" "/(?:[[(]\s*\d{4}\s*[\])]\s*\d+\s*S\.?\s*C\.?\s*R\.?\s*\d+|\(" "/(?:(?!x)x|\(" \
  && run M2 FAIL "$T_RES"
restore

echo "M3 exact-citation compares substrings again instead of token sequences"
mutate "$ID" "containsSequence(citationTokens(r?.citation ?? ''), wanted)" \
  "citationTokens(r?.citation ?? '').join(' ').includes(wanted.join(' '))" \
  && run M3 FAIL "$T_RES"
restore

echo "M4 the year guard is removed"
mutate "$ID" "      wantedYears.length > 0 &&" "      false &&" && run M4 FAIL "$T_RES"
restore

echo "M5 citationTokens stops gluing single-letter runs (S.C.R. != SCR)"
mutate "$ID" "      initials += t;
      continue;" "      out.push(t);
      continue;" && run M5 FAIL "$T_ID" "$T_RES"
restore

echo "M6 citationYears loses its lower bound, so a case number becomes a year"
mutate "$ID" "y >= EARLIEST_PLAUSIBLE_YEAR && " "" && run M6 FAIL "$T_ID"
restore

echo "M7 the year guard rejects candidates that carry NO year (absence read as contradiction)"
mutate "$ID" "      Number.isFinite(candidateYear) &&" "      true &&" && run M7 FAIL "$T_RES"
restore

echo "M8 whole-token title containment reverts to substring (the kesavan collision)"
mutate "$ID" "if (!significant.every((t) => titleTokens.has(t))) continue;" \
  "if (!significant.every((t) => title.includes(t))) continue;" && run M8 FAIL "$T_RES"
restore

echo
echo "== FIX 1 mutations: the retired duplicate must stay retired =="

echo "M9 the route re-declares a private AUTHORITY_STOP"
mutate "$RT" "const router = Router();" \
  "const AUTHORITY_STOP = new Set(['state']);
void AUTHORITY_STOP;
const router = Router();" && run M9 FAIL "$T_ID"
restore

echo "M10 the route's identity lookup drops the raw-citation fallback"
mutate "$RT" "distinctive.length > 0 ? distinctive.join(' ') : citation" \
  "distinctive.join(' ')" && run M10 FAIL "$T_RES"
restore

echo
echo "== FIX 2 mutations: src/routes/jrx-knowledge-plane-routes.ts =="

echo "M11 courtType is dropped again (the reported defect)"
mutate "$RT" "    courtType: req.query.courtType ? String(req.query.courtType) : undefined,
" "" && run M11 FAIL "$T_FWD"
restore

echo "M12 offset is dropped"
mutate "$RT" "    offset: req.query.offset !== undefined ? Number(req.query.offset) : undefined,
" "" && run M12 FAIL "$T_FWD"
restore

echo "M13 offset uses a falsy test, so page one is erased"
mutate "$RT" "offset: req.query.offset !== undefined ? Number(req.query.offset) : undefined" \
  "offset: req.query.offset ? Number(req.query.offset) : undefined" && run M13 FAIL "$T_FWD"
restore

echo "M14 judge/reporter/benchStrength/sort are dropped"
mutate "$RT" "    judge: req.query.judge ? String(req.query.judge) : undefined,
    reporter: req.query.reporter ? String(req.query.reporter) : undefined,
    benchStrength: req.query.benchStrength ? String(req.query.benchStrength) : undefined,
" "" && run M14 FAIL "$T_FWD"
restore

echo "M15 the FTS retry drops the filters"
mutate "$RT" "    query: { ...baseQuery, mode: 'fts' }," \
  "    query: { q, jurisdiction, limit, mode: 'fts' }," && run M15 FAIL "$T_FWD"
restore

echo "M16 the response is reshaped instead of passed through"
mutate "$RT" "  res.status(200).json({
    success: true,
    source: 'nys-knowledge-plane',
    data: payload,
  });" "  res.status(200).json({
    success: true,
    source: 'nys-knowledge-plane',
    data: { total: (payload as any)?.total, results: (payload as any)?.results },
  });" && run M16 FAIL "$T_FWD"
restore

echo "M17 an invented parameter NYS does not accept is forwarded"
mutate "$RT" "    sort: req.query.sort ? String(req.query.sort) : undefined,
  };" "    sort: req.query.sort ? String(req.query.sort) : undefined,
    caseType: req.query.caseType ? String(req.query.caseType) : 'civil',
  };" && run M17 FAIL "$T_FWD"
restore

echo "M18 courtType is silently lower-cased, hiding a partner's mistake"
mutate "$RT" "courtType: req.query.courtType ? String(req.query.courtType) : undefined" \
  "courtType: req.query.courtType ? String(req.query.courtType).toLowerCase() : undefined" \
  && run M18 FAIL "$T_FWD"
restore

echo
echo "== RESTORED — byte-verifying =="
restore
cmp -s "$SNAP/identity.ts.orig" "$ID" && echo "identity.ts byte-identical to snapshot"
cmp -s "$SNAP/route.ts.orig" "$RT" && echo "route.ts byte-identical to snapshot"
run "post-restore baseline" PASS "$T_ID" "$T_RES" "$T_FWD"
