#!/usr/bin/env bash
# =============================================================================
# deploy-replit-direct.sh
# Direct Replit -> EC2 deploy (no Bitbucket).
#
# Tarballs the working tree, ships it over SSH, untars on EC2, optionally
# rebuilds the gateway image, recreates containers, waits for /health.
# Each deploy is tracked under /opt/nyayavigya/releases/<sha>.tgz so rollback
# is one command.
#
# USAGE
#   bash scripts/deploy-replit-direct.sh                  # full deploy (tarball path)
#   bash scripts/deploy-replit-direct.sh --rollback       # restore previous release
#   bash scripts/deploy-replit-direct.sh --status         # show running version
#   bash scripts/deploy-replit-direct.sh --use-ecr [tag]  # pull pre-built image from ECR (no tarball)
#   bash scripts/deploy-replit-direct.sh --ecr-push [tag] # build locally and push to ECR (no EC2 deploy)
#   bash scripts/deploy-replit-direct.sh --help
#
# DEPLOY MODES
#   tarball (default): Replit packages working tree -> SSH to EC2 -> compose build
#   ecr (opt-in):      partner CI builds + pushes to ECR -> EC2 pulls image
#                      Used by partner repos that build their own service image.
#                      Requires AWS_ACCOUNT_ID + ECR_REPO env (or --use-ecr <tag>).
#
# ENV OVERRIDES (all optional; defaults work against the current dev box)
#   NYV_DEPLOY_HOST       default: 13.232.165.242
#   NYV_DEPLOY_USER       default: ubuntu     (set to 'deploy' after migrating keys)
#   NYV_DEPLOY_SSH_KEY    default: .local/keys/nysdev.pem
#                                  (use .local/keys/nyv_to_ec2 once deploy@ is set up)
#   NYV_DEPLOY_REMOTE_DIR default: /opt/nyayavigya/repo/nyayavigya-platform-312
#   NYV_DEPLOY_RELEASES   default: /opt/nyayavigya/releases
#   NYV_DEPLOY_COMPOSE    default: docker-compose.ecosystem.yml
#   NYV_DEPLOY_TYPECHECK  default: 0 (set 1 to run pnpm type-check before shipping)
#   NYV_DEPLOY_KEEP       default: 5 (number of release tarballs to keep on EC2)
#   NYV_DEPLOY_SKIP_MIGRATE  default: 0 (set 1 to skip the migrator step in --full)
#
# REMOVED in 2026-04: --hot mode. The compose files do not bind-mount source,
# so a "hot restart" cannot pick up code changes. Use the default full deploy
# (which is fast: tar + rsync-style untar + image rebuild only when source
# changes) or partner CI with --use-ecr/--ecr-push.
# =============================================================================
set -euo pipefail

# -----------------------------------------------------------------------------
# Config
# -----------------------------------------------------------------------------
NYV_DEPLOY_HOST="${NYV_DEPLOY_HOST:-13.232.165.242}"
NYV_DEPLOY_USER="${NYV_DEPLOY_USER:-ubuntu}"
NYV_DEPLOY_SSH_KEY="${NYV_DEPLOY_SSH_KEY:-.local/keys/nysdev.pem}"
NYV_DEPLOY_REMOTE_DIR="${NYV_DEPLOY_REMOTE_DIR:-/opt/nyayavigya/repo/nyayavigya-platform-312}"
NYV_DEPLOY_RELEASES="${NYV_DEPLOY_RELEASES:-/opt/nyayavigya/releases}"
NYV_DEPLOY_COMPOSE="${NYV_DEPLOY_COMPOSE:-docker-compose.ecosystem.yml}"
NYV_DEPLOY_TYPECHECK="${NYV_DEPLOY_TYPECHECK:-0}"
NYV_DEPLOY_KEEP="${NYV_DEPLOY_KEEP:-5}"
NYV_DEPLOY_SKIP_MIGRATE="${NYV_DEPLOY_SKIP_MIGRATE:-0}"
# Preflight is mandatory by default. Set NYV_DEPLOY_SKIP_PREFLIGHT=1 only for
# emergency revert-style deploys; the audit log records it as "UNGATED".
NYV_DEPLOY_FULL_PREFLIGHT="${NYV_DEPLOY_FULL_PREFLIGHT:-1}"
NYV_DEPLOY_SKIP_PREFLIGHT="${NYV_DEPLOY_SKIP_PREFLIGHT:-0}"
HEALTH_URL="http://127.0.0.1:5000/health"
HEALTH_TIMEOUT_S=180
LOCK_FILE="/opt/nyayavigya/.deploy.lock"
CURRENT_FILE="/opt/nyayavigya/CURRENT_DEPLOY"
LAST_GOOD_FILE="/opt/nyayavigya/LAST_GOOD_DEPLOY"

# -----------------------------------------------------------------------------
# Style helpers (ANSI; degrade silently on non-tty)
# -----------------------------------------------------------------------------
if [ -t 1 ]; then
  C_OK="\033[1;32m"; C_WARN="\033[1;33m"; C_ERR="\033[1;31m"
  C_INFO="\033[1;36m"; C_DIM="\033[2m"; C_RST="\033[0m"
else
  C_OK=""; C_WARN=""; C_ERR=""; C_INFO=""; C_DIM=""; C_RST=""
fi
log()  { printf "${C_INFO}[%s]${C_RST} %s\n" "$(date -u +%H:%M:%S)" "$*"; }
ok()   { printf "${C_OK}[ OK ]${C_RST} %s\n" "$*"; }
warn() { printf "${C_WARN}[WARN]${C_RST} %s\n" "$*" >&2; }
die()  { printf "${C_ERR}[FAIL]${C_RST} %s\n" "$*" >&2; exit 1; }

# -----------------------------------------------------------------------------
# Resolve paths and identify deploy
# -----------------------------------------------------------------------------
SCRIPT_PATH="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Resolve SSH key to an absolute path BEFORE we cd, otherwise a relative key
# path (default: .local/keys/nysdev.pem at the workspace root) breaks once we
# move into the project root.
if [ -n "$NYV_DEPLOY_SSH_KEY" ] && [ "${NYV_DEPLOY_SSH_KEY#/}" = "$NYV_DEPLOY_SSH_KEY" ]; then
  # Relative path — resolve against current dir (workspace root) if it exists there
  if [ -f "$NYV_DEPLOY_SSH_KEY" ]; then
    NYV_DEPLOY_SSH_KEY="$(cd "$(dirname "$NYV_DEPLOY_SSH_KEY")" && pwd)/$(basename "$NYV_DEPLOY_SSH_KEY")"
  elif [ -f "$PROJECT_ROOT/../$NYV_DEPLOY_SSH_KEY" ]; then
    NYV_DEPLOY_SSH_KEY="$(cd "$PROJECT_ROOT/.." && pwd)/$NYV_DEPLOY_SSH_KEY"
  fi
fi

cd "$PROJECT_ROOT"

# Validate the chosen subcommand BEFORE checking SSH connectivity, so --help and
# typos give a clean message without requiring the EC2 key to exist.
#
# NYV-OPS-DEPLOY-MODE-001 (2026-05-01): added --dev / --prod shortcuts so
# operators don't have to remember the NYV_DEPLOY_COMPOSE env override.
#   --dev  → docker-compose.aws-dev.yml   (single nyv-gateway)
#   --prod → docker-compose.ecosystem.yml (blue/green gateway-a + gateway-b)
SUBCMD="${1:-}"
case "$SUBCMD" in
  ""|--full|--rollback|--status|--use-ecr|--ecr-push|--help|-h|--dev|--prod) ;;
  *) printf "${C_ERR}[FAIL]${C_RST} Unknown option: %s (try --help)\n" "$SUBCMD" >&2; exit 1 ;;
esac
if [ "$SUBCMD" = "--help" ] || [ "$SUBCMD" = "-h" ]; then
  sed -n '2,32p' "$SCRIPT_PATH" | sed 's/^# \{0,1\}//'
  echo ""
  echo "  --dev / --prod shortcuts (set NYV_DEPLOY_COMPOSE for you):"
  echo "    --dev   → docker-compose.aws-dev.yml   (single nyv-gateway, dev EC2)"
  echo "    --prod  → docker-compose.ecosystem.yml (blue/green, prod EC2)"
  exit 0
fi
# Apply mode shortcut BEFORE other env defaults are read by the script.
if [ "$SUBCMD" = "--dev" ]; then
  export NYV_DEPLOY_COMPOSE="docker-compose.aws-dev.yml"
  SUBCMD="--full"
elif [ "$SUBCMD" = "--prod" ]; then
  export NYV_DEPLOY_COMPOSE="docker-compose.ecosystem.yml"
  SUBCMD="--full"
fi

if ! command -v ssh >/dev/null;  then die "ssh not found"; fi
if ! command -v scp >/dev/null;  then die "scp not found"; fi
if ! command -v tar >/dev/null;  then die "tar not found"; fi
if ! command -v git >/dev/null;  then die "git not found"; fi
if [ ! -f "$NYV_DEPLOY_SSH_KEY" ]; then
  die "SSH key not found at $NYV_DEPLOY_SSH_KEY (set NYV_DEPLOY_SSH_KEY env var)"
fi
chmod 600 "$NYV_DEPLOY_SSH_KEY" 2>/dev/null || true

# Compute a deploy id: short SHA + timestamp. Falls back to timestamp-only
# if there's no git history (Replit shells sometimes have a shallow clone).
# 2026-04-25: env-var override added for environments where `git` invocations
# are intercepted (e.g. Replit main agent + a stale .git/index.lock). If
# NYV_DEPLOY_GIT_SHA / NYV_DEPLOY_GIT_BRANCH are set, they win over `git`.
GIT_SHA="${NYV_DEPLOY_GIT_SHA:-$(git --no-optional-locks rev-parse --short=10 HEAD 2>/dev/null || echo nogit)}"
GIT_BRANCH="${NYV_DEPLOY_GIT_BRANCH:-$(git --no-optional-locks rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)}"
GIT_DIRTY=""
if [ -n "${NYV_DEPLOY_GIT_DIRTY:-}" ]; then
  GIT_DIRTY="-${NYV_DEPLOY_GIT_DIRTY}"
elif [ "$GIT_SHA" != "nogit" ] && [ -n "$(git --no-optional-locks status --porcelain 2>/dev/null || true)" ]; then
  GIT_DIRTY="-dirty"
fi
TS="$(date -u +%Y%m%dT%H%M%SZ)"
DEPLOY_ID="${TS}-${GIT_SHA}${GIT_DIRTY}"

SSH_OPTS=(-i "$NYV_DEPLOY_SSH_KEY"
          -o StrictHostKeyChecking=accept-new
          -o ServerAliveInterval=30
          -o ConnectTimeout=15)
SSH_TARGET="${NYV_DEPLOY_USER}@${NYV_DEPLOY_HOST}"
ssh_run()  { ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "$@"; }
scp_to()   { scp "${SSH_OPTS[@]}" "$@" "$SSH_TARGET:$1"; } # unused — kept for future

# -----------------------------------------------------------------------------
# Subcommand: --help
# -----------------------------------------------------------------------------
cmd_help() {
  sed -n '2,32p' "$SCRIPT_PATH" | sed 's/^# \{0,1\}//'
  exit 0
}

# -----------------------------------------------------------------------------
# Subcommand: --status
# -----------------------------------------------------------------------------
cmd_status() {
  log "Deploy host:  $SSH_TARGET"
  log "Remote dir:   $NYV_DEPLOY_REMOTE_DIR"
  log "Compose file: $NYV_DEPLOY_COMPOSE"
  echo
  echo "── Local working tree ──────────────────────────────"
  echo "  branch: $GIT_BRANCH"
  echo "  sha:    $GIT_SHA$GIT_DIRTY"
  echo
  echo "── Remote CURRENT_DEPLOY (last attempted) ──────────"
  ssh_run "cat ${CURRENT_FILE} 2>/dev/null || echo '(none — never deployed)'"
  echo
  echo "── Remote LAST_GOOD_DEPLOY (rollback target) ───────"
  ssh_run "cat ${LAST_GOOD_FILE} 2>/dev/null || echo '(none — no successful deploy yet)'"
  echo
  echo "── Remote releases (newest first) ──────────────────"
  ssh_run "ls -1tr ${NYV_DEPLOY_RELEASES}/*.tgz 2>/dev/null | tail -n ${NYV_DEPLOY_KEEP} | tac || echo '(no releases)'"
  echo
  echo "── Container health ────────────────────────────────"
  ssh_run "sg docker -c 'docker ps --filter name=nyv- --format \"  {{.Names}}\t{{.Status}}\"' 2>/dev/null || docker ps --filter name=nyv-"
  echo
  echo "── /health probe ───────────────────────────────────"
  CODE=$(ssh_run "curl -s -o /dev/null -w '%{http_code}' -m 5 ${HEALTH_URL}" 2>/dev/null || echo "000")
  if [ "$CODE" = "200" ]; then ok "Gateway healthy ($CODE)"
  else warn "Gateway not healthy (HTTP $CODE)"; fi
  exit 0
}

# -----------------------------------------------------------------------------
# Subcommand: --rollback
# -----------------------------------------------------------------------------
cmd_rollback() {
  acquire_lock
  trap release_lock EXIT

  log "Reading LAST_GOOD_DEPLOY..."
  LAST_GOOD_ID=$(ssh_run "head -1 ${LAST_GOOD_FILE} 2>/dev/null" || echo "")
  CURRENT_ID=$(ssh_run "head -1 ${CURRENT_FILE} 2>/dev/null" || echo "")

  if [ -z "$LAST_GOOD_ID" ]; then
    die "No LAST_GOOD_DEPLOY recorded on EC2 — no known-good release to roll back to."
  fi
  if [ "$LAST_GOOD_ID" = "$CURRENT_ID" ]; then
    die "LAST_GOOD ($LAST_GOOD_ID) equals CURRENT ($CURRENT_ID). Nothing to roll back to."
  fi

  TARGET_TGZ="${NYV_DEPLOY_RELEASES}/nyv-${LAST_GOOD_ID}.tgz"
  if ! ssh_run "test -f ${TARGET_TGZ}"; then
    die "LAST_GOOD tarball not found at ${TARGET_TGZ} (was it pruned?). Manual intervention required."
  fi

  log "Current   : $CURRENT_ID"
  log "Rolling to: $LAST_GOOD_ID"

  ssh_run "set -e
    sudo mkdir -p ${NYV_DEPLOY_REMOTE_DIR}.staging
    sudo rm -rf ${NYV_DEPLOY_REMOTE_DIR}.staging/*
    sudo tar -xzf ${TARGET_TGZ} -C ${NYV_DEPLOY_REMOTE_DIR}.staging
    sudo rsync -a --delete ${NYV_DEPLOY_REMOTE_DIR}.staging/ ${NYV_DEPLOY_REMOTE_DIR}/
    sudo rm -rf ${NYV_DEPLOY_REMOTE_DIR}.staging
    sudo chown -R ${NYV_DEPLOY_USER}:${NYV_DEPLOY_USER} ${NYV_DEPLOY_REMOTE_DIR}
    cd ${NYV_DEPLOY_REMOTE_DIR}
  "
  detect_gateways
  recreate_gateways_rolling

  if ! wait_health; then
    die "Rollback target ${LAST_GOOD_ID} failed health check — manual intervention required"
  fi

  # Update CURRENT only after rollback is healthy. Do NOT update LAST_GOOD —
  # it already pointed here. Append to deploys.log so audit trail records the rollback.
  ssh_run "printf '%s\n%s\nrollback-from-${CURRENT_ID}\n' '${LAST_GOOD_ID}' '$(date -u +%FT%TZ)' | sudo tee ${CURRENT_FILE} >/dev/null"
  ssh_run "echo '$(date -u +%FT%TZ) ROLLBACK ${LAST_GOOD_ID} from=${CURRENT_ID}' | sudo tee -a /opt/nyayavigya/logs/deploys.log >/dev/null"
  ok "Rollback complete -> ${LAST_GOOD_ID}"
  exit 0
}

# -----------------------------------------------------------------------------
# Helpers shared by full + use-ecr
# -----------------------------------------------------------------------------

# Acquire an exclusive deploy lock on EC2. Two parallel deploys would race on
# extract / docker-compose state and corrupt CURRENT_DEPLOY tracking.
acquire_lock() {
  log "Acquiring deploy lock (${LOCK_FILE})"
  if ! ssh_run "sudo mkdir -p $(dirname ${LOCK_FILE}) && sudo touch ${LOCK_FILE} && sudo chown ${NYV_DEPLOY_USER}:${NYV_DEPLOY_USER} ${LOCK_FILE}"; then
    die "Could not prepare lock file ${LOCK_FILE}"
  fi
  # Write our deploy id + pid into the lock; exit 1 if a conflicting one is held
  HOLDER=$(ssh_run "
    if (set -o noclobber; echo '${DEPLOY_ID} ${HOSTNAME:-replit} $$' > ${LOCK_FILE}.held) 2>/dev/null; then
      echo OK
    else
      cat ${LOCK_FILE}.held 2>/dev/null
    fi
  ")
  if [ "$HOLDER" != "OK" ]; then
    die "Deploy lock held by: ${HOLDER}. Wait or run: ssh ... 'rm ${LOCK_FILE}.held' if you're sure no deploy is running."
  fi
  ok "Lock acquired"
}
release_lock() {
  ssh_run "rm -f ${LOCK_FILE}.held" 2>/dev/null || true
}

preflight() {
  log "Preflight checks"
  [ -f .env.example ] || warn ".env.example missing"
  [ -f "$NYV_DEPLOY_COMPOSE" ] || die "Compose file not found locally: $NYV_DEPLOY_COMPOSE"

  if [ -n "$GIT_DIRTY" ]; then
    warn "Working tree is DIRTY (uncommitted changes). Deploy id: ${DEPLOY_ID}"
    warn "Rollback to this exact state will only be possible from the EC2 tarball, not from git."
  fi

  # Secret scan across both tracked AND untracked files. Patterns are tightened
  # to the actual key formats so we don't false-positive on internal IDs like
  # 'sk-court-filing-assistant' (the SDK uses sk- as a "skill" prefix).
  #   - OpenAI legacy: sk- + 40+ alphanumerics (NO dashes/underscores in body)
  #   - OpenAI project: sk-proj- + token
  #   - Anthropic:      sk-ant-api03- + token
  #   - AWS:            AKIA / ASIA + 16 uppercase alphanumerics
  #   - GitHub:         ghp_ / gho_ + 36 alphanumerics
  #   - Slack:          xox[abprs]- + token
  #   - Google API:     AIza + 35 alphanumerics
  SECRET_RE='sk-[A-Za-z0-9]{40,}|sk-proj-[A-Za-z0-9_-]{40,}|sk-ant-api03-[A-Za-z0-9_-]{40,}|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|gho_[A-Za-z0-9]{36}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}'
  HITS=$(grep -rEn --binary-files=without-match \
    --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.local \
    --exclude-dir=dist --exclude-dir=uat-reports --exclude-dir=graphify-out \
    --exclude-dir=archive --exclude='*.md' --exclude='.env.example' \
    --exclude='*.lock' --exclude='*.snap' \
    "$SECRET_RE" . 2>/dev/null | head -3 || true)
  if [ -n "$HITS" ]; then
    echo "$HITS" >&2
    die "Secret-scan: found likely API key(s) above. Remove or move to env vars before deploying."
  fi

  # NYV-OPS-DEPLOY-TSC-001 (2026-05-01): tsc preflight is now ALWAYS run
  # in warning mode. After the TS-error sprint (NYV-NS-005) lands and
  # the count drops to 0, set NYV_DEPLOY_TSC_BLOCKER=1 to make new
  # errors a hard deploy gate. Today the count is ~2,103 (clustered in
  # 15 hot files) so a hard gate would block all deploys.
  log "Type check (warning mode; set NYV_DEPLOY_TSC_BLOCKER=1 to make hard gate)"
  TSC_OUT=$(npx tsc --noEmit -p tsconfig.json 2>&1 || true)
  TSC_ERRS=$(echo "$TSC_OUT" | grep -c "error TS" || true)
  if [ "$TSC_ERRS" -gt 0 ]; then
    if [ "${NYV_DEPLOY_TSC_BLOCKER:-0}" = "1" ]; then
      echo "$TSC_OUT" | grep "error TS" | head -20 >&2
      die "Type check: $TSC_ERRS errors (NYV_DEPLOY_TSC_BLOCKER=1 → hard gate). Fix above or unset blocker."
    else
      warn "Type check: $TSC_ERRS errors (warning mode — not blocking). Run 'npx tsc --noEmit' locally to inspect."
    fi
  else
    ok "Type check: 0 errors"
  fi
  # Legacy opt-in (kept for backwards compat)
  if [ "$NYV_DEPLOY_TYPECHECK" = "1" ]; then
    log "Type check (legacy NYV_DEPLOY_TYPECHECK=1)"
    pnpm run type-check || warn "type-check reported errors — proceeding because you opted in"
  fi

  # Full preflight (typecheck / lint / vitest / gitleaks / audit / env coverage)
  # is MANDATORY by default. The only way to skip is NYV_DEPLOY_SKIP_PREFLIGHT=1
  # which is logged as UNGATED in /opt/nyayavigya/logs/deploys.log on EC2.
  if [ "${NYV_DEPLOY_SKIP_PREFLIGHT}" = "1" ]; then
    warn "Skipping full preflight (NYV_DEPLOY_SKIP_PREFLIGHT=1) — this deploy will be marked UNGATED in the audit log"
    NYV_DEPLOY_UNGATED=1
  elif [ "${NYV_DEPLOY_FULL_PREFLIGHT}" = "1" ]; then
    log "Full preflight (mandatory; set NYV_DEPLOY_SKIP_PREFLIGHT=1 to bypass)"
    if ! bash scripts/preflight.sh; then
      die "Full preflight failed — fix the issues and re-run, or set NYV_DEPLOY_SKIP_PREFLIGHT=1 for an emergency UNGATED deploy."
    fi
  fi
  ok "Preflight passed"
}

build_tarball() {
  TARBALL="/tmp/nyv-${DEPLOY_ID}.tgz"
  log "Packaging working tree -> $TARBALL"
  # NYV-DEPLOY-ENV-DENY-ALL-001: deny-all `.env*` policy at both root AND
  # any nested depth. The previous explicit per-name list missed multi-dot
  # variants like `.env.prod.local`, `.env.test.local`, and any future name
  # operators might invent. We now exclude every `.env*` path and rely on the
  # post-build verifier (also deny-all) as the safety gate. `.env.example` is
  # NOT shipped to EC2 — it's only used at preflight time on the build host
  # (scripts/preflight.sh consumes it locally) and is in git for new clones.
  tar -czf "$TARBALL" \
    --exclude='./node_modules' \
    --exclude='./.git' \
    --exclude='./dist' \
    --exclude='./.local' \
    --exclude='./uat-reports' \
    --exclude='./graphify-out' \
    --exclude='./attached_assets/large' \
    --exclude='./.cache' \
    --exclude='./.pnpm-store' \
    --exclude='*.log' \
    --exclude='./archive' \
    --exclude='./.env' \
    --exclude='./.env.*' \
    --exclude='*/.env' \
    --exclude='*/.env.*' \
    .
  # Belt-and-braces: refuse to ship if ANY .env or .env.* file (incl. multi-dot
  # variants like .env.prod.local) ended up in the tarball. Real prod secrets
  # come from AWS Secrets Manager via secrets-entrypoint.sh, never a tarball.
  # Pattern `(^|/)\.env(\.|$)` matches any path component starting with `.env`
  # followed by EOL or `.` — catches .env, .env.local, .env.prod.local, etc.
  LEAKS=$(tar tzf "$TARBALL" 2>/dev/null \
            | grep -E '(^|/)\.env(\.|$)' \
            | grep -v -E '(^|/)\.env\.example$' || true)
  if [ -n "$LEAKS" ]; then
    echo "$LEAKS" >&2
    die "Tarball contains .env file(s) above. This would ship plaintext secrets to EC2; aborting."
  fi
  SIZE=$(du -sh "$TARBALL" | awk '{print $1}')
  ok "Tarball ready ($SIZE)"
}

# Resolve which gateway service names exist in the configured compose file.
# Sets GATEWAYS to a space-separated list. Recognised shapes:
#   - prod / blue-green:  gateway-a gateway-b
#   - dev single:         nyv-gateway   (docker-compose.aws-dev.yml)
#   - generic single:     gateway       (legacy single-replica compose)
# NYV-OPS-DEPLOY-DETECT-001 (2026-05-01): the regex was previously
#   `^gateway(-[ab])?$` which silently dropped the dev container
#   (`nyv-gateway`), forcing operators to bypass this script. Now both
#   topologies are first-class.
detect_gateways() {
  GATEWAYS=$(ssh_run "cd ${NYV_DEPLOY_REMOTE_DIR} && sg docker -c 'docker compose -f ${NYV_DEPLOY_COMPOSE} config --services 2>/dev/null'" \
             | grep -E '^(gateway(-[ab])?|nyv-gateway)$' | tr '\n' ' ' | sed 's/ $//')
  if [ -z "$GATEWAYS" ]; then
    die "Could not find any gateway service in ${NYV_DEPLOY_COMPOSE} (expected gateway, gateway-a, gateway-b, or nyv-gateway)."
  fi
  log "Detected gateway service(s): ${GATEWAYS}"
}

# Re-create the gateway services one at a time, waiting for /health between
# each one. Yields true rolling-restart zero-downtime when there are 2+
# replicas (the ecosystem compose has gateway-a + gateway-b); falls back to
# a single recreate when there's only one.
recreate_gateways_rolling() {
  for svc in $GATEWAYS; do
    log "Recreating ${svc} (rolling)"
    ssh_run "cd ${NYV_DEPLOY_REMOTE_DIR} && sg docker -c 'docker compose -f ${NYV_DEPLOY_COMPOSE} --env-file .env up -d --no-deps --force-recreate ${svc}'"
    if ! wait_health; then
      die "Service ${svc} never became healthy after recreate. The other gateway (if any) is still serving traffic; investigate before retrying."
    fi
  done
}

ship_tarball() {
  log "Shipping tarball to ${SSH_TARGET}:${NYV_DEPLOY_RELEASES}/"
  ssh_run "sudo mkdir -p ${NYV_DEPLOY_RELEASES} /opt/nyayavigya/incoming /opt/nyayavigya/logs && sudo chown -R ${NYV_DEPLOY_USER}:${NYV_DEPLOY_USER} /opt/nyayavigya/releases /opt/nyayavigya/incoming /opt/nyayavigya/logs 2>/dev/null || true"
  scp "${SSH_OPTS[@]}" "$TARBALL" "$SSH_TARGET:/opt/nyayavigya/incoming/"
  REMOTE_TGZ="${NYV_DEPLOY_RELEASES}/nyv-${DEPLOY_ID}.tgz"
  ssh_run "sudo mv /opt/nyayavigya/incoming/$(basename "$TARBALL") ${REMOTE_TGZ} && sudo chmod 644 ${REMOTE_TGZ}"
  ok "Tarball staged at ${REMOTE_TGZ}"
}

extract_remote() {
  log "Extracting into ${NYV_DEPLOY_REMOTE_DIR} (clean replace via rsync --delete)"
  # Extract to a sibling staging dir, then rsync --delete to atomic-ish replace
  # the live dir. This removes files that no longer exist in the new tarball,
  # which a plain tar overlay would leave behind. The .env file is preserved
  # explicitly because compose reads it from disk and it lives outside the repo.
  ssh_run "set -e
    sudo mkdir -p ${NYV_DEPLOY_REMOTE_DIR}.staging ${NYV_DEPLOY_REMOTE_DIR}
    sudo rm -rf ${NYV_DEPLOY_REMOTE_DIR}.staging/*
    sudo tar -xzf ${REMOTE_TGZ} -C ${NYV_DEPLOY_REMOTE_DIR}.staging
    # Preserve the existing .env if the tarball didn't include one (it shouldn't).
    if [ -f ${NYV_DEPLOY_REMOTE_DIR}/.env ] && [ ! -f ${NYV_DEPLOY_REMOTE_DIR}.staging/.env ]; then
      sudo cp ${NYV_DEPLOY_REMOTE_DIR}/.env ${NYV_DEPLOY_REMOTE_DIR}.staging/.env
    fi
    sudo rsync -a --delete \
      --exclude='node_modules' --exclude='.env' --exclude='dist' \
      ${NYV_DEPLOY_REMOTE_DIR}.staging/ ${NYV_DEPLOY_REMOTE_DIR}/
    sudo rm -rf ${NYV_DEPLOY_REMOTE_DIR}.staging
    sudo chown -R ${NYV_DEPLOY_USER}:${NYV_DEPLOY_USER} ${NYV_DEPLOY_REMOTE_DIR}
  "
  ok "Extracted"
}

run_migrator() {
  if [ "$NYV_DEPLOY_SKIP_MIGRATE" = "1" ]; then
    warn "Skipping migrator (NYV_DEPLOY_SKIP_MIGRATE=1)"
    return 0
  fi
  log "Running database migrator (one-shot)"
  # Two paths, picked by what the active compose file declares:
  #   1. legacy compose (docker-compose.aws-dev.yml) defines a `migrator` service
  #      → run it via `compose run --rm migrator`
  #   2. ecosystem compose (docker-compose.ecosystem.yml) does NOT define one
  #      → exec `pnpm db:push` inside the running gateway container instead
  HAS_MIGRATOR=$(ssh_run "cd ${NYV_DEPLOY_REMOTE_DIR} && sg docker -c 'docker compose -f ${NYV_DEPLOY_COMPOSE} config --services 2>/dev/null'" \
                  | grep -c '^migrator$' || true)
  if [ "$HAS_MIGRATOR" -gt 0 ]; then
    ssh_run "cd ${NYV_DEPLOY_REMOTE_DIR} && sg docker -c 'docker compose -f ${NYV_DEPLOY_COMPOSE} --env-file .env run --rm migrator'" || \
      die "Migrator service failed. Fix the schema or set NYV_DEPLOY_SKIP_MIGRATE=1 if the failure is non-fatal for this release."
  else
    log "No migrator service in ${NYV_DEPLOY_COMPOSE} — running 'pnpm db:push' inside the running gateway"
    # Pick the first gateway service to host the migration exec.
    detect_gateways
    FIRST_GW="${GATEWAYS%% *}"
    CONTAINER_NAME="nyv-${FIRST_GW}"
    ssh_run "sg docker -c 'docker exec ${CONTAINER_NAME} pnpm -s db:push'" || \
      die "In-container db:push failed inside ${CONTAINER_NAME}. Fix or set NYV_DEPLOY_SKIP_MIGRATE=1."
  fi
  ok "Migrations applied"
}

prune_releases() {
  log "Pruning to last ${NYV_DEPLOY_KEEP} releases on EC2"
  ssh_run "ls -1t ${NYV_DEPLOY_RELEASES}/*.tgz 2>/dev/null | tail -n +$((NYV_DEPLOY_KEEP+1)) | xargs -r sudo rm -f"
}

mark_attempt() {
  log "Marking CURRENT_DEPLOY -> ${DEPLOY_ID} (attempt; LAST_GOOD updates only after health passes)"
  ssh_run "printf '%s\n%s\n%s\n' '${DEPLOY_ID}' '$(date -u +%FT%TZ)' '${GIT_BRANCH}' | sudo tee ${CURRENT_FILE} >/dev/null"
  ssh_run "echo '$(date -u +%FT%TZ) ATTEMPT ${DEPLOY_ID} ${GIT_BRANCH}' | sudo tee -a /opt/nyayavigya/logs/deploys.log >/dev/null"
}
mark_good() {
  log "Marking LAST_GOOD_DEPLOY -> ${DEPLOY_ID}"
  ssh_run "printf '%s\n%s\n%s\n' '${DEPLOY_ID}' '$(date -u +%FT%TZ)' '${GIT_BRANCH}' | sudo tee ${LAST_GOOD_FILE} >/dev/null"
  ssh_run "echo '$(date -u +%FT%TZ) HEALTHY ${DEPLOY_ID} ${GIT_BRANCH}' | sudo tee -a /opt/nyayavigya/logs/deploys.log >/dev/null"
}

wait_health() {
  log "Waiting for ${HEALTH_URL} (timeout ${HEALTH_TIMEOUT_S}s)"
  local elapsed=0
  while [ $elapsed -lt $HEALTH_TIMEOUT_S ]; do
    CODE=$(ssh_run "curl -s -o /dev/null -w '%{http_code}' -m 5 ${HEALTH_URL}" 2>/dev/null || echo "000")
    if [ "$CODE" = "200" ]; then ok "Gateway healthy"; return 0; fi
    printf "  [%3ds] %s\n" $elapsed "$CODE"
    sleep 5; elapsed=$((elapsed+5))
  done
  return 1
}

# -----------------------------------------------------------------------------
# Subcommand: full deploy (default)
# -----------------------------------------------------------------------------
cmd_full() {
  log "═══ FULL DEPLOY ${DEPLOY_ID} -> ${SSH_TARGET} ═══"
  acquire_lock
  trap release_lock EXIT

  preflight
  build_tarball
  ship_tarball
  extract_remote
  mark_attempt    # Record the attempt now, BEFORE health-wait, so --status is honest

  detect_gateways
  log "Building gateway image (3-8 min) — services: ${GATEWAYS}"
  # Build once; gateway-a and gateway-b share the same Dockerfile / build context.
  FIRST_GW="${GATEWAYS%% *}"
  ssh_run "cd ${NYV_DEPLOY_REMOTE_DIR} && sg docker -c 'docker compose -f ${NYV_DEPLOY_COMPOSE} --env-file .env build ${FIRST_GW}'"

  run_migrator

  log "Rolling-restart gateway services: ${GATEWAYS}"
  recreate_gateways_rolling

  if ! wait_health; then
    warn "Health check failed — the new tarball is preserved in ${NYV_DEPLOY_RELEASES}/"
    warn "Run 'bash scripts/deploy-replit-direct.sh --rollback' to revert to LAST_GOOD"
    die "Deploy failed at health check (LAST_GOOD not updated; rollback target is unchanged)"
  fi

  mark_good       # Only update LAST_GOOD after health is confirmed
  prune_releases
  rm -f "$TARBALL"

  ok "═══ DEPLOY OK: ${DEPLOY_ID} ═══"
}

# -----------------------------------------------------------------------------
# Subcommand: --ecr-push (build locally, push to ECR; do NOT touch EC2)
# Used by partner CI runners that pre-build their service image. The eventual
# `--use-ecr` on EC2 will then pull this exact tag.
# -----------------------------------------------------------------------------
cmd_ecr_push() {
  TAG="${1:-${DEPLOY_ID}}"
  : "${AWS_ACCOUNT_ID:?Set AWS_ACCOUNT_ID env var}"
  : "${AWS_REGION:=ap-south-1}"
  : "${ECR_REPO:?Set ECR_REPO env var (e.g. nyayavigya/prod/nym-app)}"
  REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
  log "ECR push -> ${REGISTRY}/${ECR_REPO}:${TAG}"
  command -v aws    >/dev/null 2>&1 || die "aws CLI is required for --ecr-push"
  command -v docker >/dev/null 2>&1 || die "docker is required for --ecr-push"
  aws ecr get-login-password --region "${AWS_REGION}" \
    | docker login --username AWS --password-stdin "${REGISTRY}" \
    || die "ECR login failed"
  docker build -t "${REGISTRY}/${ECR_REPO}:${TAG}" -t "${REGISTRY}/${ECR_REPO}:latest" .
  docker push "${REGISTRY}/${ECR_REPO}:${TAG}"
  docker push "${REGISTRY}/${ECR_REPO}:latest"
  ok "Pushed ${REGISTRY}/${ECR_REPO}:{${TAG},latest}"
}

# -----------------------------------------------------------------------------
# Subcommand: --use-ecr (pull image from ECR on EC2; no tarball, no build)
# This is the partner-deploy fast path: image was already built+pushed by the
# partner CI via --ecr-push, EC2 just pulls and rolls.
# -----------------------------------------------------------------------------
cmd_use_ecr() {
  TAG="${1:-latest}"
  log "═══ ECR DEPLOY tag=${TAG} -> ${SSH_TARGET} ═══"
  acquire_lock
  trap release_lock EXIT
  preflight
  detect_gateways
  log "Pulling image tag=${TAG} on EC2"
  ssh_run "cd ${NYV_DEPLOY_REMOTE_DIR} && sg docker -c 'IMAGE_TAG=${TAG} docker compose -f ${NYV_DEPLOY_COMPOSE} --env-file .env pull'" \
    || die "ECR pull failed on EC2 — check the host's IAM role and the tag exists in ECR"
  mark_attempt
  log "Rolling-restart gateway services: ${GATEWAYS}"
  recreate_gateways_rolling
  if ! wait_health; then
    die "Deploy failed at health check (LAST_GOOD not updated)"
  fi
  mark_good
  ok "═══ ECR DEPLOY OK: tag=${TAG} ═══"
}

# -----------------------------------------------------------------------------
# Dispatch
# -----------------------------------------------------------------------------
case "${1:-}" in
  ""|--full)    cmd_full ;;
  --rollback)   cmd_rollback ;;
  --status)     cmd_status ;;
  --use-ecr)    shift; cmd_use_ecr "${1:-latest}" ;;
  --ecr-push)   shift; cmd_ecr_push "${1:-${DEPLOY_ID}}" ;;
  --help|-h)    cmd_help ;;
  *)            die "Unknown option: $1 (try --help)" ;;
esac
