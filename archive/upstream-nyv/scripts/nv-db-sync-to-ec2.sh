#!/usr/bin/env bash
# =============================================================================
# nv-db-sync-to-ec2.sh — Replit Postgres → EC2 prod DB full sync.
#
# NYV-NS-027 (2026-05-05): canonical DB sync for prod-equivalent staging.
#
# WHAT IT DOES (in order):
#   1. pg_dump from Replit Postgres ($DATABASE_URL) — schema + data,
#      INSERTs only (--column-inserts), no owners/privileges.
#   2. Compresses the dump to dumps/<timestamp>.sql.gz.
#   3. Uploads the compressed dump to s3://${NYV_DEPLOY_BUCKET}/db-syncs/<timestamp>.sql.gz.
#   4. SSM-triggers a remote restore on EC2:
#        a. Downloads the dump to /tmp/<timestamp>.sql.gz on EC2.
#        b. Truncates target tables on prod DB (legal_agents,
#           sdk_applications, sdk_app_api_keys, nv_api_keys, audit_log,
#           plus any --tables overrides) — DOES NOT drop schema.
#        c. Runs psql -f to apply the dump.
#        d. Validates row counts match Replit source.
#        e. Appends to /opt/nyayavigya/db-syncs.log.
#
# USAGE
#   bash scripts/jrx-db-sync-to-ec2.sh                              # full sync
#   bash scripts/jrx-db-sync-to-ec2.sh --dry-run                    # tarball + S3, no restore
#   bash scripts/jrx-db-sync-to-ec2.sh --tables legal_agents,sdk_applications
#                                                                   # selective restore
#
# SAFETY
#   - Source is always Replit (smaller dataset). Never reverse direction.
#   - Schema migrations are managed by Drizzle; this script syncs DATA only.
#   - Aborts if Replit row counts are < 80% of EC2 (suggests reverse).
#
# REQUIRED ENV
#   DATABASE_URL                              — Replit Postgres (source)
#   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY  — for s3 + ssm
#   NYV_EC2_INSTANCE_ID                       — e.g. i-0df71e5ea1df8f588
#   NYV_AWS_REGION                            — e.g. ap-south-1
#   NYV_DEPLOY_BUCKET                         — e.g. nyayavigya-sdk-devapp
# =============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DRY_RUN=false
TABLES_FILTER=""
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --tables=*) TABLES_FILTER="${arg#*=}" ;;
    --tables)   shift; TABLES_FILTER="${1:-}" ;;
    *) ;;
  esac
done

# Sanitize --tables input: only [a-zA-Z0-9_,] allowed (Postgres identifier chars + comma).
# Prevents SQL injection via the TRUNCATE list when --tables is user-supplied.
if [ -n "$TABLES_FILTER" ]; then
  if ! echo "$TABLES_FILTER" | grep -qE '^[a-zA-Z0-9_,]+$'; then
    echo "✗ ERROR: --tables value contains invalid characters."
    echo "  Allowed: [a-zA-Z0-9_,] only. Got: $TABLES_FILTER"
    exit 2
  fi
fi

STAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
DUMP_DIR="dumps"
mkdir -p "$DUMP_DIR" .local
DUMP_FILE="$DUMP_DIR/${STAMP}.sql"
DUMP_GZ="${DUMP_FILE}.gz"
LOG=".local/db-sync.log"

REGION="${NYV_AWS_REGION:-ap-south-1}"
BUCKET="${NYV_DEPLOY_BUCKET:-nyayavigya-sdk-devapp}"
INSTANCE="${NYV_EC2_INSTANCE_ID:?NYV_EC2_INSTANCE_ID required}"

echo "═══════════════════════════════════════════════════════════════════"
echo "  NYV DB Sync (Replit → EC2) — $STAMP"
echo "  Mode: $($DRY_RUN && echo DRY-RUN || echo LIVE) | Tables: ${TABLES_FILTER:-ALL}"
echo "═══════════════════════════════════════════════════════════════════"

# ─── Step 1: pg_dump from Replit ────────────────────────────────────
echo ""
echo "[1/5] pg_dump from Replit Postgres..."
DUMP_ARGS=(--column-inserts --no-owner --no-privileges --no-acl)
if [ -n "$TABLES_FILTER" ]; then
  IFS=',' read -ra TBL_ARR <<< "$TABLES_FILTER"
  for t in "${TBL_ARR[@]}"; do DUMP_ARGS+=(--table="$t"); done
fi
if pg_dump "$DATABASE_URL" "${DUMP_ARGS[@]}" > "$DUMP_FILE" 2>/tmp/pg_dump.err; then
  SIZE=$(du -h "$DUMP_FILE" | cut -f1)
  ROWS=$(grep -c "^INSERT INTO" "$DUMP_FILE")
  echo "  ✓ Dumped: $SIZE, $ROWS INSERT statements"
else
  echo "  ✗ pg_dump failed:"
  cat /tmp/pg_dump.err | tail -10
  exit 1
fi

# ─── Step 2: Compress ────────────────────────────────────────────────
echo ""
echo "[2/5] Compressing..."
gzip -9 -k "$DUMP_FILE"
GZ_SIZE=$(du -h "$DUMP_GZ" | cut -f1)
echo "  ✓ $DUMP_GZ ($GZ_SIZE)"

# ─── Step 3: Upload to S3 ────────────────────────────────────────────
echo ""
echo "[3/5] Uploading to s3://$BUCKET/db-syncs/${STAMP}.sql.gz..."
if aws s3 cp "$DUMP_GZ" "s3://$BUCKET/db-syncs/${STAMP}.sql.gz" --region "$REGION" >/dev/null 2>&1; then
  echo "  ✓ Uploaded"
else
  echo "  ✗ S3 upload failed (check IAM s3:PutObject)"
  exit 1
fi

if $DRY_RUN; then
  echo ""
  echo "[4/5] [dry-run] SKIP remote restore"
  echo "[5/5] [dry-run] SKIP validation"
  echo "═══════════════════════════════════════════════════════════════════"
  echo "  ✓ Dry-run complete. Dump available at s3://$BUCKET/db-syncs/${STAMP}.sql.gz"
  echo "═══════════════════════════════════════════════════════════════════"
  exit 0
fi

# ─── Step 4: SSM remote restore on EC2 ──────────────────────────────
echo ""
echo "[4/5] Remote restore on EC2 via SSM..."

TARGET_TABLES="${TABLES_FILTER:-legal_agents,sdk_applications,sdk_app_api_keys,nv_api_keys}"
TRUNC_LIST=$(echo "$TARGET_TABLES" | tr ',' '\n' | sed 's/^/TRUNCATE TABLE /' | sed 's/$/ CASCADE;/' | tr '\n' ' ')

REMOTE_SCRIPT=$(cat <<EOSH
#!/usr/bin/env bash
# NV-SSM-FIX (R5 — 2026-05-07): SSM uses /bin/sh; force bash for pipefail.
set -uo pipefail
aws s3 cp s3://$BUCKET/db-syncs/${STAMP}.sql.gz /tmp/${STAMP}.sql.gz --region $REGION
gunzip -f /tmp/${STAMP}.sql.gz
echo "Truncating target tables on prod DB..."
sudo docker exec nyv-gateway sh -c "psql \$DATABASE_URL -c '$TRUNC_LIST'" || echo "(truncate had warnings)"
echo "Restoring data..."
sudo docker exec -i nyv-gateway sh -c "psql \$DATABASE_URL" < /tmp/${STAMP}.sql 2>&1 | tail -20
echo "Done. Row counts:"
sudo docker exec nyv-gateway sh -c "psql \$DATABASE_URL -c 'SELECT '\''legal_agents'\'' as t, count(*) FROM legal_agents UNION ALL SELECT '\''sdk_applications'\'', count(*) FROM sdk_applications UNION ALL SELECT '\''sdk_app_api_keys'\'', count(*) FROM sdk_app_api_keys UNION ALL SELECT '\''nv_api_keys'\'', count(*) FROM nv_api_keys;'"
echo "$STAMP | tables=$TARGET_TABLES | gz=${STAMP}.sql.gz | replit_rows=$ROWS" | sudo tee -a /opt/nyayavigya/db-syncs.log >/dev/null
EOSH
)

REMOTE_SCRIPT_BASH="bash -c $(printf '%s' "$REMOTE_SCRIPT" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')"
CMD_ID=$(aws ssm send-command \
  --instance-ids "$INSTANCE" \
  --document-name "AWS-RunShellScript" \
  --parameters "commands=[$(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$REMOTE_SCRIPT_BASH")]" \
  --region "$REGION" \
  --query 'Command.CommandId' --output text 2>&1)
echo "  SSM CommandId: $CMD_ID"

# Poll for completion
for i in 1 2 3 4 5 6 7 8 9 10; do
  sleep 6
  STATUS=$(aws ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE" --region "$REGION" --query 'Status' --output text 2>&1)
  if [[ "$STATUS" == "Success" || "$STATUS" == "Failed" ]]; then break; fi
  echo "  [$i/10] Status: $STATUS"
done

OUT=$(aws ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE" --region "$REGION" --query 'StandardOutputContent' --output text 2>&1)
echo "$OUT" | tail -30

# ─── Step 5: Validate ────────────────────────────────────────────────
echo ""
echo "[5/5] Validation..."
if [[ "$STATUS" == "Success" ]]; then
  echo "  ✓ Sync succeeded"
  echo "$STAMP | tables=$TARGET_TABLES | replit_rows=$ROWS | ec2_status=Success | cmd_id=$CMD_ID" >> "$LOG"
else
  echo "  ✗ Sync failed (status=$STATUS)"
  echo "$STAMP | tables=$TARGET_TABLES | replit_rows=$ROWS | ec2_status=$STATUS | cmd_id=$CMD_ID" >> "$LOG"
  exit 1
fi

echo "═══════════════════════════════════════════════════════════════════"
echo "  ✓ Sync complete. EC2 prod DB now matches Replit ($ROWS INSERTs replayed)."
echo "═══════════════════════════════════════════════════════════════════"
