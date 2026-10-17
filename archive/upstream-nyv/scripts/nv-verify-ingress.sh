#!/usr/bin/env bash
# =============================================================================
# nv-verify-ingress.sh — NV-DEPLOY-INGRESS-VERIFY-001
#
# WHY THIS EXISTS
#   2026-08-19, 15:55:18Z–16:46:46Z, 511 nginx 502s to a partner (NSP). Root
#   cause was a docker network partition: a manual
#     docker rm -f nyv-gateway
#     docker compose -f docker-compose.aws-dev.yml up -d --no-deps gateway
#   run from a release dir WITHOUT COMPOSE_PROJECT_NAME put nyv-gateway alone on
#   2026-08-19t1146z-aws-ssm-7c5b1ff2_nyv-net (172.21.0.2) while nyv-console (the
#   nginx that fronts every public request) stayed on
#   nyayavigya-platform-312_nyv-net (172.18.0.x). nginx could not resolve its
#   `proxy_pass http://gateway:5000` upstream and every ingress request became
#   "113: Host is unreachable".
#
#   The outage lasted 51 minutes because verification looked at the wrong hop:
#   http://localhost:5000/api/jrx/health returned 200, so the platform was
#   declared fine. Port 5000 bypasses nginx — the exact hop that was broken.
#   Meanwhile nyv-console's own docker healthcheck sat `unhealthy` with
#   failingStreak=83 for ~50 minutes and nothing escalated.
#
#   VERIFICATION THAT SKIPS THE INGRESS PATH CANNOT DETECT AN INGRESS FAILURE.
#   This script is the assertion that would have caught it in seconds.
#
# WHAT IT ASSERTS (in order, cheapest/most-diagnostic first)
#   1. TOPOLOGY  — nyv-gateway and nyv-console share at least one docker network,
#                  and `gateway` resolves from inside nyv-console. This is the
#                  direct assertion for the 2026-08-19 failure mode.
#   2. GATEWAY   — gateway :5000 health (ground truth: is the app up at all).
#   3. INGRESS   — health THROUGH nginx on :80 (what a partner actually hits).
#   4. DIVERGENCE— gateway 200 + ingress 5xx is the signature of this bug and is
#                  a HARD FAIL, never a warning.
#   5. CONSOLE HC— nyv-console's docker healthcheck must not be `unhealthy`.
#   6. PUBLIC    — best-effort HTTPS probe of the public edge (warn-only: DNS,
#                  ACM and the ALB are outside this host's blast radius).
#
# EXIT CODES
#   0  all hard assertions passed (warnings may still have been printed)
#   2  ingress degraded / topology split / console unhealthy — deploy must NOT
#      advance LAST_GOOD_DEPLOY
#
# USAGE
#   bash scripts/jrx-verify-ingress.sh                     # on EC2, defaults
#   NV_INGRESS_URL=http://127.0.0.1/health bash scripts/jrx-verify-ingress.sh
#   NV_SKIP_DOCKER=1 NV_SKIP_PUBLIC=1 \
#     NV_GATEWAY_URL=http://127.0.0.1:5000/api/jrx/health \
#     NV_INGRESS_URL=http://127.0.0.1:8080/api/jrx/health \
#     bash scripts/jrx-verify-ingress.sh                   # local self-test
#
#   NV_SKIP_DOCKER=1 makes this runnable off-host (and is how the negative
#   control below is exercised). It NEVER weakens checks 2-4.
#
# SELF-TEST (proves this check can actually FAIL — see NV-VALIDATE-THE-PROBE-001)
#   bash scripts/jrx-verify-ingress.sh --self-test
#   Spins two throwaway local HTTP listeners (200 on the "gateway" port, 502 on
#   the "ingress" port), asserts exit 2, then flips the ingress to 200 and
#   asserts exit 0. A verification step that cannot fail is what caused this
#   incident; do not delete this.
# =============================================================================
set -uo pipefail

# ---------------------------------------------------------------------------
# --self-test — the negative control. Run this after ANY edit to this file.
# ---------------------------------------------------------------------------
if [ "${1:-}" = "--self-test" ]; then
  command -v python3 >/dev/null 2>&1 || {
    echo "[self-test] python3 unavailable — cannot run the negative control." >&2
    echo "[self-test] Refusing to report success for a test that did not run." >&2
    exit 1
  }
  SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
  SRV="$(mktemp -t nv-ingress-srv-XXXXXX.py)"
  cat > "$SRV" <<'PY'
import sys, http.server
code = int(sys.argv[1]); port = int(sys.argv[2])
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(code); self.send_header('Content-Length', '2'); self.end_headers()
        self.wfile.write(b'{}')
    def log_message(self, *a): pass
http.server.HTTPServer(('127.0.0.1', port), H).serve_forever()
PY
  GW_PORT=15900; ING_PORT=15901
  PIDS=""
  start_srv() { python3 "$SRV" "$1" "$2" >/dev/null 2>&1 & PIDS="$PIDS $!"; }
  kill_srvs() { for p in $PIDS; do kill "$p" 2>/dev/null || true; wait "$p" 2>/dev/null || true; done; PIDS=""; }
  cleanup() { kill_srvs; rm -f "$SRV"; }
  trap cleanup EXIT

  # NV-VALIDATE-THE-PROBE-001: wait for the fixture to actually bind, and assert
  # it returns the code we asked for. Without this the harness once "passed" Case A
  # with gateway=000/ingress=000 — the right exit code for the wrong reason, i.e.
  # a test that proved nothing. Ports must be confirmed free too, or a leftover
  # listener from a prior run silently answers instead of the fixture.
  wait_listen() { # $1=port $2=expected_code
    for _ in $(seq 1 40); do
      got="$(curl -s -o /dev/null -w '%{http_code}' -m 2 "http://127.0.0.1:$1/" 2>/dev/null)"
      [ "$got" = "$2" ] && return 0
      sleep 0.25
    done
    echo "[self-test] FIXTURE ERROR: port $1 never returned $2 (last: ${got:-none})" >&2
    return 1
  }
  wait_free() { # $1=port
    for _ in $(seq 1 40); do
      curl -s -o /dev/null -m 1 "http://127.0.0.1:$1/" 2>/dev/null || return 0
      sleep 0.25
    done
    echo "[self-test] FIXTURE ERROR: port $1 still answering; refusing to run" >&2
    return 1
  }

  run_case() {  # $1=label $2=expected_rc $3=expected "gateway=X ingress=Y" verdict fragment
    out="$(NV_SKIP_DOCKER=1 NV_SKIP_PUBLIC=1 NV_INGRESS_ATTEMPTS=1 \
      NV_GATEWAY_URL="http://127.0.0.1:${GW_PORT}/api/jrx/health" \
      NV_INGRESS_URL="http://127.0.0.1:${ING_PORT}/api/jrx/health" \
      bash "$SELF" 2>&1)"; rc=$?
    verdict="$(echo "$out" | grep 'VERDICT' | head -1)"
    ok=1
    [ "$rc" = "$2" ] || ok=0
    # Assert the OBSERVED codes too. Case A once "passed" with gateway=000
    # ingress=000: correct exit code, zero evidence. Exit code alone is not proof.
    echo "$verdict" | grep -q "$3" || ok=0
    if [ "$ok" = "1" ]; then
      echo "[self-test] PASS  $1 (exit $rc; $3)"
    else
      echo "[self-test] FAIL  $1 (exit $rc, expected $2; expected codes '$3')"
      echo "$out" | sed 's/^/[self-test]   /'
      SELF_FAIL=1
    fi
    echo "$out" | grep -E 'VERDICT|DIVERGENCE' | sed 's/^/[self-test]   /'
  }
  SELF_FAIL=0
  wait_free "$GW_PORT" || exit 1
  wait_free "$ING_PORT" || exit 1

  # Case A — the incident: gateway 200, ingress 502. MUST fail with exit 2.
  start_srv 200 "$GW_PORT"; start_srv 502 "$ING_PORT"
  wait_listen "$GW_PORT" 200 || exit 1
  wait_listen "$ING_PORT" 502 || exit 1
  run_case "gateway=200 ingress=502 (the 2026-08-19 signature)" 2 "gateway=200 ingress=502"

  # Case B — ingress not listening at all (connection refused => 000). MUST fail.
  kill_srvs
  wait_free "$GW_PORT" || exit 1
  wait_free "$ING_PORT" || exit 1
  start_srv 200 "$GW_PORT"
  wait_listen "$GW_PORT" 200 || exit 1
  run_case "gateway=200 ingress=unreachable" 2 "gateway=200 ingress=000"

  # Case C — both healthy. MUST pass with exit 0, otherwise the check is a
  # tripwire that always trips and would be disabled within a week.
  start_srv 200 "$ING_PORT"
  wait_listen "$ING_PORT" 200 || exit 1
  run_case "gateway=200 ingress=200" 0 "gateway=200 ingress=200"

  [ "$SELF_FAIL" = "0" ] && { echo "[self-test] ALL PASS"; exit 0; }
  echo "[self-test] SELF-TEST FAILED"; exit 1
fi

GATEWAY_URL="${NV_GATEWAY_URL:-http://127.0.0.1:5000/api/jrx/health}"
INGRESS_URL="${NV_INGRESS_URL:-http://127.0.0.1/api/jrx/health}"
PUBLIC_URL="${NV_PUBLIC_URL:-https://api.nyayasiddhi.online/api/jrx/health}"
GATEWAY_CTR="${NV_GATEWAY_CONTAINER:-nyv-gateway}"
CONSOLE_CTR="${NV_CONSOLE_CONTAINER:-nyv-console}"
ATTEMPTS="${NV_INGRESS_ATTEMPTS:-12}"       # 12 × 5s = 60s window
SLEEP_S="${NV_INGRESS_SLEEP_S:-5}"

FAIL=0
WARN=0

log()  { echo "[ingress] $*"; }
fail() { echo "[ingress] FAIL: $*"; FAIL=1; }
warn() { echo "[ingress] WARN: $*"; WARN=1; }

# curl that reports the HTTP status even for 4xx/5xx. Deliberately NOT -f:
# `curl -f` collapses 502 and connection-refused into the same empty result,
# and telling those two apart is the whole point here.
#
# NV-VALIDATE-THE-PROBE-001: on connection failure curl already prints "000" AND
# exits non-zero, so a naive `|| echo 000` emitted "000\n000" — an impossible
# HTTP status. Capture first, then normalise anything that is not exactly three
# digits to 000, so this helper can only ever return a 3-character code.
http_code() {
  local out
  out="$(curl -s -o /dev/null -w '%{http_code}' -m "${2:-5}" "$1" 2>/dev/null)"
  case "$out" in
    [0-9][0-9][0-9]) printf '%s' "$out" ;;
    *)               printf '000' ;;
  esac
}

# ---------------------------------------------------------------------------
# 1. TOPOLOGY — the direct assertion for the 2026-08-19 network partition
# ---------------------------------------------------------------------------
if [ "${NV_SKIP_DOCKER:-0}" != "1" ] && command -v docker >/dev/null 2>&1; then
  GW_NETS="$(docker inspect "$GATEWAY_CTR" \
    --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' 2>/dev/null || echo '')"
  CON_NETS="$(docker inspect "$CONSOLE_CTR" \
    --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' 2>/dev/null || echo '')"
  log "gateway networks: ${GW_NETS:-<none>}"
  log "console networks: ${CON_NETS:-<none>}"

  SHARED=""
  for n in $GW_NETS; do
    for m in $CON_NETS; do
      [ "$n" = "$m" ] && SHARED="$SHARED $n"
    done
  done

  if [ -z "${GW_NETS// /}" ] || [ -z "${CON_NETS// /}" ]; then
    warn "could not read container networks (containers absent?) — topology check skipped"
  elif [ -z "${SHARED// /}" ]; then
    fail "NETWORK PARTITION: $GATEWAY_CTR and $CONSOLE_CTR share NO docker network."
    echo "[ingress]   This is the 2026-08-19T15:55Z failure mode verbatim. nginx in"
    echo "[ingress]   $CONSOLE_CTR cannot resolve its 'gateway' upstream, so every public"
    echo "[ingress]   request 502s while :5000 still answers 200."
    echo "[ingress]   Cause is almost always a compose invocation with an unpinned project"
    echo "[ingress]   name. Remedy WITHOUT a restart (reclaims the cached IP):"
    echo "[ingress]     docker network connect --alias gateway --alias nyv-gateway \\"
    echo "[ingress]       nyayavigya-platform-312_nyv-net $GATEWAY_CTR"
    echo "[ingress]     docker exec $CONSOLE_CTR sh -c 'nginx -t && nginx -s reload'"
  else
    log "shared network(s):${SHARED} — OK"
  fi

  # DNS from inside the console is what nginx itself does. getent returning
  # NXDOMAIN here was the single clearest signal during the incident.
  if docker inspect "$CONSOLE_CTR" --format '{{.State.Running}}' 2>/dev/null | grep -q true; then
    if docker exec "$CONSOLE_CTR" getent hosts gateway >/dev/null 2>&1; then
      log "console resolves 'gateway': $(docker exec "$CONSOLE_CTR" getent hosts gateway 2>/dev/null | head -1)"
    else
      fail "nginx upstream 'gateway' does NOT resolve from inside $CONSOLE_CTR (NXDOMAIN)"
    fi
  fi
else
  log "docker checks skipped (NV_SKIP_DOCKER=${NV_SKIP_DOCKER:-0} / docker unavailable)"
fi

# ---------------------------------------------------------------------------
# 2. GATEWAY (ground truth) — informational on its own, decisive in step 4
# ---------------------------------------------------------------------------
GW_CODE="$(http_code "$GATEWAY_URL")"
log "gateway  $GATEWAY_URL -> HTTP $GW_CODE"

# ---------------------------------------------------------------------------
# 3. INGRESS — the hop that was broken. Poll, because a console recreate needs
#    a few seconds to bind :80.
# ---------------------------------------------------------------------------
ING_CODE=000
for i in $(seq 1 "$ATTEMPTS"); do
  ING_CODE="$(http_code "$INGRESS_URL")"
  if [ "$ING_CODE" = "200" ]; then
    log "ingress  $INGRESS_URL -> HTTP 200 after $(( (i - 1) * SLEEP_S ))s"
    break
  fi
  [ "$i" -lt "$ATTEMPTS" ] && sleep "$SLEEP_S"
done
[ "$ING_CODE" = "200" ] || log "ingress  $INGRESS_URL -> HTTP $ING_CODE (last of $ATTEMPTS attempts)"

# ---------------------------------------------------------------------------
# 4. DIVERGENCE — the named signature. Hard fail, never a warning.
# ---------------------------------------------------------------------------
if [ "$ING_CODE" != "200" ]; then
  if [ "$GW_CODE" = "200" ]; then
    fail "INGRESS/GATEWAY DIVERGENCE — gateway :5000 is 200 but ingress is $ING_CODE."
    echo "[ingress]   This exact divergence is the signature of NV-DEPLOY-NET-PROJECT-001"
    echo "[ingress]   (2026-08-19, 51 min, 511 502s). The app is healthy; the path to it is"
    echo "[ingress]   not. Do NOT declare this deploy good on the strength of the :5000 probe."
  else
    fail "ingress $ING_CODE and gateway $GW_CODE — the app itself is not serving"
  fi
fi

# ---------------------------------------------------------------------------
# 5. CONSOLE HEALTHCHECK — it screamed for 50 minutes and nobody listened
# ---------------------------------------------------------------------------
if [ "${NV_SKIP_DOCKER:-0}" != "1" ] && command -v docker >/dev/null 2>&1; then
  HC="$(docker inspect "$CONSOLE_CTR" --format '{{if .State.Health}}{{.State.Health.Status}}|{{.State.Health.FailingStreak}}{{else}}none|0{{end}}' 2>/dev/null || echo 'unknown|0')"
  HC_STATUS="${HC%%|*}"
  HC_STREAK="${HC##*|}"
  log "console healthcheck: status=$HC_STATUS failingStreak=$HC_STREAK"
  case "$HC_STATUS" in
    healthy)   : ;;
    unhealthy) fail "$CONSOLE_CTR docker healthcheck is UNHEALTHY (failingStreak=$HC_STREAK) — ingress is not trustworthy" ;;
    starting)  warn "$CONSOLE_CTR healthcheck still 'starting' — re-check before declaring GA" ;;
    none)      warn "$CONSOLE_CTR has no healthcheck defined" ;;
    *)         warn "$CONSOLE_CTR healthcheck state unreadable ($HC_STATUS)" ;;
  esac
fi

# ---------------------------------------------------------------------------
# 6. PUBLIC EDGE — warn-only on purpose
# ---------------------------------------------------------------------------
if [ "${NV_SKIP_PUBLIC:-0}" != "1" ]; then
  PUB_CODE="$(http_code "$PUBLIC_URL" 10)"
  log "public   $PUBLIC_URL -> HTTP $PUB_CODE"
  if [ "$PUB_CODE" != "200" ]; then
    # 000 from inside the VPC usually means split-horizon DNS or a security group,
    # not a platform fault; a 5xx here with :80 green means the edge/ALB, not us.
    warn "public edge not 200 ($PUB_CODE) — check DNS/ALM/ALB; local ingress is $ING_CODE"
  fi
fi

if [ "$FAIL" = "1" ]; then
  echo "[ingress] VERDICT: FAIL (gateway=$GW_CODE ingress=$ING_CODE)"
  exit 2
fi
echo "[ingress] VERDICT: PASS (gateway=$GW_CODE ingress=$ING_CODE warnings=$WARN)"
exit 0
