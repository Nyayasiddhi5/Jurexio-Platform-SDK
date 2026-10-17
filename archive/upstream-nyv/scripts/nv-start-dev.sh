#!/bin/bash
# ============================================================
# Nyayavigya Platform 5.0.0 — Development Startup Script
# NYV-SVC-GATEWAY | NYV-SVC-ORCH | NYV-SVC-SDK
# ============================================================

set -e

# Propagate .env to migration/seed subprocesses (scripts/_pg-pool.ts reads DATABASE_URL).
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

# ─── NV-PRE-DEPLOY-SMOKE-001 flag-ON injection (TEMPORARY 2026-05-11) ────────
# Removed at end of pre-deploy UAT. DO NOT MERGE WITH FLAGS ON.
if [ -f "$(dirname "$0")/jrx-preflight-flags-on.sh" ]; then
  . "$(dirname "$0")/jrx-preflight-flags-on.sh"
fi

# ─── NV-PLATFORM-UAT-BYPASS-001 (2026-05-14, user directive) ────────────────
# Disable rate-limit + scope checks ONLY for the 7 internal Nyayasiddhi
# platform keys (NYV_SDK_KEY_{NSP,NSPM,NSI,NSA,NSM,NYM,JRX}) so end-to-end
# UAT can run without 429/403 noise. This is a TARGETED bypass — auth/audit/
# RLS/PII/guardrails remain enforced. Bypass calls are tagged with
# X-Platform-UAT-Bypass response header. Unset to revert.
export NV_PLATFORM_UAT_BYPASS=${NV_PLATFORM_UAT_BYPASS:-1}

# ─── Redis bastion live (resolved 2026-05-07 v5.0.1) ─────────────────────────
# Bastion 13.232.165.242:16379 → ElastiCache `master.nyv-dev-edge-redis…`.
# Replit + EC2 share the SAME cluster (uniformity per user directive 2026-05-07).
# `NYV_REDIS_WRITE_URL` is a LEGACY alias (per NV-SECRETS-001); resolver in
# src/utils/redis-tcp-url.ts prefers `NYV_REDIS_TCP_URL`. Drop a malformed
# legacy value so it does not interfere with the canonical resolver.
if [ -n "${NYV_REDIS_WRITE_URL:-}" ]; then
  if ! printf '%s' "$NYV_REDIS_WRITE_URL" | grep -qE '^rediss?://'; then
    echo "  ⚠ NYV_REDIS_WRITE_URL is malformed (does not start with redis://). Unsetting; canonical NYV_REDIS_TCP_URL will be used."
    unset NYV_REDIS_WRITE_URL
  fi
fi

echo ""
echo "══════════════════════════════════════════════════════"
echo "  NYAYAVIGYA PLATFORM 5.0.0 — Development Startup"
echo "══════════════════════════════════════════════════════"
echo ""

NYV_PORT_GATEWAY=${NYV_PORT_GATEWAY:-5000}
NYV_PORT_ORCH=${NYV_PORT_ORCH:-3001}
NYV_PORT_SDK=${NYV_PORT_SDK:-4000}

# ── Kill any existing processes on NV ports ─────────────────
echo "  Clearing NV ports..."
for PORT in $NYV_PORT_GATEWAY $NYV_PORT_ORCH $NYV_PORT_SDK; do
  PID=$(lsof -t -i:$PORT 2>/dev/null || true)
  if [ ! -z "$PID" ]; then
    kill -9 $PID 2>/dev/null || true
    echo "  ✓ Killed process on port $PORT"
  fi
done

sleep 2

# ── Validate .env exists ─────────────────────────────────────
if [ ! -f ".env" ]; then
  if [ -f ".env.example" ]; then
    echo "  ⚠ No .env file found — copying from .env.example"
    cp .env.example .env
    echo "  → Edit .env and set your DATABASE_URL and API keys before running again"
    exit 1
  else
    echo "  ✗ No .env or .env.example found. Exiting."
    exit 1
  fi
fi

# ── Install dependencies if needed ──────────────────────────
if [ ! -d "node_modules" ]; then
  echo "  Installing dependencies..."
  npm install
fi

# ── Run DB migrations (safe — no destructive ops) ───────────
echo "  Running DB migrations..."
npx tsx scripts/jrx-migrate.ts

# ── Seed master data (idempotent) ───────────────────────────
echo "  Seeding master data..."
npx tsx scripts/jrx-seed-all.ts

# ── Demo data (idempotent, dev-only) — task #335 ─────────────
# GRPO training tiles + audit chain demo. Both seeders are gated to
# NODE_ENV !== production || NV_E2E_BYPASS=1 internally and will no-op
# in production builds.
echo "  Seeding GRPO demo data..."
npx tsx scripts/jrx-seed-grpo-demo.ts || true
echo "  Seeding audit chain demo data..."
npx tsx scripts/jrx-seed-audit-chain-demo.ts || true

# ── DB schema parity guardrail (warn-only in dev; CI runs strict) ────
# Surfaces Drizzle ⇄ Neon column drift before EC2 redeploy. The warn-only
# flag means dev never blocks; the report is captured in stdout.
echo "  Checking DB schema parity (warn-only)..."
npx tsx scripts/jrx-schema-parity-check.ts --warn-only || true

echo ""
echo "  ✓ Pre-flight checks complete. Starting NYV-SVC-GATEWAY..."
echo ""

# task-2026-05-13: dev-only E2E bypass — disables ALL rate limits, tier gates,
# tenant enforcement, and platform throttles so consumer-platform end-to-end
# tests can run unblocked. Production posture is unaffected (the bypass is
# additionally gated on NODE_ENV !== 'production').
export NV_E2E_BYPASS=${NV_E2E_BYPASS:-1}
export NYV_TENANT_ENFORCE=${NYV_TENANT_ENFORCE:-0}
echo "  ⚠ NV_E2E_BYPASS=$NV_E2E_BYPASS  (dev-only — rate/security limits disabled)"

# ── Start the platform ───────────────────────────────────────
NODE_ENV=development npx tsx src/index.ts
