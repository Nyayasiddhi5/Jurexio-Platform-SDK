#!/usr/bin/env bash
# JRX-EMBED-STALL-DETECTOR-001 (2026-08-18) — /opt/nyv/api/jrx-embed-stall-detector.sh
#
# Why this exists: HC shard 2 was dark for ~40 HOURS while `systemctl is-active` reported
# `active` and `NRestarts=0`, so nothing alerted. Its worker held a Postgres backend that
# the server considered `idle` — the query had finished and the reply was lost on a
# half-open socket. `statement_timeout` cannot bound that (it only limits a RUNNING query),
# and with the host's `tcp_keepalive_time=7200` the dead peer is invisible for 2 hours.
#
# This is the SAFETY NET, not the cure. The cure is `keepAlive` + `query_timeout` on the
# embed client, which needs a source rebuild (deployed bundle is AHEAD of the local
# submodule checkout, so rebuilding from it would regress the `dc` scope). Until that
# lands, this detects the symptom — a checkpoint that stops advancing while its unit
# claims to be running — and restarts the unit.
#
# Deliberately conservative: it only ever restarts a unit whose OWN checkpoint is stale.
# It never touches a scope that is legitimately finished (e.g. `sc`, which is 100 % done
# and whose checkpoint is stale by design — treating that as a fault would restart-loop it
# forever). Scopes are therefore whitelisted explicitly.
set -uo pipefail

API_DIR="${API_DIR:-/opt/nyv/api}"
ENV_FILE="${ENV_FILE:-$API_DIR/.env}"
LOG="${STALL_LOG:-/opt/nyv/embed-stall.log}"
# A worker writes a checkpoint every ~50s per batch. 30 min is ~36 missed batches: long
# enough to never fire on a slow batch or a between-pass gap, short enough that we lose
# minutes instead of the 40 hours we actually lost.
STALE_SECS="${EMBED_STALE_SECS:-1800}"
DRY_RUN="${STALL_DRY_RUN:-0}"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" >> "$LOG"; }

# scope -> systemd unit. ONLY scopes that should be continuously advancing.
# `sc` is intentionally absent: it is complete, so a stale checkpoint is correct.
# `all` is intentionally absent: it is disabled (EMBED_ALL_MAX_ROWS=0, India-only).
# `hc:s2of3` is intentionally absent: shard 2 runs EMBED_YEAR_MIN=2025 and writes
# `hc:s2of3:y2025`; monitoring the preserved hc:s2of3 row caused restart loops every ~11 min.
declare -A UNIT_FOR=(
  ["hc:s0of3"]="jrx-caselaw-embed-loop@0"
  ["hc:s1of3"]="jrx-caselaw-embed-loop@1"
  ["hc:s2of3:y2025"]="jrx-caselaw-embed-loop@2"
  ["dc"]="jrx-caselaw-embed-dc"
)

# Ask the caselaw DB how stale each checkpoint is. Connection is built exactly as
# rdsPool.ts does it (DescribeDBInstances -> MasterUserSecret -> Secrets Manager),
# because DATABASE_URL on this host is the PLATFORM db, not the caselaw db.
read_staleness() {
  # The probe MUST live inside $API_DIR: Node resolves bare imports from the script's own
  # directory upward, so a copy in /tmp cannot see /opt/nyv/api/node_modules and fails with
  # ERR_MODULE_NOT_FOUND for @aws-sdk/*. That produced an empty read and a "PROBE FAILED"
  # on first install — caught because the detector fails closed.
  local probe="$API_DIR/.jrx-embed-stall-probe.mjs"
  cat > "$probe" <<'JS'
import { RDSClient, DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import pg from "pg";
const R = "ap-south-1";
try {
  const d = await new RDSClient({ region: R }).send(
    new DescribeDBInstancesCommand({ DBInstanceIdentifier: "jrx-caselaw-pg" }));
  const i = d.DBInstances?.[0];
  if (!i?.Endpoint?.Address) { console.log("PROBE_BROKEN no_endpoint"); process.exit(3); }
  const s = await new SecretsManagerClient({ region: R }).send(
    new GetSecretValueCommand({ SecretId: i.MasterUserSecret.SecretArn }));
  const cr = JSON.parse(s.SecretString);
  const c = new pg.Client({
    host: i.Endpoint.Address, port: i.Endpoint.Port ?? 5432, database: i.DBName ?? "nyv_caselaw",
    user: cr.username, password: cr.password, ssl: { rejectUnauthorized: false },
    statement_timeout: 30000, query_timeout: 30000,
    keepAlive: true, keepAliveInitialDelayMillis: 10000,
  });
  await c.connect();
  // Positive control first: if this does not come back 5150, the instrument is broken and
  // we must NOT interpret an empty result as "everything is stale".
  const ctl = await c.query("SELECT 5150 AS s");
  if (ctl.rows?.[0]?.s !== 5150) { console.log("PROBE_BROKEN control"); process.exit(3); }
  const r = await c.query(
    `SELECT scope, last_id, EXTRACT(EPOCH FROM (now() - updated_at))::bigint AS stale_secs
       FROM embed_progress`);
  for (const row of r.rows) console.log(`OK ${row.scope} ${row.last_id} ${row.stale_secs}`);
  await c.end();
} catch (e) {
  console.log("PROBE_BROKEN " + String(e.message).slice(0, 120).replace(/\s+/g, "_"));
  process.exit(3);
}
JS
  ( cd "$API_DIR" && node --env-file="$ENV_FILE" "$probe" 2>/dev/null )
  rm -f "$probe"
}

OUT="$(read_staleness || true)"

# Fail CLOSED: a broken probe must never trigger restarts.
if [[ -z "$OUT" ]] || ! grep -q '^OK ' <<<"$OUT"; then
  log "PROBE FAILED — taking no action. out=${OUT:0:160}"
  exit 0
fi
if grep -q '^PROBE_BROKEN' <<<"$OUT"; then
  log "PROBE reported broken — taking no action. $(grep '^PROBE_BROKEN' <<<"$OUT" | head -1)"
  exit 0
fi

acted=0
while read -r tag scope last_id stale; do
  [[ "$tag" == "OK" ]] || continue
  unit="${UNIT_FOR[$scope]:-}"
  [[ -n "$unit" ]] || continue                      # unmonitored scope (sc / all)
  [[ "$stale" =~ ^[0-9]+$ ]] || continue

  if (( stale > STALE_SECS )); then
    active="$(systemctl is-active "$unit" 2>/dev/null || true)"
    # Cooldown: never restart a unit that systemd started recently — the checkpoint
    # from the *previous* run stays stale until the first batch of the new run lands.
    started_at="$(systemctl show "$unit" -p ActiveEnterTimestamp --value 2>/dev/null || true)"
    if [[ -n "$started_at" ]]; then
      started_epoch="$(date -d "$started_at" +%s 2>/dev/null || date -j -f '%Y-%m-%d %H:%M:%S %z' "${started_at/T/ }" +%s 2>/dev/null || echo 0)"
      now_epoch="$(date +%s)"
      if (( started_epoch > 0 && now_epoch - started_epoch < STALE_SECS )); then
        log "scope=$scope stale=${stale}s but $unit started ${now_epoch - started_epoch}s ago — cooldown, no action"
        continue
      fi
    fi
    # Only act on the pathological case: unit claims healthy, work has stopped.
    # If the unit is already failed/inactive, systemd's own Restart= handles it.
    if [[ "$active" == "active" ]]; then
      if [[ "$DRY_RUN" == "1" ]]; then
        log "DRY_RUN would restart $unit (scope=$scope stale=${stale}s last_id=$last_id)"
      else
        log "STALL scope=$scope stale=${stale}s last_id=$last_id unit=$unit active=$active -> restarting"
        # Kill the wedged worker first: the loop shell is in do_wait on it, so restarting
        # the unit alone can leave an orphan holding the dead socket.
        pkill -f "embed-corpus.mjs" --older-than "${STALE_SECS}" 2>/dev/null || true
        systemctl restart "$unit" 2>/dev/null \
          && log "restarted $unit OK" \
          || log "FAILED to restart $unit"
      fi
      acted=1
    else
      log "scope=$scope stale=${stale}s but unit=$unit is '$active' — systemd owns this, no action"
    fi
  fi
done <<<"$OUT"

(( acted == 0 )) && log "ok — all monitored scopes advancing within ${STALE_SECS}s"
exit 0
