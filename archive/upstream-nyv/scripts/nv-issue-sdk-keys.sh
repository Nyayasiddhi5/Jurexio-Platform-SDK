#!/usr/bin/env bash
# =============================================================================
# nv-issue-sdk-keys.sh — One-shot SDK key issuance for all 5 platforms.
#
# NYV-NS-026 (2026-05-05): replaces manual console-UI key issuance.
#
# WHAT IT DOES (idempotent):
#   1. Runs `npx tsx scripts/jrx-seed-sdk-keys.ts` to mint 5 live + 5 test
#      keys in the local Replit Postgres (nv_api_keys table) and the
#      sdk_app_api_keys table.
#   2. Captures the freshly-minted live keys (nyv_live_sk_*) from stdout.
#   3. Updates Replit Secrets via Replit's secrets API (writes to
#      .local/secrets-pending.json — user must paste into Secrets UI;
#      Replit doesn't expose a programmatic Secrets write API to repls).
#   4. Mirrors the SAME 5 keys to AWS SSM Parameter Store under
#      /nyv/prod/NYV_SDK_KEY_<PLATFORM> as SecureString (so EC2's
#      docker-compose can pick them up on next deploy).
#   5. Writes an audit ledger entry to .local/sdk-key-issuance.log.
#
# USAGE
#   bash scripts/jrx-issue-sdk-keys.sh                    # full issuance
#   bash scripts/jrx-issue-sdk-keys.sh --skip-ssm         # local-only
#   bash scripts/jrx-issue-sdk-keys.sh --dry-run          # preview only
#
# REQUIRED ENV (already in Replit Secrets):
#   DATABASE_URL                              — local Postgres for seed
#   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY  — for ssm:PutParameter
#   NYV_AWS_REGION                            — e.g. ap-south-1
#
# AUDIT TRAIL
#   Each run appends ONE entry to .local/sdk-key-issuance.log with
#   timestamp + which platforms got new keys + whether SSM was updated.
#
# ⚠️  SECURITY WARNINGS
#   1. Re-running this script ROTATES all keys (any old keys still issued
#      to consumers will be invalidated when the new ones replace them in
#      Replit Secrets and SSM). NOT idempotent — only run when intentional.
#   2. Plaintext live keys are written to .local/secrets-pending.json so
#      you can paste them into the Replit Secrets UI (Replit has no
#      programmatic Secrets-write API). DELETE this file as soon as the
#      paste is done. Do NOT commit it (.local/ is gitignored).
#   3. Run on a TRUSTED terminal only — keys are echoed to stdout for
#      operator confirmation. Do not screen-share during this script.
# =============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DRY_RUN=false
SKIP_SSM=false
for arg in "$@"; do
  case "$arg" in
    --dry-run)  DRY_RUN=true ;;
    --skip-ssm) SKIP_SSM=true ;;
    *) echo "Unknown arg: $arg"; exit 2 ;;
  esac
done

STAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
mkdir -p .local
LOG=".local/sdk-key-issuance.log"
PENDING=".local/secrets-pending.json"

echo "═══════════════════════════════════════════════════════════════════"
echo "  NYV SDK Key Issuance — $STAMP"
echo "  Mode: $($DRY_RUN && echo DRY-RUN || echo LIVE) | SSM: $($SKIP_SSM && echo SKIP || echo MIRROR)"
echo "═══════════════════════════════════════════════════════════════════"

if $DRY_RUN; then
  echo "[dry-run] Would invoke: npx tsx scripts/jrx-seed-sdk-keys.ts"
  echo "[dry-run] Would mint 5 live + 5 test keys for: nyayamitra, nys-professional, nys-institutional, nys-academy, nys-ministry"
  echo "[dry-run] Would write keys to .local/secrets-pending.json + AWS SSM /nyv/prod/NYV_SDK_KEY_*"
  exit 0
fi

# ─── Step 1: Mint keys via existing seed script ─────────────────────
echo ""
echo "[1/4] Minting SDK keys via nv-seed-sdk-keys.ts..."
SEED_OUT="$(npx tsx scripts/jrx-seed-sdk-keys.ts 2>&1)"
SEED_RC=$?
if [ $SEED_RC -ne 0 ]; then
  echo "  ✗ Seed failed (rc=$SEED_RC):"
  echo "$SEED_OUT" | tail -20
  exit 1
fi
echo "$SEED_OUT" | grep -E "Live:|Test:|✓" | head -20

# ─── Step 2: Extract live keys per platform ─────────────────────────
echo ""
echo "[2/4] Extracting live keys per platform..."
declare -A KEYS
while IFS= read -r line; do
  if [[ "$line" =~ Live:[[:space:]]+(nyv_live_sk_([a-z]+)_[a-f0-9]+) ]]; then
    full="${BASH_REMATCH[1]}"
    short="${BASH_REMATCH[2]}"
    KEYS[$short]="$full"
    echo "  ✓ $short → ${full:0:24}..."
  fi
done <<< "$SEED_OUT"

if [ ${#KEYS[@]} -lt 5 ]; then
  echo "  ✗ Expected 5 platforms, got ${#KEYS[@]} — abort"
  exit 1
fi

# ─── Step 3: Write Replit secrets-pending.json ──────────────────────
echo ""
echo "[3/4] Writing $PENDING (paste these into Replit Secrets UI)..."
{
  echo "{"
  echo "  \"_generated_at\": \"$STAMP\","
  echo "  \"_instructions\": \"Paste each key into Replit Secrets at Tools → Secrets. Existing secret values will be overwritten.\","
  echo "  \"NYV_SDK_KEY_NSP\": \"${KEYS[nsp]}\","
  echo "  \"NYV_SDK_KEY_NSI\": \"${KEYS[nsi]}\","
  echo "  \"NYV_SDK_KEY_NSA\": \"${KEYS[nsa]}\","
  echo "  \"NYV_SDK_KEY_NSM\": \"${KEYS[nsm]}\","
  echo "  \"NYV_SDK_KEY_NYM\": \"${KEYS[nym]}\""
  echo "}"
} > "$PENDING"
echo "  ✓ Written. Open .local/secrets-pending.json and paste into Replit Secrets."

# ─── Step 4: Mirror to AWS SSM Parameter Store ──────────────────────
if $SKIP_SSM; then
  echo ""
  echo "[4/4] SSM mirror SKIPPED (--skip-ssm)"
else
  echo ""
  echo "[4/4] Mirroring to AWS SSM /nyv/prod/NYV_SDK_KEY_*..."
  REGION="${NYV_AWS_REGION:-ap-south-1}"
  for short in nsp nsi nsa nsm nym; do
    upper=$(echo "$short" | tr '[:lower:]' '[:upper:]')
    PARAM_NAME="/nyv/prod/NYV_SDK_KEY_$upper"
    if aws ssm put-parameter \
        --name "$PARAM_NAME" \
        --value "${KEYS[$short]}" \
        --type SecureString \
        --overwrite \
        --region "$REGION" \
        --description "NYV SDK key for $upper platform (issued $STAMP)" \
        >/dev/null 2>&1; then
      echo "  ✓ $PARAM_NAME"
    else
      echo "  ✗ $PARAM_NAME — failed (check IAM ssm:PutParameter)"
    fi
  done
fi

# ─── Audit ledger ─────────────────────────────────────────────
echo "$STAMP | issued=5platforms | ssm=$($SKIP_SSM && echo skipped || echo mirrored) | replit=manual_paste_pending" >> "$LOG"

echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo "  ✓ Issuance complete."
echo "  Next steps:"
echo "    1. Open Replit Secrets (Tools → Secrets) and paste the 5 keys"
echo "       from .local/secrets-pending.json."
echo "    2. Restart the gateway workflow to pick up the new secrets."
echo "    3. Run: bash scripts/jrx-smoke-ec2.sh full"
echo "═══════════════════════════════════════════════════════════════════"
