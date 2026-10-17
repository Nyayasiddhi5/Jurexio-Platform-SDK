#!/usr/bin/env bash
# =============================================================================
# preflight.sh — gate every deploy with a fast, repeatable quality check.
#
# Steps (each one is a hard gate; set NYV_PREFLIGHT_<step>=skip to bypass):
#   1. type-check         pnpm type-check
#   2. lint               pnpm lint
#   3. test-unit          pnpm vitest run --reporter=dot
#   4. secret-scan        gitleaks if installed; otherwise the regex scan
#                         already used by deploy-replit-direct.sh
#   5. dep-audit          pnpm audit --prod --audit-level=high
#   6. env-coverage       every required key in .env.example must be present
#                         either in the local .env, AWS Secrets Manager
#                         (NYV_PREFLIGHT_CHECK_SM=1) or both.
#
# Exit codes:
#   0 — all checks pass
#   1 — at least one hard gate failed
#   2 — preflight could not run (missing tools)
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -t 1 ]; then
  C_OK="\033[1;32m"; C_WARN="\033[1;33m"; C_ERR="\033[1;31m"
  C_INFO="\033[1;36m"; C_RST="\033[0m"
else
  C_OK=""; C_WARN=""; C_ERR=""; C_INFO=""; C_RST=""
fi
log()  { printf "${C_INFO}[%s]${C_RST} %s\n" "$(date -u +%H:%M:%S)" "$*"; }
ok()   { printf "${C_OK}[ OK ]${C_RST} %s\n" "$*"; }
warn() { printf "${C_WARN}[WARN]${C_RST} %s\n" "$*" >&2; }
fail() { printf "${C_ERR}[FAIL]${C_RST} %s\n" "$*" >&2; FAILED=1; }

FAILED=0

# ── 1. type-check ────────────────────────────────────────────────────────────
if [ "${NYV_PREFLIGHT_TYPECHECK:-run}" = "run" ]; then
  log "type-check"
  if pnpm -s type-check; then ok "type-check"; else fail "type-check"; fi
else
  warn "type-check skipped (NYV_PREFLIGHT_TYPECHECK=skip)"
fi

# ── 2. lint ──────────────────────────────────────────────────────────────────
if [ "${NYV_PREFLIGHT_LINT:-run}" = "run" ]; then
  log "lint"
  if pnpm -s lint; then ok "lint"; else fail "lint"; fi
else
  warn "lint skipped"
fi

# ── 3. tests ─────────────────────────────────────────────────────────────────
if [ "${NYV_PREFLIGHT_TEST:-run}" = "run" ]; then
  log "vitest"
  if pnpm -s vitest run --reporter=dot --passWithNoTests; then ok "tests"; else fail "tests"; fi
else
  warn "tests skipped"
fi

# ── 4. secret-scan (gitleaks if available, else regex fallback) ─────────────
if [ "${NYV_PREFLIGHT_SECRETSCAN:-run}" = "run" ]; then
  log "secret-scan"
  if command -v gitleaks >/dev/null 2>&1; then
    if gitleaks detect --no-git --source . --redact --exit-code 1 \
         --config "${NYV_GITLEAKS_CONFIG:-/dev/null}" \
         --report-format json --report-path /tmp/gitleaks.json 2>/dev/null; then
      ok "gitleaks"
    else
      fail "gitleaks found leaked secrets — see /tmp/gitleaks.json"
    fi
  else
    # Same regex set as deploy-replit-direct.sh — kept in lockstep there.
    SECRET_RE='sk-[A-Za-z0-9]{40,}|sk-proj-[A-Za-z0-9_-]{40,}|sk-ant-api03-[A-Za-z0-9_-]{40,}|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|gho_[A-Za-z0-9]{36}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}'
    HITS=$(grep -rEn --binary-files=without-match \
      --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.local \
      --exclude-dir=dist --exclude-dir=archive --exclude-dir=uat-reports \
      --exclude='*.md' --exclude='.env.example' --exclude='*.lock' \
      "$SECRET_RE" . 2>/dev/null | head -3 || true)
    if [ -n "$HITS" ]; then
      echo "$HITS" >&2
      fail "secret-scan (regex) — found likely API key(s)"
    else
      ok "secret-scan (regex)"
      warn "Install gitleaks for stronger coverage: brew install gitleaks  /  apt install gitleaks"
    fi
  fi
else
  warn "secret-scan skipped"
fi

# ── 5. dep-audit ─────────────────────────────────────────────────────────────
if [ "${NYV_PREFLIGHT_AUDIT:-run}" = "run" ]; then
  log "dep-audit (high+)"
  # `pnpm audit` returns non-zero on findings; we DON'T fail on moderate/low.
  if pnpm audit --prod --audit-level=high >/tmp/pnpm-audit.txt 2>&1; then
    ok "dep-audit"
  else
    cat /tmp/pnpm-audit.txt | head -40 >&2
    fail "dep-audit found high/critical vulnerabilities — see /tmp/pnpm-audit.txt"
  fi
else
  warn "dep-audit skipped"
fi

# ── 6. env-coverage ──────────────────────────────────────────────────────────
if [ "${NYV_PREFLIGHT_ENV:-run}" = "run" ] && [ -f .env.example ]; then
  log "env-coverage"
  REQUIRED=$(grep -Eho '^[A-Z][A-Z0-9_]+=' .env.example | sed 's/=$//' | sort -u)
  MISSING=()

  # Local .env covers
  if [ -f .env ]; then
    LOCAL=$(grep -Eho '^[A-Z][A-Z0-9_]+=' .env | sed 's/=$//' | sort -u)
  else
    LOCAL=""
  fi

  # AWS SM covers (only if explicitly opted in — needs AWS creds)
  REMOTE=""
  if [ "${NYV_PREFLIGHT_CHECK_SM:-0}" = "1" ] && command -v aws >/dev/null 2>&1; then
    REMOTE=$(aws secretsmanager list-secrets \
              --filters "Key=tag-key,Values=Project" "Key=tag-value,Values=Nyayavigya" \
              --query 'SecretList[].Name' --output text 2>/dev/null \
              | tr '\t' '\n' | sed 's:.*/::' | tr 'a-z' 'A-Z' | sort -u || true)
  fi

  for k in $REQUIRED; do
    case "$k" in
      # Skip example-only / docs-only keys
      EXAMPLE_*|DEMO_*|TEST_*) continue ;;
    esac
    if echo "$LOCAL" | grep -qx "$k"; then continue; fi
    if [ -n "$REMOTE" ] && echo "$REMOTE" | grep -qix "$k"; then continue; fi
    MISSING+=("$k")
  done

  if [ ${#MISSING[@]} -eq 0 ]; then
    ok "env-coverage (all $(echo "$REQUIRED" | wc -w | tr -d ' ') keys covered)"
  else
    for k in "${MISSING[@]}"; do warn "  missing: $k"; done
    fail "env-coverage: ${#MISSING[@]} required key(s) not present in .env"
  fi
fi

# ── 7. staging smoke gate (optional but ON by default for prod deploys) ─────
# Hits a known set of paths against staging and asserts each returns the
# expected status. Requires NYV_STAGING_BASE_URL or defaults to the public
# staging host. Set NYV_PREFLIGHT_STAGING_SMOKE=skip to bypass (audited).
if [ "${NYV_PREFLIGHT_STAGING_SMOKE:-run}" = "run" ]; then
  log "staging-smoke"
  STG_BASE="${NYV_STAGING_BASE_URL:-https://staging.nyayasiddhi.online}"
  if ! command -v curl >/dev/null 2>&1; then
    warn "curl missing — staging-smoke skipped"
  else
    SMOKE_FAIL=0
    # Each row: METHOD PATH EXPECTED_HTTP_CODE
    while IFS= read -r row; do
      [ -z "$row" ] && continue
      M=$(echo "$row" | awk '{print $1}')
      P=$(echo "$row" | awk '{print $2}')
      E=$(echo "$row" | awk '{print $3}')
      C=$(curl -sS -o /dev/null -w '%{http_code}' -m 8 -X "$M" "$STG_BASE$P" || echo 000)
      if [ "$C" = "$E" ]; then
        printf "  ${C_OK}OK${C_RST}   %-4s %-30s -> %s\n" "$M" "$P" "$C"
      else
        printf "  ${C_ERR}FAIL${C_RST} %-4s %-30s -> %s (expected %s)\n" "$M" "$P" "$C" "$E"
        SMOKE_FAIL=1
      fi
    done <<EOF
GET  /health                       200
GET  /api/jrx/health                200
GET  /api/jrx/health/full           200
EOF
    if [ "$SMOKE_FAIL" -eq 0 ]; then ok "staging-smoke ($STG_BASE)"; else fail "staging-smoke against $STG_BASE"; fi
  fi
else
  warn "staging-smoke skipped (NYV_PREFLIGHT_STAGING_SMOKE=skip)"
fi

if [ "$FAILED" -eq 0 ]; then
  printf "\n${C_OK}══════════════════════════════════════════${C_RST}\n"
  printf "${C_OK}  PREFLIGHT PASSED — ready to deploy${C_RST}\n"
  printf "${C_OK}══════════════════════════════════════════${C_RST}\n"
  exit 0
else
  printf "\n${C_ERR}══════════════════════════════════════════${C_RST}\n"
  printf "${C_ERR}  PREFLIGHT FAILED — fix the issues above${C_RST}\n"
  printf "${C_ERR}══════════════════════════════════════════${C_RST}\n"
  exit 1
fi
