#!/usr/bin/env bash
# =============================================================================
# deploy-aws-ssm.sh — Canonical AWS EC2 dev deploy (SSM, no SSH).
#
# WHAT IT DOES (in order, idempotent):
#   1. Tar the working tree (minus .git/node_modules/dist/archive/.local).
#   2. aws s3 cp the tarball to s3://${NYV_DEPLOY_BUCKET}/deploys/<id>.tgz.
#   3. aws ssm send-command with a base64-encoded shell that:
#        a. downloads the tarball on EC2,
#        b. extracts to /opt/nyayavigya/repo/<id>/,
#        c. runs `docker compose build --pull gateway`,
#        d. `docker compose up -d --force-recreate gateway`,
#        e. polls /health until 200 (90s window),
#        f. updates CURRENT_DEPLOY + LAST_GOOD_DEPLOY,
#        g. appends a row to /opt/nyayavigya/deploys.log.
#   4. Stream the SSM command output back to Cursor and exit non-zero on any
#      step failure.
#
# USAGE
#   bash scripts/deploy-aws-ssm.sh                          # full deploy
#   bash scripts/deploy-aws-ssm.sh --dry-run                # tarball + S3 only
#   bash scripts/deploy-aws-ssm.sh --note "what changed"    # appended to deploys.log
#
# REQUIRED ENV (set in the deployment environment / env.production):
#   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY  — IAM user with ssm:SendCommand
#                                                + s3:PutObject on the bucket
#   NYV_EC2_INSTANCE_ID                       — e.g. i-0df71e5ea1df8f588
#   NYV_AWS_REGION                            — e.g. ap-south-1
#   NYV_DEPLOY_BUCKET                         — e.g. nyayavigya-sdk-devapp
#
# AUDIT TRAIL
#   Every successful run appends ONE line to /opt/nyayavigya/deploys.log on
#   EC2 and ONE entry to .local/deploys.log on the local workstation so we can
#   always answer "what shipped, when, from which git commit".
# =============================================================================
set -euo pipefail

nv_b64_encode() {
  if printf '' | base64 -w0 >/dev/null 2>&1; then
    printf '%s' "$1" | base64 -w0
  else
    printf '%s' "$1" | base64 | tr -d '\n'
  fi
}

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DRY_RUN=0
NOTE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --note)    NOTE="${2:-}"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

: "${AWS_ACCESS_KEY_ID:?missing AWS_ACCESS_KEY_ID in env.production}"
: "${AWS_SECRET_ACCESS_KEY:?missing AWS_SECRET_ACCESS_KEY in env.production}"
: "${NYV_EC2_INSTANCE_ID:?missing NYV_EC2_INSTANCE_ID (set in env.production — e.g. i-0df71e5ea1df8f588)}"
: "${NYV_AWS_REGION:=ap-south-1}"
: "${NYV_DEPLOY_BUCKET:=nyayavigya-sdk-devapp}"

command -v aws >/dev/null 2>&1 || { echo "aws cli not installed" >&2; exit 1; }

DEPLOY_ID="$(date -u +%Y-%m-%dT%H%MZ)-aws-ssm"
SHA="$(git --no-optional-locks rev-parse --short=8 HEAD 2>/dev/null || echo nogit)"
TARBALL="/tmp/nyv-${DEPLOY_ID}-${SHA}.tgz"

echo "==> [1/4] Building tarball ${TARBALL}"
# IMPORTANT: never ship the local-dev .env — it is the local-dev template
# (33 keys: feature flags only). The EC2-side production .env (350+ keys with
# DATABASE_URL=...rds.amazonaws.com, REDIS_URL=...elasticache, NV_PII_ENCRYPTION_KEY,
# 100+ provider API keys, etc.) lives canonically at /opt/Nyayavigya/secrets/.env.production
# and is overlaid onto the deploy dir's .env after extract (see EC2-side step
# below). Shipping the local .env would clobber DB/Redis/secrets and crash the
# gateway with NyvMissingDependencyError [NYV-NS-005] (proven 2026-05-02T0946Z).
tar --exclude='.git' --exclude='node_modules' --exclude='dist' \
    --exclude='archive' --exclude='.local' --exclude='graphify-out' \
    --exclude='nohup.out' --exclude='*.log' \
    --exclude='.env' --exclude='.env.local' \
    --exclude='examples' --exclude='dumps' --exclude='audit' \
    --exclude='client/dist' --exclude='coverage' --exclude='test-results' \
    --exclude='e2e-results' --exclude='*.tmp' --exclude='.v5-staged' \
    --exclude='keys.yaml' --exclude='*.tgz' --exclude='*.bak' \
    --exclude='scripts/_*.cjs' --exclude='scripts/_*.sh' --exclude='scripts/_*.py' \
    -czf "$TARBALL" .
TARBALL_SIZE="$(du -h "$TARBALL" | awk '{print $1}')"
echo "    tarball size: ${TARBALL_SIZE}"

S3_KEY="deploys/${DEPLOY_ID}-${SHA}.tgz"
echo "==> [2/4] Uploading to s3://${NYV_DEPLOY_BUCKET}/${S3_KEY}"
aws s3 cp --region "$NYV_AWS_REGION" "$TARBALL" "s3://${NYV_DEPLOY_BUCKET}/${S3_KEY}" \
  --only-show-errors

if [ "$DRY_RUN" = "1" ]; then
  echo "==> --dry-run: stopping after S3 upload."
  echo "    deploy id : ${DEPLOY_ID}"
  echo "    sha       : ${SHA}"
  echo "    s3 object : s3://${NYV_DEPLOY_BUCKET}/${S3_KEY}"
  exit 0
fi

# Build the EC2-side script — kept inline so this file is self-contained.
# Critical post-extract steps (proven by T013 RECOVERY 2026-05-02T1011Z):
#   1. Overlay /opt/Nyayavigya/secrets/.env.production over the tarball's .env
#      (local .env is the local-dev template — only 33 keys; production has
#      350+ keys including DATABASE_URL=...rds, REDIS_URL=...elasticache,
#      NV_PII_ENCRYPTION_KEY, 100+ provider API keys). Without this overlay
#      the gateway crashes with NyvMissingDependencyError [NYV-NS-005].
#      The tarball no longer ships .env (excluded above) but we still verify.
#   2. After force-recreating the gateway, restart the console so its nginx
#      worker re-resolves the gateway's new docker network IP (otherwise
#      :80/api/jrx/* returns 502 even though gateway :5000 is healthy).
#   3. Health-check :5000 directly (gateway truth) BEFORE :80 (console proxy)
#      so we can distinguish gateway crashes from proxy/DNS issues in logs.
# NOTE is base64-encoded here and decoded on the EC2 side. This is mandatory:
# raw NOTE values containing `"`, `$(...)`, backticks, or newlines could escape
# the heredoc and execute arbitrary commands on the EC2 host. Base64 round-trip
# eliminates the entire class.
NOTE_B64="$(nv_b64_encode "$NOTE")"

EC2_SCRIPT=$(cat <<EOF
set -euo pipefail
DEPLOY_ID="${DEPLOY_ID}"
SHA="${SHA}"
S3_URI="s3://${NYV_DEPLOY_BUCKET}/${S3_KEY}"
NOTE="\$(echo '${NOTE_B64}' | base64 -d)"
CANON_ENV="/opt/Nyayavigya/secrets/.env.production"
# Required keys for gateway boot — file-exists is not enough; we have seen
# stale env files cause [NYV-NS-005] crashes. Validate before compose up.
REQUIRED_ENV_KEYS="DATABASE_URL REDIS_URL NV_PII_ENCRYPTION_KEY JWT_SECRET"
DEST="/opt/Nyayavigya/repo/\${DEPLOY_ID}-\${SHA}"
mkdir -p "\$DEST"
echo "[ec2] downloading \$S3_URI"
aws s3 cp "\$S3_URI" "\$DEST/release.tgz" --only-show-errors
echo "[ec2] extracting"
tar -xzf "\$DEST/release.tgz" -C "\$DEST"
rm "\$DEST/release.tgz"
LIVE_DIR="\$(find "\$DEST" -maxdepth 2 -type d -name 'nyayavigya-platform-312' | head -1)"
if [ -z "\$LIVE_DIR" ]; then
  # NYV-NS-028 fix (2026-05-05): the local-side tar packs from INSIDE
  # nyayavigya-platform-312 (\`tar -czf "\$TARBALL" .\`), so the tarball
  # contents land directly under \$DEST with no wrapper subdir. Fall back
  # to \$DEST when it looks like a valid project root.
  if [ -f "\$DEST/package.json" ] && [ -d "\$DEST/src" ] && [ -d "\$DEST/scripts" ]; then
    LIVE_DIR="\$DEST"
    echo "[ec2] no wrapper subdir; using \$DEST as project root (package.json + src/ + scripts/ present)"
  fi
fi
[ -n "\$LIVE_DIR" ] || { echo "[ec2] FATAL: no project root (no nyayavigya-platform-312 dir AND no package.json+src/+scripts/ at root)"; exit 1; }
cd "\$LIVE_DIR"

echo "[ec2] overlaying canonical .env.production (tarball ships none)"
if [ ! -f "\$CANON_ENV" ]; then
  echo "[ec2] FATAL: \$CANON_ENV missing — cannot deploy without production env"
  echo "[ec2] (recover via: sudo cp <known-good>/.env \$CANON_ENV && sudo chmod 600 \$CANON_ENV)"
  exit 1
fi
cp "\$CANON_ENV" "\$LIVE_DIR/.env"
ENV_KEY_COUNT="\$(grep -cE '^[A-Z_]+=' \$LIVE_DIR/.env || true)"
echo "[ec2]   .env overlay complete (\$ENV_KEY_COUNT keys)"
# Validate that REQUIRED_ENV_KEYS are present and non-empty in the overlaid .env
MISSING_KEYS=""
for k in \$REQUIRED_ENV_KEYS; do
  if ! grep -qE "^\${k}=.+" "\$LIVE_DIR/.env"; then
    MISSING_KEYS="\$MISSING_KEYS \$k"
  fi
done
if [ -n "\$MISSING_KEYS" ]; then
  echo "[ec2] FATAL: canonical .env.production is missing required key(s):\$MISSING_KEYS"
  echo "[ec2]   refusing to deploy — fix \$CANON_ENV first"
  exit 1
fi
echo "[ec2]   required keys present:\$(printf ' %s' \$REQUIRED_ENV_KEYS)"

# NV-DEPLOY-NET-PROJECT-001: stable compose project so console nginx upstream
# "gateway" resolves on nyayavigya-platform-312_nyv-net (not per-deploy dir name).
export COMPOSE_PROJECT_NAME=nyayavigya-platform-312

echo "[ec2] docker compose build --pull gateway"
docker compose -f docker-compose.aws-dev.yml build --pull gateway

# NV-DEPLOY-COMPOSE-RECREATE-001 (2026-05-14, hard guardrail):
# docker compose up -d --force-recreate periodically aborts with
# "Container nyv-gateway is already in use" because compose tries to create the
# new container BEFORE removing the old one (project-name change between
# deploys puts them in different "scopes" so compose loses track). Hit by
# task #365 BCD5 and again by task #390. Always stop+rm explicitly, then
# up -d without --force-recreate.
# NOTE: no backticks in this heredoc body — unquoted EOF expands command substitutions locally.
echo "[ec2] NV-DEPLOY-DRAIN-001: graceful stop of the OLD gateway before recreate"
# The previous sequence was \`docker stop && docker rm && up -d\`, which destroys the only
# container that can serve traffic BEFORE the replacement exists, and only polls /health
# afterwards. NSP's durable task 387 was created 124ms after the new container started and
# 61s before health went green; a refused connection surfaces to the partner as a 502.
#
# We cannot run blue/green on a fixed container name without a proxy change, so we do the
# two things that are safe here and cost nothing:
#   1. \`docker stop\` with an explicit timeout so the app's SIGTERM drain (NV-DEPLOY-DRAIN-001
#      in src/index.ts) can finish in-flight requests instead of being killed mid-response.
#   2. Record the outage window in the deploy log, so a partner failure inside it can be
#      attributed in seconds rather than by cross-referencing timestamps for an hour.
DRAIN_TIMEOUT=\${NYV_DEPLOY_STOP_TIMEOUT:-25}
# NV-DEPLOY-DRAIN-001 (coherence guard added 2026-08-19). Three timeouts must nest:
#
#   app drain   NYV_SHUTDOWN_DRAIN_MS   default 15000 ms  (src/index.ts, clamp 0..60000)
#     <  deploy stop   NYV_DEPLOY_STOP_TIMEOUT  default 25 s   (docker stop -t, below)
#       <  docker grace  stop_grace_period      30 s          (docker-compose.aws-dev.yml)
#
# Before this guard stop_grace_period was unset, so a bare "docker stop nyv-gateway"
# used docker's 10 s default and SIGKILLed the process 5 s INTO a 15 s drain — the
# graceful shutdown could never complete and in-flight partner requests were
# truncated. Read the app's actual drain value from the overlaid .env (not the
# hard-coded default) so the two cannot silently diverge again, and raise the stop
# timeout if someone lengthens the drain without touching this script.
# NV-DEPLOY-GREP-PIPEFAIL-001 (2026-08-20): this grep MUST tolerate a missing key.
# The EC2 script runs under \`set -euo pipefail\`, and NYV_SHUTDOWN_DRAIN_MS is absent
# from the canonical .env.production (272 keys, 0 matches — measured). grep then exits
# 1, pipefail propagates it through \`| head | sed\`, the assignment inherits it and
# set -e killed the deploy at this line — after the image was built but BEFORE the
# gateway was drained. That is why the 2026-08-20T0205Z run exited 1 having touched
# nothing. The \`|| true\` makes the absent-key path fall through to the default on
# the next line, which is what it was always meant to do.
APP_DRAIN_MS="\$( { grep -E '^NYV_SHUTDOWN_DRAIN_MS=' "\$LIVE_DIR/.env" || true; } | head -1 | sed -E 's/^NYV_SHUTDOWN_DRAIN_MS=//; s/[^0-9]//g')"
[ -n "\$APP_DRAIN_MS" ] || APP_DRAIN_MS=15000
APP_DRAIN_S=\$(( (APP_DRAIN_MS + 999) / 1000 ))
MIN_STOP_TIMEOUT=\$(( APP_DRAIN_S + 5 ))
if [ "\$DRAIN_TIMEOUT" -lt "\$MIN_STOP_TIMEOUT" ]; then
  echo "[ec2] NV-DEPLOY-DRAIN-001: raising docker stop -t \$DRAIN_TIMEOUT -> \$MIN_STOP_TIMEOUT (app drain \${APP_DRAIN_MS}ms needs headroom)"
  DRAIN_TIMEOUT=\$MIN_STOP_TIMEOUT
fi
# stop_grace_period in compose is the outermost backstop; if the stop timeout has
# grown past it, docker (not us) becomes the killer again. Warn loudly, do not fail:
# a truncated drain is a degradation, not a reason to block a deploy.
COMPOSE_GRACE_S="\$( { grep -E '^[[:space:]]*stop_grace_period:' "\$LIVE_DIR/docker-compose.aws-dev.yml" || true; } | head -1 | sed -E 's/.*: *//; s/s\$//')"
if [ -n "\$COMPOSE_GRACE_S" ] && [ "\$DRAIN_TIMEOUT" -gt "\$COMPOSE_GRACE_S" ]; then
  echo "[ec2] WARN NV-DEPLOY-DRAIN-001: docker stop -t \$DRAIN_TIMEOUT exceeds compose stop_grace_period \${COMPOSE_GRACE_S}s — raise stop_grace_period in docker-compose.aws-dev.yml"
fi
echo "[ec2] drain budget: app=\${APP_DRAIN_MS}ms < docker stop -t=\${DRAIN_TIMEOUT}s <= stop_grace_period=\${COMPOSE_GRACE_S:-unset}s"
if docker ps --format '{{.Names}}' | grep -qx nyv-gateway; then
  echo "[ec2] stopping nyv-gateway with -t \$DRAIN_TIMEOUT (SIGTERM drain, then SIGKILL)"
  OUTAGE_START=\$(date -u +%s)
  docker stop -t "\$DRAIN_TIMEOUT" nyv-gateway 2>/dev/null || true
  echo "[ec2] drained in \$((\$(date -u +%s) - OUTAGE_START))s"
else
  echo "[ec2] no running nyv-gateway to drain"
  OUTAGE_START=\$(date -u +%s)
fi
docker rm   nyv-gateway 2>/dev/null || true
echo "[ec2] docker compose up -d --no-deps gateway"
docker compose -f docker-compose.aws-dev.yml up -d --no-deps gateway

echo "[ec2] polling :5000/api/jrx/health (gateway direct, 120s window)"
HEALTH_OK=0
for i in \$(seq 1 24); do
  code=\$(curl -fsS -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:5000/api/jrx/health || echo 000)
  if [ "\$code" = "200" ]; then
    echo "[ec2] gateway healthy after \$((i*5))s on :5000 (HTTP \$code)"; HEALTH_OK=1; break
  fi
  sleep 5
done
# NV-DEPLOY-DRAIN-001 — state the outage window explicitly. If a partner reports a 5xx,
# this single line answers "was it inside our deploy window?" without correlating logs.
if [ -n "\${OUTAGE_START:-}" ]; then
  echo "[ec2] OUTAGE WINDOW: \$((\$(date -u +%s) - OUTAGE_START))s total (drain + boot + health)"
  echo "[ec2] partner 5xx inside this window is a deploy artefact, not an orchestrate defect"
fi
if [ "\$HEALTH_OK" != "1" ]; then
  echo "[ec2] FATAL: gateway :5000/api/jrx/health not 200 within 120s"
  echo "[ec2] container state:"
  docker ps -a --filter name=nyv-gateway --format '    {{.Names}} {{.Status}} {{.Image}}'
  echo "[ec2] last 60 lines of nyv-gateway logs:"
  docker logs --tail 60 nyv-gateway 2>&1 | sed 's/^/    /'
  exit 1
fi

# NV-DEPLOY-NET-BRIDGE-001: gateway may land on a deploy-scoped network; connect
# the stable alias "gateway" on the legacy console network before nginx starts.
LEGACY_NET="nyayavigya-platform-312_nyv-net"
if docker network inspect "\$LEGACY_NET" >/dev/null 2>&1; then
  if ! docker inspect nyv-gateway --format '{{json .NetworkSettings.Networks}}' 2>/dev/null | grep -q "\"\${LEGACY_NET}\""; then
    docker network connect --alias gateway "\$LEGACY_NET" nyv-gateway 2>/dev/null || true
    echo "[ec2] bridged nyv-gateway -> \${LEGACY_NET} (NV-DEPLOY-NET-BRIDGE-001)"
  fi
fi

echo "[ec2] running idempotent post-deploy migrations (task-245: openbot org_id backfill)"
# task-245 wiring (2026-05-12): the openbot org-id backfill copies legacy
# JSON-blob \`orgId\` values into the dedicated \`org_id\` column on the three
# nv_openbot_* tables so DB-side WHERE filters return correct results on a
# freshly-restarted pod (before in-memory hydrate runs). The script is
# idempotent (every UPDATE is gated on \`org_id IS NULL\`) so re-running every
# deploy is safe and becomes a no-op once backfill has succeeded. We pull
# DATABASE_URL from the canonical .env (already overlaid + validated above)
# and execute via the postgres:16-alpine image (same one used by the
# nyv-postgres sidecar, so already on disk — no extra pull). Failure is
# WARN-only: gateway hydrate path keeps the system functional, and we don't
# want a backfill regression to gate LAST_GOOD_DEPLOY advancement.
MIGRATION_FILE="\$LIVE_DIR/scripts/migrations/2026-05-12-openbot-org-id-backfill.sql"
if [ -f "\$MIGRATION_FILE" ]; then
  # Parse DATABASE_URL from .env, stripping any surrounding single/double quotes.
  # Use sed (not bash parameter expansion) because escaping a literal single
  # quote inside an unquoted heredoc is treacherous.
  DB_URL="\$(grep -E '^DATABASE_URL=' "\$LIVE_DIR/.env" | head -1 | sed -E 's/^DATABASE_URL=//; s/^"(.*)"\$/\\1/; s/^'\\''(.*)'\\''\$/\\1/')"
  if [ -n "\$DB_URL" ]; then
    BACKFILL_LOG="/tmp/openbot-org-id-backfill-\${DEPLOY_ID}.log"
    set +e
    docker run --rm -i --network host -e PGURL="\$DB_URL" postgres:16-alpine \\
      sh -c 'psql "\$PGURL" -v ON_ERROR_STOP=1' < "\$MIGRATION_FILE" \\
      > "\$BACKFILL_LOG" 2>&1
    BF_RC=\$?
    set -e
    if [ "\$BF_RC" = "0" ]; then
      echo "[ec2]   openbot org_id backfill OK (verifier output, last 8 lines):"
      tail -8 "\$BACKFILL_LOG" | sed 's/^/[ec2]     /'
      BACKFILL_LABEL="OK"
    else
      echo "[ec2]   WARN: openbot org_id backfill exit=\$BF_RC (gateway hydrate path still works; LAST_GOOD_DEPLOY not gated on this)"
      tail -20 "\$BACKFILL_LOG" | sed 's/^/[ec2]     /'
      BACKFILL_LABEL="WARN(rc=\$BF_RC)"
    fi
  else
    echo "[ec2]   WARN: DATABASE_URL not parseable from .env; skipping openbot org_id backfill"
    BACKFILL_LABEL="SKIP(no-db-url)"
  fi
else
  echo "[ec2]   skipping openbot org_id backfill: \$MIGRATION_FILE absent (older codebase)"
  BACKFILL_LABEL="SKIP(absent)"
fi

echo "[ec2] running idempotent post-deploy migrations (NV-SCHEMA-DRIFT-B-001: telemetry tables)"
DRIFT_FILE="\$LIVE_DIR/migrations/2026-07-05-nv-drift-b-telemetry.sql"
DRIFT_DB_URL="\$(grep -E '^DATABASE_URL=' "\$LIVE_DIR/.env" | head -1 | sed -E 's/^DATABASE_URL=//; s/^\"(.*)\"\$/\\1/; s/^'\\''(.*)'\\''\$/\\1/')"
if [ -f "\$DRIFT_FILE" ] && [ -n "\$DRIFT_DB_URL" ]; then
  DRIFT_LOG="/tmp/jrx-drift-b-telemetry-\${DEPLOY_ID}.log"
  set +e
  docker run --rm -i --network host -e PGURL="\$DRIFT_DB_URL" postgres:16-alpine \\
    sh -c 'psql "\$PGURL" -v ON_ERROR_STOP=1' < "\$DRIFT_FILE" > "\$DRIFT_LOG" 2>&1
  DRIFT_RC=\$?
  set -e
  if [ "\$DRIFT_RC" = "0" ]; then
    echo "[ec2]   drift-b telemetry migration OK"
    DRIFT_LABEL="OK"
  else
    echo "[ec2]   WARN: drift-b telemetry migration exit=\$DRIFT_RC"
    tail -10 "\$DRIFT_LOG" | sed 's/^/[ec2]     /'
    DRIFT_LABEL="WARN(rc=\$DRIFT_RC)"
  fi
else
  DRIFT_LABEL="SKIP"
fi

echo "[ec2] rebuilding + recreating console so nginx re-resolves gateway IP"
# NV-DEPLOY-INGRESS-VERIFY-001 (2026-08-19): these three commands used to swallow
# every error into /dev/null and end with "|| true", so a console that failed to
# build or bind :80 produced a bare "proxy WARN" with zero diagnosis. Keep them
# non-fatal (a stale-but-running console still serves traffic) but SAY SO.
if ! docker compose -f docker-compose.aws-dev.yml build console 2>&1 | tail -3 | sed 's/^/[ec2]   /'; then
  echo "[ec2]   WARN: console image build failed — recreating from the existing image"
fi
if docker compose -f docker-compose.aws-dev.yml up -d --no-deps console 2>&1 | tail -5 | sed 's/^/[ec2]   /'; then
  echo "[ec2]   console up -d issued"
else
  echo "[ec2]   WARN: console up -d failed; falling back to restart"
  docker compose -f docker-compose.aws-dev.yml restart console 2>&1 | tail -3 | sed 's/^/[ec2]   /' || \
    echo "[ec2]   WARN: console restart also failed"
fi
sleep 6

# ---------------------------------------------------------------------------
# NV-DEPLOY-INGRESS-VERIFY-001 — assert THROUGH the ingress, not past it.
#
# The 2026-08-19 outage (15:55:18Z-16:46:46Z, 511 nginx 502s) survived 51 minutes
# because the operator's health probe was http://localhost:5000/api/jrx/health.
# That returned 200 the whole time. It bypasses nginx — the only hop that was
# broken. Verification that skips the ingress path cannot detect an ingress
# failure, so the check now lives in scripts/jrx-verify-ingress.sh and asserts:
#   gateway/console share a docker network, 'gateway' resolves inside nyv-console,
#   :80 returns 200, the "gw 200 + ingress 5xx" divergence is a HARD FAIL, and
#   nyv-console's docker healthcheck is not 'unhealthy' (it sat unhealthy with
#   failingStreak=83 for ~50 min during the incident and nothing escalated).
#
# That script carries its own negative control: \`bash scripts/jrx-verify-ingress.sh
# --self-test\` stands up a 200 "gateway" and a 502 "ingress" and requires exit 2.
# ---------------------------------------------------------------------------
echo "[ec2] verifying ingress (nginx :80 + topology + console healthcheck)"
PROXY_OK=0
if [ -f "\$LIVE_DIR/scripts/jrx-verify-ingress.sh" ]; then
  set +e
  NV_INGRESS_ATTEMPTS=18 bash "\$LIVE_DIR/scripts/jrx-verify-ingress.sh" 2>&1 | sed 's/^/[ec2]   /'
  ING_RC=\${PIPESTATUS[0]}
  set -e
  [ "\$ING_RC" = "0" ] && PROXY_OK=1
else
  # Inline fallback so an older release dir still gets an ingress assertion.
  # Same rule: a 200 on :5000 must never excuse a non-200 on :80.
  echo "[ec2]   WARN: scripts/jrx-verify-ingress.sh absent — using inline :80 assertion"
  for i in \$(seq 1 18); do
    code=\$(curl -s -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1/api/jrx/health 2>/dev/null)
    # curl -w '%{http_code}' always emits exactly 3 digits (000 on connect failure),
    # so only an empty capture needs normalising. Deliberately NOT '|| echo 000',
    # which appends a second code and yields the impossible string "000000".
    # No 'case' here on purpose: a case statement inside the \$(cat <<EOF ... EOF)
    # command substitution breaks the OUTER script's parse (caught by bash -n).
    [ -n "\$code" ] || code=000
    if [ "\$code" = "200" ]; then
      echo "[ec2]   ingress :80 -> 200 after \$((i*5))s"; PROXY_OK=1; break
    fi
    sleep 5
  done
  [ "\$PROXY_OK" = "1" ] || echo "[ec2]   ingress :80 -> \$code (gateway :5000 was 200 — this divergence IS the bug)"
fi

# CURRENT_DEPLOY tracks "what is currently running" — always advances after a
# successful gateway recreate. LAST_GOOD_DEPLOY is the rollback target and only
# advances when BOTH gateway (:5000) AND the ingress (:80 through nginx) are
# green; a degraded ingress means user-facing traffic is broken even though the
# gateway is healthy — which is precisely the 2026-08-19 failure.
echo "\$DEPLOY_ID-\$SHA" > /opt/Nyayavigya/CURRENT_DEPLOY
PROXY_LABEL="WARN"
if [ "\$PROXY_OK" = "1" ]; then
  echo "\$DEPLOY_ID-\$SHA" > /opt/Nyayavigya/LAST_GOOD_DEPLOY
  PROXY_LABEL="OK"
else
  echo "[ec2] FAIL: ingress verification did not pass (gateway :5000 IS healthy)"
  echo "[ec2]   CURRENT_DEPLOY advanced; LAST_GOOD_DEPLOY NOT advanced (rollback target unchanged)"
  echo "[ec2]   Most likely cause: nyv-gateway is not on nyayavigya-platform-312_nyv-net."
  echo "[ec2]   Zero-downtime remedy (no restart — reclaims the IP nginx already cached):"
  echo "[ec2]     docker network connect --alias gateway --alias nyv-gateway nyayavigya-platform-312_nyv-net nyv-gateway"
  echo "[ec2]     docker exec nyv-console sh -c 'nginx -t && nginx -s reload'"
  echo "[ec2]   Then re-run: bash \$LIVE_DIR/scripts/jrx-verify-ingress.sh"
fi
echo "\$(date -u +%FT%TZ) | \$DEPLOY_ID | \$SHA | \$LIVE_DIR | gw=:5000-OK ingress=:80-\$PROXY_LABEL backfill=\${BACKFILL_LABEL:-N/A} drift=\${DRIFT_LABEL:-N/A} | \$NOTE" >> /opt/Nyayavigya/deploys.log
echo "[ec2] DONE \$DEPLOY_ID (gateway=OK ingress=\$PROXY_LABEL)"
# Non-zero exit on a degraded ingress so the SSM caller and CI/operator see a
# non-success status. Do NOT relax this to a warning: the 51-minute outage was
# possible only because the failing signal was advisory.
[ "\$PROXY_OK" = "1" ] || exit 2
EOF
)
B64="$(nv_b64_encode "$EC2_SCRIPT")"

echo "==> [3/4] Sending SSM command to ${NYV_EC2_INSTANCE_ID} (region ${NYV_AWS_REGION})"
CMD_ID="$(aws ssm send-command \
  --region "$NYV_AWS_REGION" \
  --instance-ids "$NYV_EC2_INSTANCE_ID" \
  --document-name 'AWS-RunShellScript' \
  --comment "deploy-aws-ssm ${DEPLOY_ID}" \
  --parameters "commands=[\"echo $B64 | base64 -d | bash\"]" \
  --query 'Command.CommandId' --output text)"
echo "    SSM command id: ${CMD_ID}"

echo "==> [4/4] Waiting for SSM completion (max 15min)"
for i in $(seq 1 180); do
  status="$(aws ssm get-command-invocation \
    --region "$NYV_AWS_REGION" \
    --command-id "$CMD_ID" \
    --instance-id "$NYV_EC2_INSTANCE_ID" \
    --query 'Status' --output text 2>/dev/null || echo Pending)"
  case "$status" in
    Success) echo "    SSM Success"; break ;;
    Failed|Cancelled|TimedOut) echo "    SSM ${status}"; break ;;
    *) sleep 5 ;;
  esac
done

echo "==> Stdout:"
aws ssm get-command-invocation \
  --region "$NYV_AWS_REGION" \
  --command-id "$CMD_ID" \
  --instance-id "$NYV_EC2_INSTANCE_ID" \
  --query 'StandardOutputContent' --output text || true

if [ "$status" != "Success" ]; then
  echo "==> Stderr:"
  aws ssm get-command-invocation \
    --region "$NYV_AWS_REGION" \
    --command-id "$CMD_ID" \
    --instance-id "$NYV_EC2_INSTANCE_ID" \
    --query 'StandardErrorContent' --output text || true
  exit 1
fi

mkdir -p .local
echo "$(date -u +%FT%TZ) | ${DEPLOY_ID} | ${SHA} | ${NOTE}" >> .local/deploys.log
echo
echo "==> SUCCESS"
echo "    deploy id : ${DEPLOY_ID}"
echo "    sha       : ${SHA}"
echo "    s3 object : s3://${NYV_DEPLOY_BUCKET}/${S3_KEY}"
echo "    SSM cmd   : ${CMD_ID}"
