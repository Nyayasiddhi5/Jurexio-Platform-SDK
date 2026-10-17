#!/usr/bin/env bash
# =============================================================================
# Nyayavigya 3.1.2 — Build all 4 SDKs and pack tarballs into dist-sdk/
# =============================================================================
# Used by:
#   * Bitbucket CI (`bitbucket-pipelines.yml`) on tagged releases
#   * Operators preparing handover bundles for the 5 Nyayasiddhi platforms
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OUT_DIR="${ROOT}/dist-sdk"
mkdir -p "$OUT_DIR"

PACKAGES=(types client-sdk react-hooks enterprise-sdk)

c_ok()   { printf '\033[0;32m✓\033[0m %s\n' "$*"; }
c_info() { printf '\033[0;34mℹ\033[0m %s\n' "$*"; }
c_fail() { printf '\033[0;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

PM="$(command -v pnpm || command -v npm)"
[ -n "$PM" ] || c_fail "no pnpm/npm found"
USE_PNPM=0; case "$PM" in *pnpm) USE_PNPM=1;; esac

c_info "package manager: $PM"
c_info "output dir     : $OUT_DIR"

for pkg in "${PACKAGES[@]}"; do
  DIR="packages/${pkg}"
  [ -d "$DIR" ] || c_fail "missing $DIR"
  c_info "── building @nyayavigya/${pkg} ──"
  (
    cd "$DIR"
    if [ "$USE_PNPM" -eq 1 ]; then
      pnpm install --prefer-offline --silent
      pnpm run build
    else
      npm install --prefer-offline --no-audit --no-fund --silent
      npm run build
    fi
    npm pack --pack-destination "$OUT_DIR" >/dev/null
  )
  c_ok "${pkg} built + packed"
done

c_info "── manifest ──"
( cd "$OUT_DIR" && ls -la *.tgz && sha256sum *.tgz > SHA256SUMS && cat SHA256SUMS )
c_ok "all SDKs ready in $OUT_DIR"
