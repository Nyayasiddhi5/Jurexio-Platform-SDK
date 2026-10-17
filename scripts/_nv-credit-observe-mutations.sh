#!/usr/bin/env bash
# NV-CREDIT-OBSERVE-001 / NV-CREDIT-COST-DIM-001 mutation harness.
#
# Each mutation breaks exactly ONE guard and the named suites must go RED. A
# mutation that stays GREEN means the guard is unprotected (or the test is
# unfalsifiable) and must be reported, not quietly dropped.
#
# Every mutation is reverted from a per-file backup, so the working tree is
# restored even on failure. No git commands are used — the tree is dirty from
# several concurrent agents.
set -uo pipefail
cd "$(dirname "$0")/.."

SUITES=(
  tests/unit/jrx-credit-observe-mode.test.ts
  tests/unit/jrx-credit-observe-scope.test.ts
  tests/unit/jrx-credit-cost-dimension.test.ts
  tests/unit/jrx-credit-universal-enforcement.test.ts
  tests/unit/jrx-credit-backstop-redundancy.test.ts
)

CAP=src/middleware/jrx-ai-credit-cap-middleware.ts
OBS=src/middleware/jrx-credit-cap-observe.ts
EST=src/middleware/jrx-aux-cost-estimator.ts
REC=src/middleware/jrx-credit-usage-recorder.ts
ENF=src/services/jrx-ai-credit-enforcer.ts
CTX=src/utils/jrx-request-usage-context.ts

BACKUP_DIR=$(mktemp -d)
trap 'for f in "$BACKUP_DIR"/*.bak; do :; done; rm -rf "$BACKUP_DIR"' EXIT

backup() { cp "$1" "$BACKUP_DIR/$(echo "$1" | tr / _).bak"; }
restore() { cp "$BACKUP_DIR/$(echo "$1" | tr / _).bak" "$1"; }

# Positive control: the suites must be GREEN before any mutation. If they are not,
# every RED below is meaningless.
echo "=== positive control (expect PASS) ==="
npx vitest run "${SUITES[@]}" --reporter=dot >/tmp/jrx-mut-control.log 2>&1
CONTROL=$?
if [ "$CONTROL" -ne 0 ]; then
  echo "CONTROL FAILED (exit $CONTROL) — mutations cannot be interpreted. See /tmp/jrx-mut-control.log"
  exit 1
fi
echo "control: PASS"
echo

PASS_COUNT=0
GREEN_SURVIVORS=()

# run_mutation <label> <file> <python-mutation-expression>
run_mutation() {
  local label="$1" file="$2" expr="$3"
  backup "$file"
  python3 - "$file" "$expr" <<'PY'
import sys, re
path, expr = sys.argv[1], sys.argv[2]
src = open(path).read()
old, new = expr.split('||>')
if old not in src:
    print(f"MUTATION-NOT-APPLIED: pattern absent in {path}")
    sys.exit(3)
open(path, 'w').write(src.replace(old, new, 1))
PY
  local applied=$?
  if [ "$applied" -ne 0 ]; then
    echo "$label: MUTATION NOT APPLIED (instrument error — pattern absent)"
    restore "$file"
    GREEN_SURVIVORS+=("$label (not applied)")
    return
  fi
  npx vitest run "${SUITES[@]}" --reporter=dot >"/tmp/jrx-mut-$$.log" 2>&1
  local rc=$?
  restore "$file"
  if [ "$rc" -ne 0 ]; then
    echo "$label: RED (guard holds)"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "$label: *** GREEN — GUARD UNPROTECTED ***"
    GREEN_SURVIVORS+=("$label")
  fi
}

echo "=== mutations ==="

# M1 — observe mode defaults to ENFORCE. A deploy that sets nothing starts refusing.
run_mutation "M1 default flips to enforce" "$OBS" \
  "  return 'observe';
}||>  return 'enforce';
}"

# M2 — observe mode refuses anyway (the admit branch removed).
run_mutation "M2 observe refuses anyway" "$CAP" \
  "        if (!mustRefuse) {
          next();
          return;
        }||>        if (false) {
          next();
          return;
        }"

# M3 — the near-miss line is not logged at all.
run_mutation "M3 near-miss not logged" "$OBS" \
  "  logger.warn(
    mode === 'enforce'||>  if (false) logger.warn(
    mode === 'enforce'"

# M4 — the log line drops the overage, so budgets cannot be tuned from it.
run_mutation "M4 overBy dropped from log" "$OBS" \
  "    overBy: computeOverBy(ev),||>    overBy: 0,"

# M5 — the log line drops the key/app identity, so a runaway key is unattributable.
run_mutation "M5 key identity dropped" "$OBS" \
  "  if (subject.apiKeyId) rec.apiKeyId = subject.apiKeyId;||>  if (false) rec.apiKeyId = subject.apiKeyId;"

# M6 — the global escape no longer wins over the narrower flag.
run_mutation "M6 global escape ignored" "$OBS" \
  "  if (globalOff === '0' || globalOff === 'false' || globalOff === 'off') return 'observe';||>  if (false) return 'observe';"

# M7 — the enforce flag is ignored, so refusals can never be turned on.
run_mutation "M7 enforce flag ignored" "$OBS" \
  "  if (v === 'enforce' || v === '1' || v === 'true' || v === 'on' || v === 'yes') return 'enforce';||>  if (false) return 'enforce';"

# M8 — observe mode also gates the RECORDER. Observing a counter nothing writes.
run_mutation "M8 recorder gated by observe mode" "$REC" \
  "  if (!isJrxFeatureOn('creditRecord')) return 0;||>  if (!isJrxFeatureOn('creditRecord')) return 0;
  if (String(process.env.JRX_CREDIT_CAP_MODE ?? '').trim().toLowerCase() !== 'enforce') return 0;"

# M9 — the recorder drops cost-only spend again (the original defect, in money).
run_mutation "M9 cost-only spend dropped" "$REC" \
  "    if (tokensUsed <= 0 && costUsd <= 0) return 0;||>    if (tokensUsed <= 0) return 0;"

# M10 — the cost dimension is never checked, so the money budget cannot fire.
run_mutation "M10 cost budget never checked" "$ENF" \
  "    if (wantsCostDimension && costUsedTodayMicroUsd + estimatedCostMicroUsd > costBudgetMicroUsd) {||>    if (false) {"

# M11 — the refusal no longer names WHICH limit tripped; overages become unsummable.
run_mutation "M11 limit discriminator dropped" "$ENF" \
  "        limit: 'daily_cost',||>        limit: 'daily_tokens',"

# M12 — OCR fabricates a page count instead of reporting it unmeasurable.
run_mutation "M12 OCR fabricates a page estimate" "$EST" \
  "        unmeasurableReason: 'page count is only known after the document is rendered',||>        unmeasurableReason: undefined, microUsd: AUX_RATES.ocrMicroUsdPerPage * 10,"

# M13 — remote audio is priced as if it were measured.
run_mutation "M13 remote audio priced as measured" "$EST" \
  "        measurable: false,
        quantity: 0,
        unit: 'audio_seconds',||>        measurable: true,
        quantity: 60,
        unit: 'audio_seconds',"

# M14 — embeddings priced per token instead of per 1k (a 1000x over-price).
run_mutation "M14 embeddings priced per token" "$EST" \
  "        microUsd: Math.ceil((tokens / 1000) * AUX_RATES.embeddingMicroUsdPer1kTokens),||>        microUsd: Math.ceil(tokens * AUX_RATES.embeddingMicroUsdPer1kTokens),"

# M15 — a cost-metered route ALSO charges the token budget (double counting).
run_mutation "M15 cost route double-charges tokens" "$CAP" \
  "      const estimatedTokens = costDriver ? 0 : estimateRequestTokens(req, completionAllowance);||>      const estimatedTokens = estimateRequestTokens(req, completionAllowance);"

# M16 — recordAuxSpend invents token counts, corrupting the token budget.
run_mutation "M16 aux spend invents tokens" "$CTX" \
  "  acc.costUsd += costUsd;
  acc.calls += 1;
  acc.auxCostUsd||>  acc.costUsd += costUsd;
  acc.promptTokens += Math.ceil(costUsd * 1000000);
  acc.calls += 1;
  acc.auxCostUsd"

# M17 — recordAuxSpend does not mark the call, so the recorder sees calls === 0.
run_mutation "M17 aux spend not counted as a call" "$CTX" \
  "  acc.costUsd += costUsd;
  acc.calls += 1;||>  acc.costUsd += costUsd;"

# M18 — observe mode is wired into the ENFORCER, silently downgrading the four
# pre-existing enforced surfaces along with the new caps.
run_mutation "M18 observe leaks into the enforcer" "$ENF" \
  "// ── Main Enforcer Class ─||>// jrx-credit-cap-observe leak: JRX_CREDIT_CAP_MODE
// ── Main Enforcer Class ─"

echo
echo "=== summary ==="
echo "RED (guard holds): $PASS_COUNT / 18"
if [ "${#GREEN_SURVIVORS[@]}" -gt 0 ]; then
  echo "GREEN SURVIVORS (${#GREEN_SURVIVORS[@]}):"
  for s in "${GREEN_SURVIVORS[@]}"; do echo "  - $s"; done
else
  echo "GREEN SURVIVORS: none"
fi
