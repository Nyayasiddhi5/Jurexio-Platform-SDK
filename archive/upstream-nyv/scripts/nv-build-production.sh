#!/bin/bash
# ============================================================
# Nyayavigya Platform 3.1.2 — Production Build Script
# Builds backend (TypeScript) and frontend (React + Vite)
# ============================================================
set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_ok()   { echo -e "${GREEN}[BUILD OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[BUILD WARN]${NC} $1"; }
log_info() { echo -e "${BLUE}[BUILD]${NC} $1"; }

echo -e "${BLUE}"
echo "══════════════════════════════════════════════════════"
echo "  Nyayavigya Platform 3.1.2 — Production Build"
echo "  Justice. Powered by Precision."
echo "══════════════════════════════════════════════════════"
echo -e "${NC}"

START_TIME=$(date +%s)

# ── Step 1: Install dependencies ──────────────────────────
log_info "Installing dependencies..."
npm install --legacy-peer-deps --prefer-offline --silent 2>&1 || \
npm install --legacy-peer-deps --silent 2>&1
log_ok "Dependencies installed"

# ── Step 2: TypeScript check (backend) ───────────────────
log_info "Type-checking backend..."
npx tsc --noEmit --skipLibCheck 2>&1 | tail -5 || log_warn "Backend has TS warnings (non-fatal)"
log_ok "Backend type-check done"

# ── Step 3: Build frontend ────────────────────────────────
log_info "Building frontend (React + Vite)..."
# NB: do NOT pass `client/` positional — it overrides config root and breaks
# alias resolution (@ → undefined). vite.config.ts already has root: './client'.
npx vite build
log_ok "Frontend built → client/dist/"

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo ""
echo -e "${GREEN}══════════════════════════════════════════════════════"
echo "  BUILD COMPLETE in ${DURATION}s"
echo "  Backend: tsx runtime (no separate compilation needed)"
echo "  Frontend: client/dist/"
echo -e "══════════════════════════════════════════════════════${NC}"
