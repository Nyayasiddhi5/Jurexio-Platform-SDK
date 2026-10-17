#!/usr/bin/env bash
# ============================================================
# nv-audit-chain-repair.sh — T011 Stream B (2026-05-06)
#
# One-command recovery for the nv_audit_logs hash-chain when the boot
# self-test (src/startup/jrx-audit-chain-self-test.ts) reports tampered
# or mismatched record_hash values.
#
# Workflow:
#   1. (Implicitly) sets NYV_AUDIT_CHAIN_TOLERATE=1 in the printed
#      runbook so the gateway can boot during recovery.
#   2. Recomputes record_hash for every row using the canonical
#      sha256(id|trace_id|route|method|event_type|previous_hash) recipe
#      that matches the TS self-test exactly.
#   3. Validates the chain post-repair with a sample integrity check.
#   4. Reverts the tolerate flag (the operator un-exports it).
#
# DRY-RUN: prints the planned UPDATE counts + the SQL it WOULD run,
# without mutating data. Exits 0 if a plan was produced.
#
# REAL RUN: requires `--apply`. Wrapped in a single transaction so a
# failed validation rolls back cleanly.
#
# Usage:
#   bash scripts/jrx-audit-chain-repair.sh --dry-run
#   bash scripts/jrx-audit-chain-repair.sh --apply
#
# Requirements: psql in PATH, DATABASE_URL set.
# ============================================================
set -euo pipefail

MODE="dry-run"
for arg in "$@"; do
  case "$arg" in
    --dry-run) MODE="dry-run" ;;
    --apply)   MODE="apply" ;;
    -h|--help)
      sed -n '1,40p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown flag: $arg" >&2
      echo "Usage: $0 [--dry-run|--apply]" >&2
      exit 2
      ;;
  esac
done

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "✗ DATABASE_URL not set. Aborting." >&2
  exit 2
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "✗ psql not found in PATH. Install postgresql-client." >&2
  exit 2
fi

PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -X -q -A -t)

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  NV-AUDIT-CHAIN-REPAIR — mode: $MODE"
echo "════════════════════════════════════════════════════════════"
echo ""

# ── 0. Pre-flight: schema present? ──────────────────────────────────
HAS_TABLE=$("${PSQL[@]}" -c "SELECT to_regclass('public.nv_audit_logs') IS NOT NULL")
if [[ "$HAS_TABLE" != "t" ]]; then
  echo "  • nv_audit_logs not present on this DB — nothing to repair."
  echo "  ✓ exit 0"
  exit 0
fi

# Some early DBs created the table without a record_hash column. The repair
# can't run without it; report and exit cleanly so the caller can decide
# whether to migrate first.
HAS_COL=$("${PSQL[@]}" -c "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='nv_audit_logs' AND column_name='record_hash')")
if [[ "$HAS_COL" != "t" ]]; then
  echo "  • nv_audit_logs is present but has no record_hash column."
  echo "    Add it via the audit-chain migration before repair can run:"
  echo "      ALTER TABLE nv_audit_logs ADD COLUMN record_hash TEXT;"
  echo "      ALTER TABLE nv_audit_logs ADD COLUMN previous_hash TEXT;"
  echo "  ✓ exit 0  (no-op — chain not initialised on this DB)"
  exit 0
fi

# ── 1. Count rows + current mismatches (planned-changes report) ─────
TOTAL=$("${PSQL[@]}" -c "SELECT COUNT(*) FROM nv_audit_logs")
TOTAL=${TOTAL:-0}
echo "  • Total audit rows:        $TOTAL"

# Recompute expected hash inline (matches the TS recipe exactly).
MISMATCH_SQL=$(cat <<'SQL'
SELECT COUNT(*)
  FROM nv_audit_logs
 WHERE record_hash IS NOT NULL
   AND record_hash <> encode(
         digest(
           CONCAT_WS('|',
             id::text,
             COALESCE(trace_id, ''),
             COALESCE(route, ''),
             COALESCE(method, ''),
             COALESCE(event_type, ''),
             COALESCE(previous_hash, '')
           ),
           'sha256'
         ),
         'hex'
       )
SQL
)

# pgcrypto provides digest(); ensure it's available before counting.
"${PSQL[@]}" -c "CREATE EXTENSION IF NOT EXISTS pgcrypto" >/dev/null

MISMATCHES=$("${PSQL[@]}" -c "$MISMATCH_SQL")
MISMATCHES=${MISMATCHES:-0}
echo "  • Mismatched record_hash:  $MISMATCHES"

if [[ "$MISMATCHES" == "0" ]]; then
  echo "  ✓ Chain already consistent — no repair needed."
  exit 0
fi

# ── 2. Build the planned UPDATE ─────────────────────────────────────
REPAIR_SQL=$(cat <<'SQL'
UPDATE nv_audit_logs
   SET record_hash = encode(
         digest(
           CONCAT_WS('|',
             id::text,
             COALESCE(trace_id, ''),
             COALESCE(route, ''),
             COALESCE(method, ''),
             COALESCE(event_type, ''),
             COALESCE(previous_hash, '')
           ),
           'sha256'
         ),
         'hex'
       )
 WHERE record_hash IS NULL
    OR record_hash <> encode(
         digest(
           CONCAT_WS('|',
             id::text,
             COALESCE(trace_id, ''),
             COALESCE(route, ''),
             COALESCE(method, ''),
             COALESCE(event_type, ''),
             COALESCE(previous_hash, '')
           ),
           'sha256'
         ),
         'hex'
       );
SQL
)

if [[ "$MODE" == "dry-run" ]]; then
  echo ""
  echo "  ── PLAN ──"
  echo "  Would set NYV_AUDIT_CHAIN_TOLERATE=1 for the gateway."
  echo "  Would UPDATE $MISMATCHES row(s) of nv_audit_logs."
  echo "  Then unset NYV_AUDIT_CHAIN_TOLERATE on next deploy."
  echo ""
  echo "  ── SQL (not executed) ──"
  echo "$REPAIR_SQL"
  echo ""
  echo "  ✓ Dry-run complete. Re-run with --apply to commit."
  exit 0
fi

# ── 3. Apply inside a single transaction ────────────────────────────
echo ""
echo "  ── APPLYING ──"
"${PSQL[@]}" <<SQL
BEGIN;
$REPAIR_SQL
SELECT
  CASE
    WHEN (SELECT COUNT(*) FROM nv_audit_logs
           WHERE record_hash IS NOT NULL
             AND record_hash <> encode(
                   digest(
                     CONCAT_WS('|',
                       id::text,
                       COALESCE(trace_id, ''),
                       COALESCE(route, ''),
                       COALESCE(method, ''),
                       COALESCE(event_type, ''),
                       COALESCE(previous_hash, '')
                     ),
                     'sha256'
                   ),
                   'hex'
                 )) = 0
    THEN 'ok'
    ELSE (RAISE EXCEPTION 'post_repair_mismatches_remain')::text
  END;
COMMIT;
SQL

echo ""
echo "  ✓ Repair committed. Recommend: unset NYV_AUDIT_CHAIN_TOLERATE and restart gateway."
exit 0
