#!/usr/bin/env bash
# Mutation harness for tests/unit/jrx-credit-observe-nearmiss-integration.test.ts
#
# The point of this suite is to catch failures the MOCK-BASED suite cannot: a
# log line whose fields no longer come from the real enforcer, and a marker that
# no longer survives the real logger. So the mutations here are deliberately
# aimed at the *enforcer* and the *logger severity*, not just at the observe
# module — a mutation only proves something if it breaks the hop the suite claims
# to cover.
#
# N1-N4 must go RED in the NEW suite specifically. N5-N8 are the field-provenance
# mutations that the mock-based suite is structurally blind to; each is also run
# against the OLD suite to demonstrate that blindness (a GREEN old suite + RED new
# suite is the justification for this file existing).
#
# Reverted from per-file backups; no git commands (tree is shared with another agent).
set -uo pipefail
cd "$(dirname "$0")/.."

NEW=tests/unit/jrx-credit-observe-nearmiss-integration.test.ts
OLD=tests/unit/jrx-credit-observe-mode.test.ts

OBS=src/middleware/jrx-credit-cap-observe.ts
CAP=src/middleware/jrx-ai-credit-cap-middleware.ts
ENF=src/services/jrx-ai-credit-enforcer.ts

BACKUP_DIR=$(mktemp -d)
trap 'rm -rf "$BACKUP_DIR"' EXIT
backup() { cp "$1" "$BACKUP_DIR/$(echo "$1" | tr / _).bak"; }
restore() { cp "$BACKUP_DIR/$(echo "$1" | tr / _).bak" "$1"; }

echo "=== positive control: NEW suite must be GREEN before any mutation ==="
npx vitest run "$NEW" --reporter=dot >/tmp/jrx-nm-control.log 2>&1
if [ $? -ne 0 ]; then
  echo "CONTROL FAILED — mutations cannot be interpreted. See /tmp/jrx-nm-control.log"
  exit 1
fi
echo "control: PASS"
echo

RED=0
SURVIVORS=()

# run <label> <file> <old||>new> [compare_old_suite]
run() {
  local label="$1" file="$2" expr="$3" compare="${4:-no}"
  backup "$file"
  python3 - "$file" "$expr" <<'PY'
import sys
path, expr = sys.argv[1], sys.argv[2]
src = open(path).read()
old, new = expr.split('||>')
if old not in src:
    print("MUTATION-NOT-APPLIED: pattern absent")
    sys.exit(3)
open(path, 'w').write(src.replace(old, new, 1))
PY
  if [ $? -ne 0 ]; then
    echo "$label: NOT APPLIED (instrument error — pattern absent)"
    restore "$file"; SURVIVORS+=("$label (not applied)"); return
  fi

  npx vitest run "$NEW" --reporter=dot >/tmp/jrx-nm-new.log 2>&1
  local rc_new=$?
  local rc_old="skipped"
  if [ "$compare" = "compare" ]; then
    npx vitest run "$OLD" --reporter=dot >/tmp/jrx-nm-old.log 2>&1
    rc_old=$?
  fi
  restore "$file"

  if [ "$rc_new" -ne 0 ]; then
    RED=$((RED+1))
    if [ "$compare" = "compare" ]; then
      if [ "$rc_old" = "0" ]; then
        echo "$label: NEW=RED  OLD=GREEN  <-- gap the new suite closes"
      else
        echo "$label: NEW=RED  OLD=RED"
      fi
    else
      echo "$label: RED (guard holds)"
    fi
  else
    echo "$label: *** GREEN — GUARD UNPROTECTED ***"
    SURVIVORS+=("$label")
  fi
}

echo "=== mutations ==="

# N1 — the near-miss line is never emitted.
run "N1 marker not logged" "$OBS" \
  "  logger.warn(
    mode === 'enforce'||>  if (false) logger.warn(
    mode === 'enforce'"

# N2 — the line is emitted at debug, so LOG_LEVEL=info silently drops it in prod.
# This is the mute-observer defect: a spy-based test cannot see it.
run "N2 severity downgraded to debug" "$OBS" \
  "  logger.warn(||>  logger.debug(" compare

# N3 — observe mode refuses anyway (admit branch removed).
run "N3 observe refuses anyway" "$CAP" \
  "        if (!mustRefuse) {
          next();
          return;
        }||>        if (false) {
          next();
          return;
        }"

# N4 — overBy is constant, so budgets cannot be tuned from the telemetry.
run "N4 overBy hardcoded to 0" "$OBS" \
  "    overBy: computeOverBy(ev),||>    overBy: 0,"

# ── Field-provenance mutations: the enforcer stops supplying what the line needs.
# The mock-based suite hand-writes DENY_TOKENS and therefore cannot notice.

# N5 — the enforcer stops naming which limit tripped.
run "N5 enforcer drops the limit discriminator" "$ENF" \
  "        limit: 'daily_tokens',
        retryAfterSeconds: Math.ceil||>        retryAfterSeconds: Math.ceil" compare

# N6 — the enforcer ignores the org budget override.
run "N6 enforcer ignores org override" "$ENF" \
  "    const budgetLimit = orgOverride ?? baseBudget;||>    const budgetLimit = baseBudget;" compare

# N7 — the money dimension never refuses, so cost-only surfaces are unmetered.
run "N7 cost budget never checked" "$ENF" \
  "    if (wantsCostDimension && costUsedTodayMicroUsd + estimatedCostMicroUsd > costBudgetMicroUsd) {||>    if (false) {" compare

# N8 — the hourly limit reports token-shaped overage (units confusion).
run "N8 hourly overage in wrong units" "$OBS" \
  "    case 'hourly_requests':
      return Math.max(0, Number(check.hourlyRequests ?? 0) - Number(check.hourlyLimit ?? 0) + 1);||>    case 'hourly_requests':
      return Math.max(0, check.usedToday + ev.estimatedTokens - check.budgetLimit);" compare

# N9 — a cost-metered route also charges the token budget (double counting).
run "N9 cost route double-charges tokens" "$CAP" \
  "      const estimatedTokens = costDriver ? 0 : estimateRequestTokens(req, completionAllowance);||>      const estimatedTokens = estimateRequestTokens(req, completionAllowance);"

# N10 — key/app attribution dropped from the line.
run "N10 apiKeyId dropped" "$OBS" \
  "  if (subject.apiKeyId) rec.apiKeyId = subject.apiKeyId;||>  if (false) rec.apiKeyId = subject.apiKeyId;"

# N11 — the partner bypass stops short-circuiting, so bypassed traffic would
# start producing refusal telemetry (and, in enforce mode, refusals).
run "N11 partner bypass no longer short-circuits" "$ENF" \
  "    if (enforceOff === '0' || enforceOff === 'false' || enforceOff === 'off' || params.bypassCaps) {||>    if (false) {"

# N12 — default flips to enforce.
run "N12 default flips to enforce" "$OBS" \
  "  return 'observe';
}||>  return 'enforce';
}"

echo
echo "=== summary ==="
echo "RED (guard holds): $RED / 12"
if [ "${#SURVIVORS[@]}" -gt 0 ]; then
  echo "GREEN SURVIVORS (${#SURVIVORS[@]}):"
  for s in "${SURVIVORS[@]}"; do echo "  - $s"; done
else
  echo "GREEN SURVIVORS: none"
fi
